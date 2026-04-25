#!/usr/bin/env node
const http = require('http');

function request(path, method='GET', body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 4000, path, method, headers: { 'Content-Type': 'application/json' }}, res => {
      let data='';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body)); else req.end();
  });
}

(async () => {
  const health = await request('/health');
  if (health.status !== 200) throw new Error('Health check failed: ' + health.status);
  const rel = await request('/api/enrichment/related_party_pull', 'POST', { subjectId: '02991269', maxParties: 1, requireUnique: true, matchMin: 0.9 });
  console.log(JSON.stringify({ ok: true, health: health.status, related_party_pull: rel.status }));
})().catch(err => { console.error(err); process.exit(1); });
