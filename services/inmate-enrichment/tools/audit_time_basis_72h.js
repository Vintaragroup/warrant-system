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

  const bookingFields = ['booking_datetime','booking_at','booking_time','booking_date'];
  const ingestFields = ['scraped_at','_ingested_at','fetched_at','migrated_at','first_seen_at','inserted_at','detail_fetched_at'];

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
  function best(doc, fields) {
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(doc, f)) {
        const d = parseTs(doc[f]);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  const cutoff = dayjs().subtract(72, 'hour').toDate();
  const docs = await col.find({}, { projection: { dob:1, spn:1, subject_id:1, subjectId:1, ...Object.fromEntries([...bookingFields, ...ingestFields].map(k=>[k,1])) } })
    .sort({ _id: -1 })
    .limit(3000)
    .toArray();

  const recentByBooking = [];
  const recentByIngest = [];
  for (const d of docs) {
    const b = best(d, bookingFields);
    const i = best(d, ingestFields);
    if (b && b >= cutoff) recentByBooking.push({ d, t:b });
    if (i && i >= cutoff) recentByIngest.push({ d, t:i });
  }

  const uniq = (arr) => Array.from(new Set(arr.map(x => String(x.d.spn || x.d.subject_id || x.d.subjectId || ''))));
  const idsBooking = new Set(uniq(recentByBooking));
  const idsIngest = new Set(uniq(recentByIngest));
  const onlyBooking = Array.from(idsBooking).filter(x => !idsIngest.has(x));
  const onlyIngest = Array.from(idsIngest).filter(x => !idsBooking.has(x));
  const both = Array.from(idsBooking).filter(x => idsIngest.has(x));

  console.log(JSON.stringify({
    counts: {
      bookingWithin72h: idsBooking.size,
      ingestWithin72h: idsIngest.size,
      overlap: both.length,
      onlyBooking: onlyBooking.length,
      onlyIngest: onlyIngest.length
    },
    samples: {
      onlyBooking: onlyBooking.slice(0,10),
      onlyIngest: onlyIngest.slice(0,10),
      both: both.slice(0,10)
    }
  }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('audit error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
