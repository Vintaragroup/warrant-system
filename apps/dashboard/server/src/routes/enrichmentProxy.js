import { Router } from 'express';
import mongoose from 'mongoose';
import {
  V2_CASE_COLLECTIONS,
  buildNormalizeStages,
  buildCountyStage,
} from '../lib/v2Collections.js';

const r = Router();

const TARGET_BASE = process.env.ENRICHMENT_API_URL || 'http://localhost:4000';
const DEFAULT_TIMEOUT_MS = Number(process.env.ENRICHMENT_PROXY_TIMEOUT_MS || 10000);
const NAME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Simple in-memory cache for subjectId -> name
const subjectNameCache = new Map(); // subjectId -> { name, ts }

function getCachedName(subjectId) {
  const e = subjectNameCache.get(subjectId);
  if (!e) return null;
  if (Date.now() - e.ts > NAME_CACHE_TTL_MS) {
    subjectNameCache.delete(subjectId);
    return null;
  }
  return e.name || null;
}

function setCachedName(subjectId, name) {
  if (!subjectId) return;
  subjectNameCache.set(subjectId, { name: name || null, ts: Date.now() });
}

function buildTargetUrl(pathname = '/', query = {}) {
  const base = new URL(TARGET_BASE);
  // Support both /enrichment/* and /providers/* upstream paths
  const upstreamPath = String(pathname || '').startsWith('/providers/')
    ? `/api${pathname}` // maps to /api/providers/* on enrichment API
    : `/api/enrichment${pathname}`; // default /api/enrichment/*
  const target = new URL(upstreamPath, base);
  // Copy query params
  Object.entries(query || {}).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach((item) => target.searchParams.append(k, item));
    } else if (v != null) {
      target.searchParams.set(k, String(v));
    }
  });
  return target;
}

// Lightweight health check to validate connectivity to the target base.
// Note: This route is still behind requireAuth (mounted by index.js) but doesn't call the external API path.
r.get('/_proxy_health', async (_req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(TARGET_BASE, { method: 'HEAD', signal: controller.signal });
    return res.json({ ok: true, target: TARGET_BASE, status: resp.status });
  } catch (err) {
    const status = err?.name === 'AbortError' ? 504 : 502;
    return res.status(status).json({ ok: false, target: TARGET_BASE, error: 'Target unreachable' });
  } finally {
    clearTimeout(timer);
  }
});

async function forward(req, res) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const targetUrl = buildTargetUrl(req.path, req.query);

    const headers = { Accept: 'application/json' };
    // Forward content-type for non-GETs
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const ct = req.get('content-type');
      if (ct) headers['Content-Type'] = ct;
    }

    const init = {
      method: req.method,
      headers,
      signal: controller.signal,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = req.body && Object.keys(req.body).length ? JSON.stringify(req.body) : undefined;
    }

    const resp = await fetch(targetUrl.toString(), init);
    const contentType = resp.headers.get('content-type') || '';
    res.status(resp.status);
    if (contentType.includes('application/json')) {
      const json = await resp.json().catch(() => null);
      if (!json) return res.json({ ok: false, error: 'Invalid JSON from enrichment service' });
      // Special handling: decorate prospects_window response with subject names
      if (req.method === 'GET' && req.path === '/prospects_window' && Array.isArray(json.rows)) {
        const decorated = await decorateProspectsWithNames(json);
        return res.json(decorated);
      }
      return res.json(json);
    }
    const text = await resp.text();
    res.set('Content-Type', contentType || 'text/plain');
    return res.send(text);
  } catch (err) {
    const status = err?.name === 'AbortError' ? 504 : 502;
    try {
      // Minimal diagnostic logging without leaking payloads
      console.warn('Enrichment proxy failed', {
        method: req.method,
        path: req.path,
        target: `${TARGET_BASE}/api/enrichment${req.path}`,
        status,
        error: err?.name || 'Error',
      });
    } catch {}
    // For prospects_window, fall back to local MongoDB so the page stays functional
    if (req.method === 'GET' && req.path === '/prospects_window') {
      try {
        const result = await fetchProspectsFromMongo(req.query);
        return res.json(result);
      } catch (dbErr) {
        console.warn('Prospects MongoDB fallback failed', dbErr?.message);
      }
    }
    return res.status(status).json({ ok: false, error: 'Enrichment service unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

// Generic proxy for any enrichment endpoint
r.all('*', forward);

export default r;

// -------- Helpers ---------

/**
 * Fallback: query local v2_* collections for recent booking candidates when the
 * enrichment service is unavailable. Returns a degraded-mode response shape.
 */
// NOTE: V2_CASE_COLLECTIONS is imported from shared helper.
// v2_fortbend_events does NOT exist — Fort Bend is in v2_lookup_results.

async function fetchProspectsFromMongo(query = {}) {
  const windowHours = Math.min(Number(query.windowHours) || 72, 168);
  const limit = Math.min(Number(query.limit) || 200, 500);
  const county = query.county ? String(query.county).toLowerCase() : null;

  const db = mongoose?.connection?.db;
  if (!db) throw new Error('Database not connected');

  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  const normalizeStages = buildNormalizeStages();
  const dateMatchStage = { $match: { booking_date_n: { $gte: cutoffStr } } };

  // If county filter provided, narrow to collection(s) for that county
  const V2_COUNTY_TO_COLLS = new Map([
    ['galveston',  ['v2_galveston_events']],
    ['harris',     ['v2_harris_reports']],
    ['fortbend',   ['v2_lookup_results']],
    ['jefferson',  ['v2_lookup_results', 'v2_jefferson_events']],
    ['brazoria',   ['v2_lookup_results']],
    ['wharton',    ['v2_wharton_events']],
  ]);

  let collectionsToQuery = V2_CASE_COLLECTIONS;
  if (county && V2_COUNTY_TO_COLLS.has(county)) {
    collectionsToQuery = V2_COUNTY_TO_COLLS.get(county);
  }

  const perCollPipeline = (collName) => [
    ...normalizeStages,
    buildCountyStage(collName),
    dateMatchStage,
  ];

  const [baseCollection, ...restCollections] = collectionsToQuery;
  const listPipeline = [
    ...perCollPipeline(baseCollection),
    ...restCollections.map((coll) => ({
      $unionWith: { coll, pipeline: perCollPipeline(coll) },
    })),
    { $sort: { booking_date_n: -1, _id: -1 } },
    { $limit: limit },
  ];

  let items = [];
  try {
    items = await db.collection(baseCollection).aggregate(listPipeline).toArray();
  } catch (e) {
    console.warn('[enrichmentProxy] fallback v2 aggregate failed:', e?.message);
  }

  return {
    ok: true,
    degraded: true,
    warning: 'Enrichment service unavailable. Showing raw unverified booking candidates from local data.',
    items,
    rows: [],
  };
}

async function fetchSubjectName(subjectId) {
  if (!subjectId) return null;
  const cached = getCachedName(subjectId);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const url = new URL('/api/enrichment/subject_summary', TARGET_BASE);
    url.searchParams.set('subjectId', String(subjectId));
    const resp = await fetch(url.toString(), { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!resp.ok) {
      setCachedName(subjectId, null);
      return null;
    }
    const data = await resp.json().catch(() => null);
    const name = data?.summary?.name || null;
    setCachedName(subjectId, name);
    return name;
  } catch {
    setCachedName(subjectId, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function decorateProspectsWithNames(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  if (!rows.length) return payload;

  // Unique subjectIds
  const ids = Array.from(new Set(rows.map((r) => r?.subjectId).filter(Boolean)));
  const nameMap = new Map();

  // Limit concurrency to avoid overwhelming the enrichment API
  const MAX_CONCURRENCY = 6;
  let idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const i = idx++;
      const id = ids[i];
      const name = await fetchSubjectName(id);
      nameMap.set(id, name);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, ids.length) }, () => worker());
  await Promise.all(workers);

  const newRows = rows.map((r) => ({ ...r, name: nameMap.get(r.subjectId) || r.name || null }));
  return { ...payload, rows: newRows };
}
