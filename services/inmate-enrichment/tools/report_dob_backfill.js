#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  const COLLECTION = process.env.SUBJECTS_COLLECTION || 'inmates';
  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  const db = mongoose.connection.db;
  const col = db.collection(COLLECTION);
  const jobs = db.collection('enrichment_jobs');

  // Find jobs we queued in dob-only mode recently (default last 6h; override via REPORT_WINDOW_HOURS or CLI arg)
  const hours = Number(process.env.REPORT_WINDOW_HOURS || process.argv[2] || 6);
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const recentJobs = await jobs.find({ createdAt: { $gte: since }, 'steps.name': 'hcso_dob' }).project({ jobId: 1, subjectId: 1, steps: 1, status: 1 }).toArray();
  const subjects = recentJobs.map(j => j.subjectId);

  // For those subjects, check if dob exists now
  const docs = await col.find({ $or: [ { spn: { $in: subjects } }, { subject_id: { $in: subjects } }, { subjectId: { $in: subjects } } ] }, { projection: { spn: 1, subject_id: 1, subjectId: 1, dob: 1 } }).toArray();
  const byId = new Map();
  for (const d of docs) {
    const id = String(d.spn || d.subject_id || d.subjectId);
    byId.set(id, d);
  }
  let succeeded = 0, failed = 0, partial = 0;
  const samples = [];
  for (const j of recentJobs) {
    const s = byId.get(String(j.subjectId));
    const dobSet = s && s.dob && String(s.dob).trim() !== '';
    const step = (j.steps || []).find(s => s.name === 'hcso_dob');
    const stepStatus = step ? step.status : 'UNKNOWN';
    if (dobSet) {
      succeeded++;
      if (samples.length < 5) samples.push({ subjectId: j.subjectId, dob: s.dob });
    } else if (stepStatus === 'FAILED') {
      failed++;
    } else {
      partial++;
    }
  }

  console.log(JSON.stringify({ totalJobs: recentJobs.length, succeeded, failed, partial, samples }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('Report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
