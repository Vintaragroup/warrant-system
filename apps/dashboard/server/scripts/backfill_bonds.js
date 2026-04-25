#!/usr/bin/env node
import { connectMongo, getMongo } from '../src/db.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';

const argv = yargs(hideBin(process.argv))
  .option('mode', { type: 'string', default: 'dry-run', choices: ['dry-run', 'apply'], describe: 'dry-run or apply changes' })
  .option('collections', { type: 'string', default: 'simple_harris,simple_jefferson', describe: 'comma-separated collection names' })
  .option('batch', { type: 'number', default: 1000, describe: 'batch size for bulkWrite' })
  .option('sample', { type: 'number', default: 0, describe: 'if >0, process only this many documents (safe test)' })
  .option('fixBondAmount', { type: 'boolean', default: false, describe: 'if true, compute and set numeric bond_amount when possible' })
  .option('mongoUri', { type: 'string', describe: 'Mongo connection string (or set MONGO_URI env)' })
  .option('mongoDb', { type: 'string', default: 'warrantdb', describe: 'Mongo database name (or set MONGO_DB env)' })
  .help()
  .argv;

const MONGO_URI = argv.mongoUri || process.env.MONGO_URI;
const MONGO_DB = argv.mongoDb || process.env.MONGO_DB || 'warrantdb';

if (!MONGO_URI) {
  console.error('Missing MONGO_URI. Set env MONGO_URI or pass --mongoUri');
  process.exit(2);
}

function canonicalCounty(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/county/g, '')
    .replace(/[^a-z]/g, '');
}

function classifyBond(raw) {
  if (raw == null) return { status: 'no_bond', raw: '', sort: 0 };
  const r = String(raw).trim();
  if (r.length === 0) return { status: 'no_bond', raw: '', sort: 0 };
  // pure numeric (allow commas, dollar signs, decimals)
  const digits = r.replace(/[^0-9.]/g, '');
  if (/^\d+(?:[.,]\d+)*$/.test(r) || /^\$?\d/.test(r) && digits.length > 0) {
    const n = Number(digits.replace(/,/g, '')) || 0;
    return { status: 'numeric', raw: r, sort: Math.round(n), amount: n };
  }

  // common keywords
  if (/REFER\s*TO\s*MAGISTRATE/i.test(r) || /REFER TO MAGISTRATE/i.test(r)) return { status: 'refer_to_magistrate', raw: r, sort: 0 };
  if (/SUMMONS/i.test(r)) return { status: 'summons', raw: r, sort: 0 };
  if (/UNSECURED/i.test(r)) return { status: 'unsecured', raw: r, sort: 0 };
  if (/NO\s*BOND|NONE|N\/A/i.test(r)) return { status: 'no_bond', raw: r, sort: 0 };

  // trailing single letter often used by old rule — consider unknown_text
  if (/^[A-Za-z]$/.test(r)) return { status: 'unknown_text', raw: r, sort: 0 };

  // fallback
  return { status: 'unknown_text', raw: r, sort: 0 };
}

async function processCollection(db, name, mode, batchSize, maxDocs = 0) {
  console.log(`Processing collection ${name} mode=${mode} batch=${batchSize}`);
  const col = db.collection(name);
  const total = await col.countDocuments();
  console.log(`Total documents: ${total}`);

  const cursor = col.find({}, { projection: { _id: 1, bond: 1, bond_amount: 1, county: 1 } }).batchSize(batchSize);

  let processed = 0;
  const summary = { total, byStatus: {}, samples: [] };
  summary.updatedIds = [];

  while (await cursor.hasNext()) {
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      if (!(await cursor.hasNext())) break;
      const doc = await cursor.next();
      const raw = doc.bond ?? (doc.bond_amount != null ? String(doc.bond_amount) : null);
      const { status, raw: bond_raw, sort: bond_sort_value } = classifyBond(raw);
      const canonical = canonicalCounty(doc.county || '');

      summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
      if (summary.samples.length < 50 && status !== 'numeric') {
        summary.samples.push({ id: doc._id, bond_raw, status, canonical });
      }

      processed++;

      if (maxDocs > 0 && processed > maxDocs) {
        // reached sample limit; stop adding more docs
        break;
      }

      if (mode === 'apply') {
        const setObj = {
          bond_status: status,
          bond_raw: bond_raw,
          bond_sort_value: bond_sort_value,
          canonical_county: canonical,
        };
        if (argv.fixBondAmount && typeof (raw) !== 'object') {
          // if classifier parsed an amount, set bond_amount to numeric
          const parsed = classifyBond(raw);
          if (parsed.amount != null) setObj.bond_amount = parsed.amount;
        }
        // If runId is provided, use an update pipeline to push a concrete run entry
        if (argv.runId) {
          const runEntry = { runId: argv.runId, at: new Date().toISOString() };
          // Use update pipeline with aggregation expression to append run entry
          const updatePipeline = [
            { $set: Object.assign({}, setObj, {
              backfill_runs: {
                $concatArrays: [
                  { $cond: [ { $isArray: '$backfill_runs' }, '$backfill_runs', [] ] },
                  [ runEntry ]
                ]
              }
            }) }
          ];
          batch.push({
            updateOne: {
              filter: { _id: doc._id },
              update: updatePipeline,
            },
          });
        } else {
          batch.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: setObj },
            },
          });
        }
      }
    }

    if (mode === 'apply' && batch.length > 0) {
      const res = await col.bulkWrite(batch, { ordered: false });
      console.log(`Applied batch, matched ${res.matchedCount}, modified ${res.modifiedCount}`);
      // record the updated ids for auditing (batch contains filter._id)
      const ids = batch.map((u) => u.updateOne.filter._id);
      summary.updatedIds.push(...ids);
      // log a short sample to console
      console.log('Updated ids (sample):', ids.slice(0, 5).map(String));
    }

    if (maxDocs > 0 && processed > maxDocs) break;
  }

  return summary;
}

async function main() {
  await connectMongo(MONGO_URI, MONGO_DB);
  const conn = getMongo();
  const db = conn.db;

  const collections = argv.collections.split(',').map((s) => s.trim()).filter(Boolean);

  const runId = `run_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runsDir = path.join(process.cwd(), 'server', 'scripts', 'backfill_runs');
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });

  const out = { ranAt: new Date().toISOString(), mode: argv.mode, runId, collections: {} };

  for (const c of collections) {
    try {
      const maxDocs = Number(argv.sample || 0) || 0;
      // pass runId to processCollection via argv for tagging
      argv.runId = runId;
      out.collections[c] = await processCollection(db, c, argv.mode, argv.batch, maxDocs);
    } catch (e) {
      console.error('Error processing', c, e);
      out.collections[c] = { error: String(e) };
    }
  }

  const summaryPath = path.join(process.cwd(), 'server', 'scripts', 'backfill_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(out, null, 2));
  console.log('Wrote summary to', summaryPath);

  const runLog = {
    runId,
    ranAt: out.ranAt,
    mode: argv.mode,
    collections: out.collections,
  };
  const runPath = path.join(runsDir, `${runId}.json`);
  fs.writeFileSync(runPath, JSON.stringify(runLog, null, 2));
  console.log('Wrote run log to', runPath);

  // Close connection
  await conn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal', e);
  process.exit(1);
});
