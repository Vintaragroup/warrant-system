import { Router } from 'express';
import mongoose from 'mongoose';
import { getRedisConnection } from '../lib/redis.js';
import { getLastGpsJobHeartbeat } from '../jobs/checkins.js';

const r = Router();

const MAX_DB_MS = 2000; // tighter bounds to avoid infra health probe timeouts
const HEALTH_OVERALL_BUDGET_MS = 1500; // total time budget for /api/health handler

// Small helper to add a timeout to any promise-returning DB operation so
// health/trends endpoints don't hang indefinitely when Atlas is slow.
function withTimeout(promise, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('operation timed out')), ms)),
  ]);
}

// GET /health — pings MongoDB and summarizes simple_* collections
r.get('/', async (req, res) => {
  const started = Date.now();
  try {
    const conn = mongoose.connection;
    if (!conn || !conn.db) {
      // For health consumers, respond 200 with ok:false so platform doesn't kill the container during transient states
      return res.status(200).json({ ok: false, error: 'DB not configured', ts: new Date().toISOString() });
    }

    const verbose = String(req.query.verbose || '').toLowerCase() === '1' || String(req.query.v || '').toLowerCase() === '1';
    const timeLeft = () => Math.max(0, HEALTH_OVERALL_BUDGET_MS - (Date.now() - started));

    // 1) Ping DB
  const pingStart = Date.now();
  await withTimeout(conn.db.admin().command({ ping: 1 }), Math.min(MAX_DB_MS, timeLeft() || 1));
  const pingMs = Date.now() - pingStart;

    // If we're not in verbose mode and we're close to the budget, return immediately
    if (!verbose && (Date.now() - started) >= HEALTH_OVERALL_BUDGET_MS) {
      return res.json({ ok: true, uptime_ms: Date.now() - started, db: { ping_ms: pingMs, status: 'ok' }, ts: new Date().toISOString() });
    }

    // 2) Inspect key collections (skippable/heavy)
    const names = [
      'simple_harris',
      'simple_brazoria',
      'simple_galveston',
      'simple_fortbend',
      'simple_jefferson',
    ];

    const details = {};
    for (const name of names) {
      // Respect overall time budget in non-verbose mode
      if (!verbose && timeLeft() < 200) break;
      try {
        const col = conn.db.collection(name);

        // counts — guard each call with maxTimeMS and a global timeout
        const budget = Math.max(200, timeLeft());
        const [count, latestNorm, latestBook] = await Promise.all([
          withTimeout(col.estimatedDocumentCount(), Math.min(MAX_DB_MS, budget)),
          withTimeout(col
            .find({ normalized_at: { $exists: true } }, { projection: { normalized_at: 1 } })
            .sort({ normalized_at: -1 })
            .limit(1)
            .maxTimeMS(1000)
            .toArray(), Math.min(MAX_DB_MS, budget)),
          withTimeout(col
            .find({ booking_date: { $exists: true } }, { projection: { booking_date: 1 } })
            .sort({ booking_date: -1 }) // YYYY-MM-DD strings sort correctly
            .limit(1)
            .maxTimeMS(1000)
            .toArray(), Math.min(MAX_DB_MS, budget)),
        ]).catch(() => [0, [], []]);

        // light-weight field parity checks against our simple_* spec
        const required = [
          'case_number', 'charge', 'status', 'race', 'sex',
          'booking_date', 'time_bucket', 'tags', 'bond', 'bond_amount', 'bond_label', 'full_name',
        ];
        const missingCounts = {};
        // Cap missingCounts checks to a subset to keep this endpoint snappy under load
        const subset = required.slice(0, verbose ? 6 : 2);
        await Promise.all(
          subset.map(async (f) => {
            if (!verbose && timeLeft() < 150) return; // skip if budget is nearly exhausted
            const q = col.countDocuments({ [f]: { $exists: false } });
            const qq = q.maxTimeMS ? q.maxTimeMS(750) : q;
            missingCounts[f] = await withTimeout(qq, Math.min(MAX_DB_MS, timeLeft() || 1)).catch(() => -1);
          }),
        );

        // anchor format audit (minimal, only for our standardized pairs)
        let anchorAudit = null;
        if (verbose && timeLeft() >= 250) {
          if (name === 'simple_jefferson') {
            // Jefferson anchors should be URLs
            anchorAudit = await withTimeout(col.countDocuments({ "_upsert_key.anchor": { $not: /^http/ } }), Math.min(1000, timeLeft())).catch(() => -1);
          } else if (name === 'simple_harris') {
            // Harris anchors should be all digits (case_number)
            anchorAudit = await withTimeout(col.countDocuments({ "_upsert_key.anchor": { $not: /^\d+$/ } }), Math.min(1000, timeLeft())).catch(() => -1);
          }
        }

        details[name] = {
          count,
          latest_normalized_at: latestNorm?.[0]?.normalized_at || null,
          latest_booking_date: latestBook?.[0]?.booking_date || null,
          missing: missingCounts,
          anchor_audit: anchorAudit,
        };
      } catch {
        details[name] = { count: 0, latest_normalized_at: null, latest_booking_date: null, error: 'unavailable' };
      }
    }

  // 3) Basic warnings (may be partial if we exited early on some collections)
  const warnings = [];

    for (const [k, v] of Object.entries(details)) {
      if ((v?.count ?? 0) === 0) warnings.push(`${k} has zero documents`);
      // flag if booking_date looks stale (older than 3 days)
      if (v?.latest_booking_date) {
        const ageDays = Math.floor((Date.now() - Date.parse(v.latest_booking_date)) / (1000 * 60 * 60 * 24));
        if (ageDays > 3) warnings.push(`${k} latest booking_date is ${ageDays}d old (${v.latest_booking_date})`);
      }
      // flag if any key fields are missing
      const missing = v?.missing ?? {};
      const missingKeys = Object.entries(missing).filter(([, n]) => n > 0).map(([f, n]) => `${f}:${n}`);
      if (missingKeys.length) warnings.push(`${k} missing fields -> ${missingKeys.join(', ')}`);
      if (typeof v.anchor_audit === 'number' && v.anchor_audit > 0) {
        warnings.push(`${k} has ${v.anchor_audit} nonconforming anchors`);
      }
    }

    let redisInfo = { status: 'unavailable' };
    try {
      const redis = getRedisConnection();
      const pingStart = Date.now();
      await withTimeout(redis.ping(), Math.min(1000, timeLeft() || 1000));
      redisInfo = { status: 'ok', ping_ms: Date.now() - pingStart };
    } catch (err) {
      redisInfo = { status: 'error', error: err?.message || 'redis_ping_failed' };
    }

    const gpsHeartbeat = getLastGpsJobHeartbeat();
    const lastJobDate = gpsHeartbeat.lastJobAt ? new Date(gpsHeartbeat.lastJobAt) : null;
    const gpsInfo = {
      last_job_at: gpsHeartbeat.lastJobAt || null,
      age_seconds: lastJobDate && !Number.isNaN(lastJobDate.getTime())
        ? Math.floor((Date.now() - lastJobDate.getTime()) / 1000)
        : null,
      meta: gpsHeartbeat.lastJobMeta || null,
    };

    res.json({
      ok: true,
      uptime_ms: Date.now() - started,
      db: { ping_ms: pingMs, status: 'ok' },
      collections: details,
      warnings,
      verbose,
      budget_ms: HEALTH_OVERALL_BUDGET_MS,
      queues: {
        redis: redisInfo,
        gps: gpsInfo,
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /health error:', err);
    // Avoid failing platform probes: return 200 with ok:false so the service remains up while signaling an issue
    res.status(200).json({ ok: false, error: 'DB health check failed', ts: new Date().toISOString() });
  }
});

// --- KPI & Trends endpoints (normalized booking_date & bond_amount) ---

// Helper to get YYYY-MM-DD for UTC today +/- offset days
function dOffset(days = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Build the union pipeline across simple_* collections (anchor will be simple_harris)
function unionSimple(match = {}, project = null) {
  const base = [{ $match: match }];
  if (project) base.push({ $project: project });

  const mk = (coll) => ({ $unionWith: { coll, pipeline: base } });

  return [
    mk('simple_brazoria'),
    mk('simple_galveston'),
    mk('simple_fortbend'),
    mk('simple_jefferson'),
  ];
}

// GET /dashboard/kpis — high-level counts/sums for header widgets
r.get('/kpis', async (req, res) => {
  try {
    const conn = mongoose.connection;
    if (!conn || !conn.db) {
      return res.status(503).json({ ok: false, error: 'DB not configured', ts: new Date().toISOString() });
    }
    const today = dOffset(0);
    const yesterday = dOffset(-1);
    const twoDaysAgo = dOffset(-2);
    const sevenDaysAgo = dOffset(-7);

    const matchWindow7d = { booking_date: { $gte: sevenDaysAgo, $lte: today } };
    const proj = { booking_date: 1, county: 1, bond_amount: 1 };

    const pipeline = [
      { $match: matchWindow7d }, // anchor: simple_harris
      ...unionSimple(matchWindow7d, proj),
      { $project: { booking_date: 1, county: 1, bond_amount: { $ifNull: ['$bond_amount', 0] } } },
    ];

    // Run against simple_harris as the anchor for the union pipeline
  const anchor = conn.db.collection('simple_harris');
  const aggAnchor = anchor.aggregate(pipeline);
  const anchorCursor = aggAnchor.maxTimeMS ? aggAnchor.maxTimeMS(MAX_DB_MS) : aggAnchor;
  const docs = await withTimeout(anchorCursor.toArray(), MAX_DB_MS).catch(() => []);

    const bucket = (from, to) => docs.filter(d => d.booking_date >= from && d.booking_date <= to);

    const todayDocs = bucket(today, today);
    const yDocs = bucket(yesterday, yesterday);
    const last72Docs = bucket(twoDaysAgo, today); // inclusive 72h (today + prev 2 days)
    const last7Docs = bucket(sevenDaysAgo, today);

    const sum = arr => arr.reduce((acc, x) => acc + (Number(x.bond_amount) || 0), 0);

    // Top counties by bond in last 24h
    const top24 = {};
    for (const d of todayDocs) {
      const k = d.county || 'unknown';
      if (!top24[k]) top24[k] = { county: k, count: 0, bond_sum: 0 };
      top24[k].count += 1;
      top24[k].bond_sum += Number(d.bond_amount) || 0;
    }
    const topCounties24h = Object.values(top24)
      .sort((a, b) => b.bond_sum - a.bond_sum)
      .slice(0, 5);

    res.json({
      ok: true,
      today: { count: todayDocs.length, bond_sum: sum(todayDocs) },
      yesterday: { count: yDocs.length, bond_sum: sum(yDocs) },
      last72h: { count: last72Docs.length, bond_sum: sum(last72Docs) },
      last7d: { count: last7Docs.length, bond_sum: sum(last7Docs) },
      topCounties24h,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('GET /dashboard/kpis error:', err);
    res.status(500).json({ ok: false, error: 'Failed to compute KPIs' });
  }
});

// GET /dashboard/trends?days=14 — daily counts/sums for last N days
r.get('/trends', async (req, res) => {
  try {
    const conn = mongoose.connection;
    if (!conn || !conn.db) {
      return res.status(503).json({ ok: false, error: 'DB not configured', ts: new Date().toISOString() });
    }
    const days = Math.max(1, Math.min(60, Number(req.query.days ?? 14)));
    const start = dOffset(-days + 1); // inclusive start
    const end = dOffset(0);

    const matchRange = { booking_date: { $gte: start, $lte: end } };
    const proj = { booking_date: 1, bond_amount: 1 };

    const pipeline = [
      { $match: matchRange }, // anchor: simple_harris
      ...unionSimple(matchRange, proj),
      { $project: { booking_date: 1, bond_amount: { $ifNull: ['$bond_amount', 0] } } },
      { $group: { _id: '$booking_date', count: { $sum: 1 }, bond_sum: { $sum: '$bond_amount' } } },
      { $project: { _id: 0, date: '$_id', count: 1, bond_sum: 1 } },
      { $sort: { date: 1 } },
    ];

  const anchor = conn.db.collection('simple_harris');
  const aggSeries = anchor.aggregate(pipeline);
  const seriesCursor = aggSeries.maxTimeMS ? aggSeries.maxTimeMS(MAX_DB_MS) : aggSeries;
  const series = await withTimeout(seriesCursor.toArray(), MAX_DB_MS).catch(() => []);

    res.json({ ok: true, start, end, series, ts: new Date().toISOString() });
  } catch (err) {
    console.error('GET /dashboard/trends error:', err);
    res.status(500).json({ ok: false, error: 'Failed to compute trends' });
  }
});

// GET /dashboard/buckets — distribution of time_bucket_v2 across all simple_* (public health diagnostic)
r.get('/buckets', async (req, res) => {
  try {
    const conn = mongoose.connection;
    if (!conn || !conn.db) {
      return res.status(503).json({ ok: false, error: 'DB not configured', ts: new Date().toISOString() });
    }
    const pipeline = [
      // Anchor on simple_harris and union others with only the bucket field
      ...unionSimple({}, { time_bucket_v2: 1 }),
      { $group: { _id: '$time_bucket_v2', n: { $sum: 1 } } },
      { $project: { _id: 0, bucket: '$_id', n: 1 } },
      { $sort: { bucket: 1 } },
    ];
    const anchor = conn.db.collection('simple_harris');
    const agg = anchor.aggregate(pipeline);
    const cursor = agg.maxTimeMS ? agg.maxTimeMS(MAX_DB_MS) : agg;
    const rows = await withTimeout(cursor.toArray(), MAX_DB_MS).catch(() => []);
    res.json({ ok: true, buckets: rows, ts: new Date().toISOString() });
  } catch (err) {
    console.error('GET /dashboard/buckets error:', err);
    res.status(500).json({ ok: false, error: 'Failed to aggregate buckets' });
  }
});

export default r;
