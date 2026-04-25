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
  const db = mongoose.connection.db;
  const raw = db.collection('raw_provider_payloads');
  const jobs = db.collection('enrichment_jobs');
  const since = new Date(Date.now() - 6 * 3600 * 1000);

  const docs = await raw.aggregate([
    { $match: { provider: 'hcso', step: 'hcso_dob', createdAt: { $gte: since } } },
    { $sort: { createdAt: -1 } },
    { $limit: 10 },
    { $lookup: { from: 'enrichment_jobs', localField: 'jobId', foreignField: 'jobId', as: 'job' } },
    { $unwind: { path: '$job', preserveNullAndEmptyArrays: true } },
    { $project: { jobId: 1, createdAt: 1, subjectId: '$job.subjectId', payload: 1 } }
  ]).toArray();

  for (const d of docs) {
    const p = d.payload || {};
    const hasDob = !!p.dob;
    const snip = (p.rawHtmlSnippet || '').replace(/\s+/g, ' ').slice(0, 240);
    console.log({ jobId: d.jobId, subjectId: d.subjectId, hasDob, url: p.url, snippet: snip });
  }

  console.log('Total recent HCSO payloads:', docs.length);
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('dump error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
