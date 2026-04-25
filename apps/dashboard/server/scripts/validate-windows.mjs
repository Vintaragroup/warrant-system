#!/usr/bin/env node
/*
 validate-windows.mjs
 Compares API-visible booking window counts with direct Mongo aggregation over time_bucket_v2.

 Requirements:
  - Server running with default v2 buckets (this is now automatic unless DISABLE_TIME_BUCKET_V2=true is set)
  - MONGO_URI / MONGO_DB env vars available (or pass via CLI)

 Usage:
   node scripts/validate-windows.mjs [--base http://localhost:8080/api] [--warnPct 1]

 Output:
   PASS/FAIL lines with delta counts and % diff; exits non-zero if any FAIL found.
*/
import process from 'node:process';
import mongoose from 'mongoose';

// ---------- CLI / Args ----------
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    args.set(k, v);
  }
}
const API_BASE = (args.get('base') || process.env.API_BASE || 'http://localhost:8080/api').replace(/\/$/, '');
const WARN_PCT = Number(args.get('warnPct') || 1); // acceptable % delta for race conditions
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || process.env.ATLAS_URI;
const MONGO_DB = process.env.MONGO_DB || process.env.MONGODB_DB || 'warrantdb';

if (!MONGO_URI) {
  console.error('Missing MONGO_URI env var. Exiting.');
  process.exit(2);
}

// ---------- Helpers ----------
async function getJSON(path, wantHeaders = false) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = await res.json();
  return wantHeaders ? { json, headers: res.headers } : json;
}

function pctDiff(a, b) {
  if (a === b) return 0;
  const denom = b === 0 ? (a === 0 ? 1 : a) : b;
  return ((a - b) / denom) * 100;
}

function passFail(label, expected, actual, meta = {}) {
  const diffPct = pctDiff(actual, expected);
  const within = Math.abs(diffPct) <= WARN_PCT;
  const status = within ? 'PASS' : 'FAIL';
  console.log(`${status} ${label} api=${actual} mongo=${expected} Δ=${(actual-expected)} (${diffPct.toFixed(2)}%)${meta.detail ? ' • ' + meta.detail : ''}`);
  return within;
}

// ---------- Main Flow ----------
(async () => {
  const started = Date.now();
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB, maxPoolSize: 5 });
  const db = mongoose.connection;

  // Preflight: confirm API is reachable before firing all requests
  async function waitForApi(base, attempts = 6, delayMs = 500) {
    const healthUrl = `${base}/health/light`;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await fetch(healthUrl, { method: 'GET' });
        if (r.ok) return true;
      } catch {}
      await new Promise(res => setTimeout(res, delayMs));
    }
    return false;
  }

  const apiOk = await waitForApi(API_BASE + '/dashboard'.replace(/\/dashboard$/, '')); // ensure base alive
  if (!apiOk) {
  console.error(`API not reachable at ${API_BASE}. Start server first (v2 buckets are default; set DISABLE_TIME_BUCKET_V2=true only to opt-out).`);
    process.exit(3);
  }

  // 1. Preflight: ensure API is actually in v2 bucket mode (diagnostic endpoint)
  let diagPref = null;
  try {
    diagPref = await getJSON('/dashboard/diag?window=24h');
  } catch (e) {
    console.error('Failed to fetch /dashboard/diag preflight:', e.message);
  }
  if (!diagPref || diagPref.mode !== 'v2_buckets') {
    console.error(`API not in v2_buckets mode (mode=${diagPref?.mode}). V2 is now the default; ensure you did NOT set DISABLE_TIME_BUCKET_V2=true.`);
    process.exit(4);
  }

  // Helper to build a union aggregation across all simple_* collections (mirrors API unionAllFast semantics for minimal fields)
  const COUNTY_COLLECTIONS = [
    'simple_brazoria',
    'simple_fortbend',
    'simple_galveston',
    'simple_harris',
    'simple_jefferson'
  ];
  const BASE = COUNTY_COLLECTIONS[0];
  const buckets = ['0_24h','24_48h','48_72h'];

  function unionPipeline(match, project) {
    const stages = [ { $match: match } ];
    if (project) stages.push({ $project: project });
    const unions = COUNTY_COLLECTIONS.slice(1).map(coll => ({
      $unionWith: {
        coll,
        pipeline: [ { $match: match }, ...(project ? [{ $project: project }] : []) ]
      }
    }));
    return stages.concat(unions);
  }

  // 2. Aggregate raw counts by bucket (across all counties)
  const byBucket = await db.collection(BASE).aggregate([
    ...unionPipeline({ time_bucket_v2: { $in: buckets } }, { time_bucket_v2: 1 }),
    { $group: { _id: '$time_bucket_v2', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  const bucketMap = Object.fromEntries(byBucket.map(r => [r._id, r.count]));
  buckets.forEach(b => { if (!bucketMap[b]) bucketMap[b] = 0; });

  // 3. Aggregate per-county counts by bucket
  const byCountyBucket = await db.collection(BASE).aggregate([
    ...unionPipeline({ time_bucket_v2: { $in: buckets } }, { county: 1, time_bucket_v2: 1 }),
    { $group: { _id: { county: '$county', bucket: '$time_bucket_v2' }, count: { $sum: 1 } } }
  ]).toArray();
  const countyBucketMap = new Map();
  byCountyBucket.forEach(r => {
    const county = (r._id?.county || '').toLowerCase();
    if (!countyBucketMap.has(county)) countyBucketMap.set(county, {});
    countyBucketMap.get(county)[r._id.bucket] = r.count;
  });

  // 4. Fetch APIs
  const [kpis, pc24H, pc48H, pc72H, top24, newResp, recentResp, diag7] = await Promise.all([
    getJSON('/dashboard/kpis'),
    getJSON('/dashboard/per-county?window=24h'),
    getJSON('/dashboard/per-county?window=48h'),
    getJSON('/dashboard/per-county?window=72h'),
    getJSON('/dashboard/top?window=24h&limit=10'),
    getJSON('/dashboard/new?scope=all&limit=50', true),
    getJSON('/dashboard/recent?limit=50', true),
    getJSON('/dashboard/diag?window=7d'),
  ]);
  const newList = newResp.json; const recentList = recentResp.json;
  const pc24 = pc24H; const pc48 = pc48H; const pc72 = pc72H;

  // 5. KPI comparisons (expected = mongo / bucketMap, actual = API kpis)
  let allPass = true;
  allPass &= passFail('KPI.today (0_24h)', bucketMap['0_24h'], Number(kpis?.newCountsBooked?.today || 0));
  allPass &= passFail('KPI.yesterday (24_48h)', bucketMap['24_48h'], Number(kpis?.newCountsBooked?.yesterday || 0));
  allPass &= passFail('KPI.twoDaysAgo (48_72h)', bucketMap['48_72h'], Number(kpis?.newCountsBooked?.twoDaysAgo || 0));

  // 6. Per-county comparisons: API puts bucket counts into counts.today/yesterday/twoDaysAgo depending on window param & bucket grouping logic
  function comparePerCounty(apiData, bucketKey, label) {
    const fieldMap = { '24h': 'today', '48h': 'yesterday', '72h': 'twoDaysAgo' };
    const metricField = fieldMap[label] || 'today';
    const items = Array.isArray(apiData?.items) ? apiData.items : [];
    items.forEach(it => {
      const county = (it.county || '').toLowerCase();
      const expected = (countyBucketMap.get(county) || {})[bucketKey] || 0;
      const apiValRaw = it?.counts?.[metricField];
      const apiVal = Number(apiValRaw || 0);
      const tag = `PerCounty.${label}.${county}`;
      allPass &= passFail(tag, expected, apiVal);
    });
  }
  comparePerCounty(pc24, '0_24h', '24h');
  comparePerCounty(pc48, '24_48h', '48h');
  comparePerCounty(pc72, '48_72h', '72h');

  // 7. List validations
  const newItems = Array.isArray(newList?.items) ? newList.items : (Array.isArray(newList) ? newList : []);
  const recentItems = Array.isArray(recentList?.items) ? recentList.items : (Array.isArray(recentList) ? recentList : []);
  const badNew = newItems.filter(it => it.time_bucket_v2 && it.time_bucket_v2 !== '0_24h');
  // recent fast path shows both 24_48h + 48_72h buckets; ensure no others.
  const badRecent = recentItems.filter(it => it.time_bucket_v2 && !['24_48h','48_72h'].includes(it.time_bucket_v2));
  if (badNew.length) { console.log(`FAIL New list has non 0_24h buckets: ${badNew.map(b=>b.time_bucket_v2).slice(0,5).join(',')}`); allPass = false; } else { console.log('PASS New list buckets all 0_24h'); }
  if (badRecent.length) { console.log(`FAIL Recent list has unexpected buckets: ${badRecent.map(b=>b.time_bucket_v2).slice(0,5).join(',')}`); allPass = false; } else { console.log('PASS Recent list buckets limited to 24_48h/48_72h'); }

  // 8b. Variant headers presence (best-effort; headers may be undefined in some proxy setups)
  const needVariant = (label, headers, key) => {
    const v = headers?.get(key);
    if (!v) { console.log(`FAIL Variant header missing: ${label} (${key})`); allPass = false; }
    else console.log(`PASS Variant header ${label}=${v}`);
  };
  try {
    needVariant('new', newResp.headers, 'x-new-variant');
    needVariant('recent', recentResp.headers, 'x-recent-variant');
  } catch (e) {
    console.log('WARN Unable to verify variant headers:', e.message);
  }

  // 8. Diagnostic coverage
  const coverage = diag7?.bucketCoverage;
  if (coverage && coverage.coverageRate === 1) {
    console.log('PASS Coverage 100% (bucketCoverage.coverageRate=1)');
  } else {
    console.log(`FAIL Coverage incomplete: ${JSON.stringify(coverage)}`); allPass = false;
  }

  // 9. Top list fallback logic sanity (if enriched object)
  if (top24?.mode === 'v2_buckets') {
    const items = Array.isArray(top24.items) ? top24.items : [];
    const hasFresh = items.some(i => i.time_bucket_v2 === '0_24h');
    if (!hasFresh && items.length) {
      console.log('INFO Top list (24h) has no 0_24h items; likely fallback window used (check window_used field).');
    } else {
      console.log('PASS Top list contains at least one 0_24h item or is empty.');
    }
  }

  const ms = Date.now() - started;
  console.log(`Finished in ${ms}ms`);
  if (!allPass) {
    console.error('One or more validations failed.');
    process.exit(1);
  }
  process.exit(0);
})().catch(err => {
  console.error('Unhandled validation error:', err);
  process.exit(2);
});
