#!/usr/bin/env node
/*
  Enqueue a micro-batch (default 5) of recent prospects into the enrichment queue.

  Usage:
    node tools/enqueue_micro_batch.js --count 5 --window 48 --minBond 500 --suffix test01

  It reads API base URL and optional bearer token from env:
    API_BASE (default http://localhost:4000/api)
    API_TOKEN (optional)
*/
const http = require('http');
const https = require('https');
const url = require('url');

function parseArgs(argv){
  const out = { count: 5, window: 48, minBond: 500 };
  for (let i=2;i<argv.length;i++){
    const a=argv[i], n=argv[i+1];
    if (a==='--count'||a==='-c'){ out.count = Math.max(1, Math.min(50, Number(n||5))); i++; }
    else if (a==='--window'||a==='-w'){ out.window = Math.max(1, Math.min(168, Number(n||48))); i++; }
    else if (a==='--minBond'||a==='-b'){ out.minBond = Math.max(0, Number(n||500)); i++; }
    else if (a==='--suffix'){ out.suffix = String(n||''); i++; }
  }
  return out;
}

function fetchJson(method, fullUrl, body, headers={}){
  return new Promise((resolve, reject) => {
    const u = url.parse(fullUrl);
    const isHttps = u.protocol === 'https:';
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = (isHttps?https:http).request({
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.path,
      headers: Object.assign({}, headers, data?{ 'Content-Type': 'application/json', 'Content-Length': data.length }:{}),
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(text)); } catch { resolve({ ok: true, text }); }
        } else {
          reject(new Error('HTTP '+res.statusCode+': '+text.slice(0, 500)));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const args = parseArgs(process.argv);
  const base = process.env.API_BASE || 'http://localhost:4000/api';
  const token = process.env.API_TOKEN || '';
  const hdrs = token ? { Authorization: 'Bearer '+token } : {};

  // Get prospects window-limited list to pick subjects
  const listUrl = `${base}/enrichment/prospects_window?windowHours=${encodeURIComponent(String(args.window))}&minBond=${encodeURIComponent(String(args.minBond))}&limit=${encodeURIComponent(String(args.count))}`;
  let list;
  try { list = await fetchJson('GET', listUrl, null, hdrs); } catch (e) { console.error('Failed to fetch prospects:', e.message); process.exit(2); }
  const ids = (list && Array.isArray(list.rows)) ? list.rows.map(r => String(r.subjectId)).filter(Boolean) : [];
  if (!ids.length) { console.error('No candidates found'); process.exit(3); }

  const body = { subjectIds: ids, mode: 'standard', jobSuffix: args.suffix || `micro_${Date.now()}` , windowHoursOverride: args.window, minBondOverride: args.minBond };
  const runUrl = `${base}/enrichment/run`;
  try {
    const resp = await fetchJson('POST', runUrl, body, hdrs);
    console.log(JSON.stringify({ ok: true, requested: ids, jobIds: resp.jobIds || [] }, null, 2));
  } catch (e) {
    console.error('Failed to enqueue:', e.message);
    process.exit(4);
  }
})();
