#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  const jobs = mongoose.connection.db.collection('enrichment_jobs');

  const since = new Date(Date.now() - 60 * 60 * 1000); // last 60 minutes
  const docs = await jobs.find({ createdAt: { $gte: since }, jobId: /_dob-only_/ })
    .project({ jobId:1, subjectId:1, status:1, steps:1, updatedAt:1, createdAt:1 })
    .sort({ createdAt: -1 })
    .limit(20)
    .toArray();

  let succeeded = 0, failed = 0, partial = 0;
  const rows = docs.map(d => {
    const step = (d.steps||[]).find(s=>s.name==='hcso_dob');
    const stepStatus = step ? step.status : 'N/A';
    if (d.status === 'SUCCEEDED') succeeded++; else if (d.status === 'FAILED') failed++; else partial++;
    return { jobId: d.jobId, subjectId: d.subjectId, status: d.status, hcso_dob: stepStatus };
  });

  console.log(JSON.stringify({ count: docs.length, succeeded, failed, partial, rows }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
