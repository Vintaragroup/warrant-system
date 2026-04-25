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
  const rawDocs = await col.find({}, { projection: { _id: 0 } }).sort({ _id: -1 }).limit(1500).toArray();
  const recent = rawDocs.filter(d => {
    const t = bestTs(d);
    return t && t >= cutoff;
  });

  const dobLikeKeys = new Set();
  for (const d of recent) {
    for (const k of Object.keys(d)) {
      if (/dob|birth|bdate|date_of_birth/i.test(k)) dobLikeKeys.add(k);
    }
  }
  console.log('DOB-like keys observed in recent 72h:', Array.from(dobLikeKeys));

  // Show sample values for those keys
  const samples = [];
  for (const d of recent) {
    const entry = {};
    for (const k of dobLikeKeys) {
      if (d[k] != null) entry[k] = d[k];
    }
    if (Object.keys(entry).length) {
      samples.push(entry);
      if (samples.length >= 5) break;
    }
  }
  console.log('Sample values (up to 5 docs):', samples);

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('inspect error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
