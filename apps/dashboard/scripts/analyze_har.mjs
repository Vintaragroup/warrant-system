#!/usr/bin/env node
// scripts/analyze_har.mjs
// Simple analyzer for Chrome "Save all as HAR with content" exports.
// Usage: node scripts/analyze_har.mjs path/to/network.har

import fs from 'node:fs';
import path from 'node:path';

function fmt(n) { return Number(n || 0).toLocaleString(); }
function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) + '%' : '0.0%'; }

function parseUrl(u) {
  try {
    const url = new URL(u);
    // Drop obvious cache-busters and noise
    const qp = new URLSearchParams(url.search);
    ['_', 'cb', 'cacheBust', 'cachebuster', '_cb'].forEach((k) => qp.delete(k));
    const clean = url.origin + url.pathname + (qp.toString() ? '?' + qp.toString() : '');
    return { origin: url.origin, path: url.pathname, url: clean };
  } catch { return { origin: '', path: u, url: u }; }
}

function summarize(entries) {
  const total = entries.length;
  const byCode = new Map();
  const byMethod = new Map();
  const preflights = entries.filter(e => (e.request?.method || '') === 'OPTIONS').length;
  const zeros = entries.filter(e => (e.response?.content?.size ?? 0) === 0).length;
  const times = entries.map(e => Number(e.time || 0)).filter(Number.isFinite).sort((a,b)=>a-b);

  const fail = [];
  const dupes = new Map();

  for (const e of entries) {
    const status = Number(e.response?.status || 0);
    const method = e.request?.method || '?';
    const url = e.request?.url || '';
    const { url: cleanUrl, path: p } = parseUrl(url);

    byCode.set(status, (byCode.get(status) || 0) + 1);
    byMethod.set(method, (byMethod.get(method) || 0) + 1);

    const k = `${method} ${cleanUrl}`;
    dupes.set(k, (dupes.get(k) || 0) + 1);

    if (!(status >= 200 && status < 300)) {
      fail.push({ status, method, url: cleanUrl, path: p, time: e.time || 0 });
    }
  }

  const ok2xx = Array.from(byCode).filter(([c]) => c >= 200 && c < 300).reduce((s, [,n]) => s+n, 0);
  const r3xx  = Array.from(byCode).filter(([c]) => c >= 300 && c < 400).reduce((s, [,n]) => s+n, 0);
  const c4xx  = Array.from(byCode).filter(([c]) => c >= 400 && c < 500).reduce((s, [,n]) => s+n, 0);
  const s5xx  = Array.from(byCode).filter(([c]) => c >= 500 && c < 600).reduce((s, [,n]) => s+n, 0);
  const other = total - ok2xx - r3xx - c4xx - s5xx;

  const pctIdx = (p) => times.length ? times[Math.min(times.length-1, Math.floor(p * times.length))] : 0;

  // Group top failing endpoints by path
  const failByPath = new Map();
  fail.forEach((e) => {
    const key = `${e.method} ${e.path}`;
    const entry = failByPath.get(key) || { count: 0, statuses: new Map(), maxTime: 0 };
    entry.count += 1;
    entry.statuses.set(e.status, (entry.statuses.get(e.status) || 0) + 1);
    entry.maxTime = Math.max(entry.maxTime, Number(e.time || 0));
    failByPath.set(key, entry);
  });

  const topFail = Array.from(failByPath.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([key, v]) => ({ key, count: v.count, maxTime: Math.round(v.maxTime), statuses: Array.from(v.statuses.entries()).map(([s,n]) => `${s}:${n}`).join(', ') }));

  // Duplicates (same method+URL after stripping cache buster)
  const topDupes = Array.from(dupes.entries())
    .filter(([,n]) => n > 1)
    .sort((a,b) => b[1]-a[1])
    .slice(0, 12)
    .map(([k, n]) => ({ key: k, count: n }));

  return {
    total,
    counts: { ok2xx, r3xx, c4xx, s5xx, other, preflights, zeros },
    methods: Object.fromEntries(byMethod),
    timing: {
      p50: Math.round(pctIdx(0.50)),
      p90: Math.round(pctIdx(0.90)),
      p95: Math.round(pctIdx(0.95)),
      max: Math.round(times[times.length - 1] || 0),
    },
    topFail,
    topDupes,
  };
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/analyze_har.mjs path/to/network.har');
    process.exit(1);
  }
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  let har;
  try { har = JSON.parse(raw); } catch (e) {
    console.error('Failed to parse HAR JSON:', e.message);
    process.exit(1);
  }
  const entries = har?.log?.entries || [];
  const report = summarize(entries);
  console.log('=== HAR Summary ===');
  console.log(`Total: ${fmt(report.total)} | 2xx: ${fmt(report.counts.ok2xx)} (${pct(report.counts.ok2xx, report.total)}) | 3xx: ${fmt(report.counts.r3xx)} | 4xx: ${fmt(report.counts.c4xx)} | 5xx: ${fmt(report.counts.s5xx)} | Other: ${fmt(report.counts.other)}`);
  console.log(`Preflights (OPTIONS): ${fmt(report.counts.preflights)} | Zero-byte responses: ${fmt(report.counts.zeros)}`);
  console.log('Methods:', report.methods);
  console.log('Timing (ms):', report.timing);
  if (report.topFail.length) {
    console.log('\nTop failing endpoints:');
    report.topFail.forEach((r) => console.log(`- ${r.key} • ${r.count}x • statuses[${r.statuses}] • slowest ${r.maxTime}ms`));
  }
  if (report.topDupes.length) {
    console.log('\nTop duplicate requests (same URL):');
    report.topDupes.forEach((r) => console.log(`- ${r.key} • ${r.count}x`));
  }
}

main();
