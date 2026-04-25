#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');

(async () => {
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  const COLLECTION = process.env.SUBJECTS_COLLECTION || 'inmates';
  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  const col = mongoose.connection.db.collection(COLLECTION);

  const FIELDS = [
    'booking_datetime', 'booking_at', 'booking_time', 'booking_date',
    'scraped_at', '_ingested_at', 'fetched_at', 'migrated_at', 'first_seen_at', 'inserted_at', 'detail_fetched_at'
  ];
  function parseTs(v) {
    if (v == null) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      const d0 = new Date(s);
      if (!isNaN(d0.getTime())) return d0;
      if (/^\d{10,13}$/.test(s)) {
        const n = Number(s);
        return new Date(s.length === 13 ? n : n * 1000);
      }
    }
    return null;
  }
  function bestTs(doc) {
    for (const f of FIELDS) {
      if (Object.prototype.hasOwnProperty.call(doc, f)) {
        const d = parseTs(doc[f]);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  const cutoff = dayjs().subtract(72, 'hour').toDate();
  // Pull a reasonable sample (recent docs by created/updated) and then filter by timestamp logic
  const rawDocs = await col.find({}, { projection: { dob: 1, spn: 1, subject_id: 1, subjectId: 1, booking_datetime: 1, booking_at: 1, booking_time: 1, booking_date: 1, scraped_at: 1, _ingested_at: 1, fetched_at: 1, migrated_at: 1, first_seen_at: 1, inserted_at: 1, detail_fetched_at: 1 } })
    .sort({ _id: -1 })
    .limit(2000)
    .toArray();

  const recent = rawDocs.filter(d => {
    const t = bestTs(d);
    return t && t >= cutoff;
  });

  let total = recent.length;
  let haveDob = 0;
  const missingSamples = [];
  for (const d of recent) {
    const dob = d.dob;
    const ok = dob != null && String(dob).trim() !== '';
    if (ok) haveDob++; else if (missingSamples.length < 10) {
      missingSamples.push({ id: String(d.spn || d.subject_id || d.subjectId || ''), ts: bestTs(d) });
    }
  }
  const pct = total > 0 ? Math.round((haveDob / total) * 1000) / 10 : 0;
  console.log(JSON.stringify({ windowHours: 72, total, haveDob, missing: total - haveDob, pct, missingSamples }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('coverage error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
