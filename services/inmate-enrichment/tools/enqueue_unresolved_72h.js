#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');

(async () => {
  const argv = process.argv.slice(2);
  const minBondArg = argv.find((a) => a.startsWith('--minBond='));
  const MIN_BOND = minBondArg ? Number(minBondArg.split('=')[1]) : 1000;
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  const COLLECTION = process.env.SUBJECTS_COLLECTION || 'inmates';
  const PORT = process.env.PORT || 4000;
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
  const docs = await col.find({}, { projection: { dob:1, spn:1, subject_id:1, subjectId:1, hcso_status:1, bond:1, bond_amount:1, ...Object.fromEntries(bookingFields.map(k=>[k,1])) } })
    .sort({ _id: -1 })
    .limit(30000)
    .toArray();

  const unresolved = [];
  for (const d of docs) {
    const b = bestBooking(d);
    if (!b || b < cutoff) continue;
    const dobOk = d.dob != null && String(d.dob).trim() !== '';
    const notIn = !!(d.hcso_status && d.hcso_status.notInJail);
    if (!dobOk && !notIn) {
      const bondVal = typeof d.bond_amount === 'number' ? d.bond_amount : (typeof d.bond === 'number' ? d.bond : 0);
      if (bondVal < MIN_BOND) continue;
      const spn = String(d.spn || d.subject_id || d.subjectId || '').trim();
      if (/^\d{6,10}$/.test(spn)) unresolved.push(spn);
    }
  }

  console.log(`Unresolved booking≤72h count (bond >= $${MIN_BOND}):`, unresolved.length);
  if (unresolved.length === 0) {
    await mongoose.disconnect();
    process.exit(0);
  }

  const base = `http://localhost:${PORT}/api`;
  const jobSuffix = Math.floor(Date.now() / 1000);
  const chunk = (arr, n) => arr.length ? [arr.slice(0, n), ...chunk(arr.slice(n), n)] : [];
  const chunks = chunk(unresolved, 50);
  let total = 0;
  for (const c of chunks) {
    const resp = await fetch(`${base}/enrichment/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectIds: c, mode: 'dob-only', force: true, jobSuffix })
    });
    const data = await resp.json();
    total += (data.jobIds || []).length;
  }
  console.log('Queued unresolved jobs:', total, 'suffix:', jobSuffix);

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('enqueue error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
