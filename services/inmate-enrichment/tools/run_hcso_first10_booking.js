#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');

(async () => {
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
  const rawDocs = await col.find({}, { projection: { dob: 1, spn:1, subject_id:1, subjectId:1, ...Object.fromEntries(bookingFields.map(k=>[k,1])) } })
    .sort({ _id: -1 })
    .limit(3000)
    .toArray();
  const filtered = rawDocs.filter(d => {
    const b = bestBooking(d);
    const hasDob = d.dob != null && String(d.dob).trim() !== '';
    return b && b >= cutoff && !hasDob;
  });

  const subjectIds = [];
  for (const d of filtered) {
    const spn = String(d.spn || d.subject_id || d.subjectId || '').trim();
    if (/^\d{6,10}$/.test(spn)) subjectIds.push(spn);
    if (subjectIds.length >= 10) break;
  }

  console.log('First 10 by booking<=72h and missing dob:', subjectIds);
  if (subjectIds.length === 0) {
    console.log('No candidates found.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const base = `http://localhost:${PORT}/api`;
  const jobSuffix = Math.floor(Date.now() / 1000);
  const resp = await fetch(`${base}/enrichment/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectIds, mode: 'dob-only', force: true, jobSuffix })
  });
  const data = await resp.json();
  console.log('Queued Job IDs:', data.jobIds);

  // Poll a couple statuses for visibility
  if (data.jobIds && data.jobIds.length > 0) {
    await new Promise(r => setTimeout(r, 5000));
    for (const jobId of data.jobIds.slice(0, 3)) {
      const st = await fetch(`${base}/enrichment/status?jobId=${encodeURIComponent(jobId)}`);
      const status = await st.json();
      console.log(jobId, '=>', { status: status.status, step: (status.steps||[]).find(s=>s.name==='hcso_dob')?.status });
    }
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('first10 error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
