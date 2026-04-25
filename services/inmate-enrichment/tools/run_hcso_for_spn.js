#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  const spn = process.argv[2];
  if (!spn) {
    console.error('Usage: node tools/run_hcso_for_spn.js <SPN>');
    process.exit(1);
  }
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  const PORT = process.env.PORT || 4000;
  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  const base = `http://localhost:${PORT}/api`;
  const jobSuffix = Math.floor(Date.now() / 1000);
  const resp = await fetch(`${base}/enrichment/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectIds: [spn], mode: 'dob-only', force: true, jobSuffix })
  });
  const data = await resp.json();
  console.log('Queued:', data.jobIds);
  if (data.jobIds && data.jobIds.length) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await fetch(`${base}/enrichment/status?jobId=${encodeURIComponent(data.jobIds[0])}`);
    const status = await st.json();
    console.log('Status:', status.status, 'step:', (status.steps||[]).find(s=>s.name==='hcso_dob')?.status);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => { console.error('error:', e); try { await mongoose.disconnect(); } catch {}; process.exit(1); });
