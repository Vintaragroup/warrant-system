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
  const col = mongoose.connection.db.collection(COLLECTION);
  const since = new Date(Date.now() - 6 * 3600 * 1000);
  const docs = await col.find({ 'hcso_status.notInJail': true, updatedAt: { $gte: since } }, { projection: { spn:1, subject_id:1, subjectId:1, hcso_status:1, updatedAt:1 } })
    .sort({ updatedAt: -1 })
    .limit(25)
    .toArray();
  const count = await col.countDocuments({ 'hcso_status.notInJail': true });
  console.log(JSON.stringify({ totalFlagged: count, recent: docs }, null, 2));
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('report error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
