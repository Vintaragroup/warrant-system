/* eslint-env node */
import { Router } from 'express';
import mongoose from 'mongoose';
import {
  V2_CASE_COLLECTIONS,
  buildNormalizeStages,
  buildCountyStage,
} from '../lib/v2Collections.js';

const r = Router();

const ENRICHMENT_BASE = (process.env.ENRICHMENT_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = Number(process.env.REPORTS_ENRICHMENT_TIMEOUT_MS || 8000);

function matchesStatus(value, statuses = []) {
  if (!value) return false;
  const v = String(value).toLowerCase();
  return statuses.includes(v);
}

function hasTruthyField(row, fields = []) {
  return fields.some((field) => {
    const value = row?.[field];
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (typeof value === 'string' && value.trim()) return true;
    if (value && typeof value === 'object' && typeof value.count === 'number') return value.count > 0;
    return false;
  });
}

function isEnriched(row = {}) {
  if (hasTruthyField(row, ['enriched', 'isEnriched', 'hasEnrichment'])) return true;
  if (matchesStatus(row.enrichmentStatus, ['enriched', 'complete', 'done'])) return true;
  if (matchesStatus(row.status, ['enriched', 'enrichment_complete'])) return true;
  if (matchesStatus(row.enrichment?.status, ['enriched', 'complete', 'done'])) return true;
  return false;
}

function isTexted(row = {}) {
  if (hasTruthyField(row, ['texted', 'hasTexted', 'textedCount'])) return true;
  if (matchesStatus(row.outreachStatus, ['texted', 'sms_sent'])) return true;
  if (hasTruthyField(row.outreach || {}, ['texted', 'smsCount', 'lastTextAt'])) return true;
  if (row.lastTextAt || row.lastSmsAt) return true;
  return false;
}

function isResponded(row = {}) {
  if (hasTruthyField(row, ['responded', 'hasResponded', 'responseCount'])) return true;
  if (matchesStatus(row.outreachStatus, ['responded'])) return true;
  if (hasTruthyField(row.outreach || {}, ['responded', 'replyCount', 'lastResponseAt', 'lastReplyAt'])) return true;
  if (row.lastResponseAt || row.lastReplyAt) return true;
  return false;
}

async function fetchProspectsWindow(window = '7d') {
  if (!ENRICHMENT_BASE) {
    const err = new Error('ENRICHMENT_API_URL not configured');
    err.status = 503;
    throw err;
  }

  const url = new URL('/api/enrichment/prospects_window', ENRICHMENT_BASE);
  url.searchParams.set('window', window);
  // Provide a fallback param for services that expect `days`
  if (!url.searchParams.has('days')) url.searchParams.set('days', '7');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      const err = new Error(`Upstream responded ${resp.status}`);
      err.status = 502;
      throw err;
    }
    const data = await resp.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      const err = new Error('Invalid JSON from enrichment service');
      err.status = 502;
      throw err;
    }
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data) ? data : [];
    return { rows, source: url.toString() };
  } finally {
    clearTimeout(timer);
  }
}

// V2 collections list is imported from shared helper (V2_CASE_COLLECTIONS).
// NOTE: v2_fortbend_events does NOT exist — Fort Bend data is in v2_lookup_results.

async function fetchProspects7dFromMongo() {
  const db = mongoose?.connection?.db;
  if (!db) throw new Error('Database not connected');

  // Use normalization pipeline so booking_date_n is computed, then match >= 7 days ago.
  // This mirrors what the dashboard does and correctly handles all v2_* date field variants.
  const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10); // YYYY-MM-DD

  const normalizeStages = buildNormalizeStages();
  const dateMatchStage = { $match: { booking_date_n: { $gte: cutoffStr } } };

  const perCollPipeline = (collName) => [
    ...normalizeStages,
    buildCountyStage(collName),
    dateMatchStage,
  ];

  const [baseCollection, ...restCollections] = V2_CASE_COLLECTIONS;
  const countPipeline = [
    ...perCollPipeline(baseCollection),
    ...restCollections.map((coll) => ({
      $unionWith: { coll, pipeline: perCollPipeline(coll) },
    })),
    { $count: 'total' },
  ];

  try {
    const result = await db.collection(baseCollection).aggregate(countPipeline).toArray();
    return result[0]?.total ?? 0;
  } catch (e) {
    console.warn('[reports] v2 count aggregate failed:', e?.message);
    return 0;
  }
}

r.get('/prospects7d', async (_req, res) => {
  try {
    const { rows, source } = await fetchProspectsWindow('7d');
    const totalProspects7d = rows.length;
    const enrichedCount = rows.filter(isEnriched).length;
    const textedCount = rows.filter(isTexted).length;
    const respondedCount = rows.filter(isResponded).length;

    return res.json({
      ok: true,
      totalProspects7d,
      enrichedCount,
      textedCount,
      respondedCount,
      generatedAt: new Date().toISOString(),
      source,
    });
  } catch (err) {
    console.warn('[reports] Enrichment service unavailable, falling back to local Mongo:', err?.message);
    try {
      const totalProspects7d = await fetchProspects7dFromMongo();
      return res.json({
        ok: true,
        degraded: true,
        warning: 'Enrichment service unavailable. Showing raw booking counts from local data.',
        totalProspects7d,
        enrichedCount: null,
        textedCount: null,
        respondedCount: null,
        generatedAt: new Date().toISOString(),
      });
    } catch (dbErr) {
      const status = err?.status || 502;
      const message = err?.message || 'Unable to fetch prospect metrics';
      return res.status(status).json({ ok: false, error: 'PROSPECTS_METRICS_FAILED', message });
    }
  }
});

export default r;
