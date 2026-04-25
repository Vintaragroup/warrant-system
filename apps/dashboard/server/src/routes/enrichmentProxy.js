import { Router } from 'express';

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
    return res.status(status).json({ ok: false, error: 'Enrichment service unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

// Generic proxy for any enrichment endpoint
r.all('*', forward);

export default r;

// -------- Helpers ---------

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
