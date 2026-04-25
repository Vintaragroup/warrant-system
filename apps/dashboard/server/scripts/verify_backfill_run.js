#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { connectMongo, getMongo } from '../src/db.js';
import { ObjectId } from 'mongodb';

const runsDir = path.join(process.cwd(), 'server', 'scripts', 'backfill_runs');
const files = fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.error('No run logs found in', runsDir);
  process.exit(2);
}

const last = files[files.length - 1];
const run = JSON.parse(fs.readFileSync(path.join(runsDir, last), 'utf8'));
const { runId, collections } = run;
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'warrantdb';

if (!MONGO_URI) {
  console.error('Set MONGO_URI env to connect');
  process.exit(2);
}

(async () => {
  await connectMongo(MONGO_URI, MONGO_DB);
  const conn = getMongo();
  const db = conn.db;

  console.log('Verifying run', runId);
  for (const [colName, info] of Object.entries(collections)) {
    if (!info.updatedIds || info.updatedIds.length === 0) continue;
    const col = db.collection(colName);
  const ids = info.updatedIds.slice(0, 20).map((s) => new ObjectId(s));
  const docs = await col.find({ _id: { $in: ids } }).project({ backfill_runs: 1, bond:1, bond_amount:1, bond_raw:1, bond_status:1 }).toArray();
    console.log(`Collected ${docs.length} docs from ${colName}`);
    docs.forEach((d) => {
      console.log(JSON.stringify({ _id: d._id.toString(), backfill_runs: d.backfill_runs, bond: d.bond, bond_amount: d.bond_amount, bond_raw: d.bond_raw, bond_status: d.bond_status }, null, 2));
    });
  }

  await conn.close();
  process.exit(0);
})().catch((e) => { console.error('Verify error', e); process.exit(1); });
