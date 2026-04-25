#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  const suffix = process.argv[2];
  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }
  if (!suffix) {
    console.error('Usage: node tools/report_dob_batch_by_suffix.js <jobSuffix>');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  const jobs = mongoose.connection.db.collection('enrichment_jobs');

  const docs = await jobs.find({ jobId: new RegExp(`_dob-only_${suffix}$`) })
    .project({ jobId:1, subjectId:1, status:1, steps:1, updatedAt:1, createdAt:1 })
    .sort({ createdAt: -1 })
    .toArray();

  let succ = 0, fail = 0, part = 0;
  const rows = [];
  for (const d of docs) {
    if (d.status === 'SUCCEEDED') succ++; else if (d.status === 'FAILED') fail++; else part++;
    const step = (d.steps||[]).find(s=>s.name==='hcso_dob');
    rows.push({ jobId: d.jobId, subjectId: d.subjectId, status: d.status, hcso_dob: step?.status || 'N/A' });
  }

  console.log(JSON.stringify({ count: docs.length, succ, fail, part, rows: rows.slice(0, 25) }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('batch report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
