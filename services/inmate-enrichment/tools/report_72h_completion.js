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
  function bestBooking(doc) {
    for (const f of bookingFields) {
      if (Object.prototype.hasOwnProperty.call(doc, f)) {
        const d = parseTs(doc[f]);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  const cutoff = dayjs().subtract(72, 'hour').toDate();
  const docs = await col.find({}, { projection: { dob:1, spn:1, subject_id:1, subjectId:1, hcso_status:1, ...Object.fromEntries(bookingFields.map(k=>[k,1])) } })
    .sort({ _id: -1 })
    .limit(30000)
    .toArray();

  const recent = docs.filter(d => {
    const b = bestBooking(d);
    return b && b >= cutoff;
  });

  let haveDob = 0, notInJail = 0, unresolved = 0;
  const unresolvedIds = [];
  for (const d of recent) {
    const dobOk = d.dob != null && String(d.dob).trim() !== '';
    const notIn = !!(d.hcso_status && d.hcso_status.notInJail);
    if (dobOk) haveDob++; else if (notIn) notInJail++; else {
      unresolved++;
      if (unresolvedIds.length < 25) unresolvedIds.push(String(d.spn || d.subject_id || d.subjectId || ''));
    }
  }
  const total = recent.length;
  const pct = total ? Math.round(((haveDob + notInJail) / total) * 1000) / 10 : 0;
  console.log(JSON.stringify({ total, haveDob, notInJail, unresolved, pct, unresolvedIds }, null, 2));

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
