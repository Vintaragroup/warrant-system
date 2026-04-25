#!/usr/bin/env node
import process from 'node:process';

// Quick unauthenticated health checks for API server
// Usage: node scripts/smoke-health.mjs [--base http://localhost:8080]

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const [k, v = 'true'] = a.replace(/^--/, '').split('='); args.set(k, v); }
}
const BASE = (args.get('base') || process.env.API_BASE || 'http://localhost:8080').replace(/\/$/, '');

async function check(path) {
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  const res = await fetch(url).catch((e) => ({ ok: false, status: 0, error: e }));
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.error(`[FAIL] ${path} status=${res.status} ${res.statusText || ''} ${ms}ms`);
    return false;
  }
  try { await res.json(); } catch {}
  console.log(`[OK] ${path} ${ms}ms`);
  return true;
}

(async () => {
  const results = await Promise.all([
    check('/api/health'),
    check('/api/health/light'),
    check('/api/docs.json'),
  ]);
  const ok = results.every(Boolean);
  if (!ok) process.exit(2);
  console.log('Health smoke completed successfully.');
})();
