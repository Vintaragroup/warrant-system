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
  // Pull a recent-ish slice then filter by booking/window within 72h
  const CANDIDATE_FIELDS = [
    'booking_datetime', 'booking_at', 'booking_time', 'booking_date',
    'scraped_at', '_ingested_at', 'fetched_at', 'migrated_at', 'first_seen_at', 'inserted_at', 'detail_fetched_at'
  ];
  function parseTs(v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      // Try Date parse first
      const d0 = new Date(s);
      if (!isNaN(d0.getTime())) return d0;
      // Try common patterns
      const tryFormats = [
        'MM/DD/YYYY HH:mm:ss', 'MM/DD/YYYY', 'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD'
      ];
      // Fallback: numeric epoch string
      if (/^\d{10,13}$/.test(s)) {
        const n = Number(s);
        return new Date(s.length === 13 ? n : n * 1000);
      }
    }
    return null;
  }
  function bestTs(doc) {
    for (const f of CANDIDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(doc, f)) {
        const d = parseTs(doc[f]);
        if (d && !isNaN(d.getTime())) return d;
      }
    }
    return null;
  }
  const windowHours = 72;
  const cutoff = dayjs().subtract(windowHours, 'hour').toDate();
  const cursor = col.find({
    $and: [
      { $or: [ { dob: { $exists: false } }, { dob: null }, { dob: '' } ] },
      { $or: [ { spn: { $exists: true, $ne: '' } }, { subject_id: { $exists: true, $ne: '' } }, { subjectId: { $exists: true, $ne: '' } } ] },
    ],
  }).limit(300);
  const rawDocs = await cursor.toArray();
  const recentDocs = rawDocs.filter(d => {
    const t = bestTs(d);
    return t && t >= cutoff;
  });
  const idsSet = new Set();
  for (const d of recentDocs) {
    const spn = String(d.spn || d.subject_id || d.subjectId || '').trim();
    if (/^\d{6,10}$/.test(spn)) idsSet.add(spn);
    if (idsSet.size >= 20) break;
  }
  const subjectIds = Array.from(idsSet);
  console.log(`Candidate SPNs within ${windowHours}h (first 20):`, subjectIds);
  if (subjectIds.length === 0) {
    console.log('No candidates found with missing DOB.');
    process.exit(0);
  }
  const base = `http://localhost:${PORT}/api`;
  const resp = await fetch(`${base}/enrichment/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Keep force=true to allow 72h window here even if API window differs
    body: JSON.stringify({ subjectIds, mode: 'dob-only', force: true }),
  });
  const data = await resp.json();
  console.log('Queued Job IDs:', data.jobIds);
  if (data.jobIds && data.jobIds.length > 0) {
    const jobId = data.jobIds[0];
    console.log('Polling first job for status:', jobId);
    await new Promise(r => setTimeout(r, 5000));
    const st = await fetch(`${base}/enrichment/status?jobId=${encodeURIComponent(jobId)}`);
    const status = await st.json();
    console.log('Status:', status.status);
    console.log('Steps:', status.steps?.map(s => ({ name: s.name, status: s.status })));
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('Batch error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
