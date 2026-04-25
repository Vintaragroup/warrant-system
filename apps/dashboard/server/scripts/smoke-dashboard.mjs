#!/usr/bin/env node
import process from 'node:process';

// Usage examples:
//  BASE_URL=http://localhost:8080/api/dashboard node scripts/smoke-dashboard.mjs
//  AUTH_BEARER=eyJ... node scripts/smoke-dashboard.mjs
//  AUTH_COOKIE="__asap_session=..." node scripts/smoke-dashboard.mjs
//  node scripts/smoke-dashboard.mjs --base http://localhost:8080/api/dashboard --bearer $TOKEN
//  node scripts/smoke-dashboard.mjs --signin --email user@example.com --password '...' --apiKey $VITE_FIREBASE_API_KEY

const WINDOWS = ['24h','48h','72h','7d','30d'];

// Simple args parser
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    args.set(k, v);
  }
}

const BASE = (args.get('base') || process.env.BASE_URL || 'http://localhost:8080/api/dashboard').replace(/\/$/, '');
let AUTH_BEARER = args.get('bearer') || process.env.AUTH_BEARER || '';
let AUTH_COOKIE = args.get('cookie') || process.env.AUTH_COOKIE || '';

// Optional Firebase email/password sign-in to obtain ID token via REST
async function signInWithEmailPassword() {
  const doSignin = args.get('signin') === 'true' || args.get('signin') === true || process.env.AUTH_SIGNIN === 'true';
  const email = args.get('email') || process.env.AUTH_EMAIL;
  const password = args.get('password') || process.env.AUTH_PASSWORD;
  const apiKey = args.get('apiKey') || process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY;
  if (!doSignin) return;
  if (!email || !password || !apiKey) {
    console.error('signin requested but missing email/password/apiKey');
    return;
  }
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    console.error(`Failed to sign in: ${res.status} ${res.statusText} ${text}`);
    return;
  }
  const json = await res.json();
  if (json.idToken) {
    AUTH_BEARER = json.idToken;
    console.log('Signed in and obtained ID token.');
  }
}

function authHeaders() {
  const headers = {};
  if (AUTH_BEARER) headers['Authorization'] = `Bearer ${AUTH_BEARER}`;
  if (AUTH_COOKIE) headers['Cookie'] = AUTH_COOKIE;
  return headers;
}

async function fetchJson(path) {
  const url = `${BASE}${path}`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: authHeaders() }).catch((e) => ({ ok: false, status: 0, error: e }));
  const dt = Date.now() - t0;
  if (!res.ok) {
    console.error(`[FAIL] ${path} status=${res.status} time=${dt}ms`);
    return { ok: false, status: res.status };
  }
  const json = await res.json();
  console.log(`[OK] ${path} ${dt}ms countHints:`, Object.keys(json).filter((k) => /count|total/i.test(k)).reduce((m, k) => (m[k] = json[k], m), {}));
  return { ok: true, json, ms: dt };
}

async function main() {
  await signInWithEmailPassword();
  const out = { kpis: null, perCounty: {}, new: null, recent: null, diag: {} };
  out.kpis = await fetchJson('/kpis');
  out.new = await fetchJson('/new');
  out.recent = await fetchJson('/recent');
  for (const w of WINDOWS) {
    out.perCounty[w] = await fetchJson(`/per-county?window=${w}`);
    out.diag[w] = await fetchJson(`/diag?window=${w}`);
  }
  // Basic sanity warnings
  const diag24 = out.diag['24h'];
  if (diag24?.json) {
    if (typeof diag24.json.count !== 'number') console.warn('WARN: /diag 24h missing numeric count');
  }
  // Summaries
  console.log('\nSUMMARY');
  console.log(' base:', BASE);
  console.log(' authed:', Boolean(AUTH_BEARER || AUTH_COOKIE));
  console.log(' mode:', out.kpis?.json?.mode);
  console.log(' kpis newCountsBooked:', out.kpis?.json?.newCountsBooked);
  console.log(' per-county 24h sample:', out.perCounty['24h']?.json?.items?.slice(0, 2));
  console.log(' diag buckets 24h:', out.diag['24h']?.json?.bucketDist);
  // Exit code logic
  const failures = [out.kpis, out.new, out.recent, ...Object.values(out.perCounty), ...Object.values(out.diag)].filter((r) => !r?.ok).length;
  if (failures) {
    console.error(`Smoke test completed with ${failures} request failures.`);
    process.exitCode = 2;
  } else {
    console.log('Smoke test completed successfully.');
  }
}

main().catch((e) => {
  console.error('Smoke test crashed', e);
  process.exit(1);
});
