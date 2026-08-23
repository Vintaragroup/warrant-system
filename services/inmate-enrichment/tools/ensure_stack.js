#!/usr/bin/env node
/*
Ensures Docker stack (mongo, mongo-setup, redis, api, worker) is up.
- If --rebuild is passed, rebuild api and worker images first.
- Waits for:
  - Docker daemon
  - redis, checked via `docker compose exec redis redis-cli ping` (redis is not
    published to the host — see docker-compose.yml — so a host-side TCP check
    to 127.0.0.1:6379 will never succeed even when the stack is healthy)
  - api on http://127.0.0.1:4000/health returning { ok: true }
Usage:
  npm run stack:up
  npm run stack:rebuild
*/
const { execSync, spawnSync } = require('node:child_process');
const http = require('http');

function sh(cmd, opts={}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts });
}

function dockerAvailable() {
  try {
    sh('docker info >/dev/null 2>&1');
    return true;
  } catch {
    return false;
  }
}

function composeUp(services, flags='-d') {
  const svc = services.length ? services.join(' ') : '';
  return sh(`docker compose up ${flags} ${svc}`);
}

function composeBuild(services) {
  const svc = services.length ? services.join(' ') : '';
  return sh(`docker compose build ${svc}`);
}

function waitTcp(host, port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryOnce(){
      const sock = new (require('net').Socket)();
      sock.setTimeout(1500);
      sock.on('connect', ()=>{ sock.destroy(); resolve(true); });
      sock.on('timeout', ()=>{ sock.destroy(); retry(); });
      sock.on('error', ()=>{ sock.destroy(); retry(); });
      function retry(){
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for ${host}:${port}`));
        setTimeout(tryOnce, 500);
      }
      sock.connect(port, host);
    })();
  });
}

function waitRedisInNetwork(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tryOnce(){
      try {
        const out = sh('docker compose exec -T redis redis-cli ping').trim();
        if (out === 'PONG') return resolve(true);
      } catch (e) { /* redis not ready yet, or container still starting */ }
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for redis (via docker compose exec)'));
      setTimeout(tryOnce, 500);
    })();
  });
}

function waitHealth(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tick(){
      const req = http.request(url, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(body || '{}');
            if (res.statusCode === 200 && json.ok === true) return resolve(true);
          } catch {}
          retry();
        });
      });
      req.on('error', retry);
      req.end();
      function retry(){
        if (Date.now() - start > timeoutMs) return reject(new Error(`Timeout waiting for health ${url}`));
        setTimeout(tick, 750);
      }
    })();
  });
}

async function main(){
  const rebuild = process.argv.includes('--rebuild');
  if (!dockerAvailable()) {
    console.error('Docker is not available. Please start Docker Desktop and re-run.');
    process.exit(1);
  }

  // Ensure base services are up
  console.log('Bringing up base services: mongo, mongo-setup, redis...');
  try { composeUp(['mongo','mongo-setup','redis']); } catch (e) { /* best-effort */ }

  if (rebuild) {
    console.log('Rebuilding images: api, worker...');
    try { composeBuild(['api','worker']); } catch (e) { console.warn('Build warning:', e.message || String(e)); }
  }

  console.log('Starting app services: api, worker...');
  try { composeUp(['api','worker']); } catch (e) { console.warn('Compose up warning:', e.message || String(e)); }

  // Redis is intentionally not published to the host (see docker-compose.yml) —
  // check readiness from inside the network via the api container instead of
  // localhost:6379, which never accepts external connections.
  console.log('Waiting for Redis (checked via `docker compose exec redis redis-cli ping`)...');
  try { await waitRedisInNetwork(30_000); } catch (e) { console.error(e.message); process.exit(1); }

  // Wait for API health on 4000
  console.log('Waiting for API health on http://127.0.0.1:4000/health ...');
  try { await waitHealth({ host: '127.0.0.1', port: 4000, path: '/health', method: 'GET' }, 60_000); } catch (e) { console.error(e.message); process.exit(1); }

  console.log('Stack is up and healthy.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
