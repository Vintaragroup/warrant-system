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

  const ids = [
    '03243539_dob-only','02843696_dob-only','01659635_dob-only','03299840_dob-only','03266697_dob-only',
    '01980089_dob-only','03309389_dob-only','03297826_dob-only','02695265_dob-only','02429739_dob-only'
  ];
  const docs = await jobs.find({ jobId: { $in: ids } }).project({ jobId:1, subjectId:1, status:1, steps:1, updatedAt:1 }).toArray();

  const summary = docs.map(d => ({ jobId: d.jobId, status: d.status, step: (d.steps||[]).find(s=>s.name==='hcso_dob')?.status || 'N/A' }));
  console.log(JSON.stringify(summary, null, 2));

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
