#!/usr/bin/env node
/**
 * One-time migration: backfill real CRM data from the legacy simple_harris/
 * simple_jefferson collections (bound to the old, broken Case model) into
 * the new app-owned crm_overlays collection.
 *
 * Not auto-run anywhere — invoke manually when ready:
 *   node scripts/migrate_crm_to_overlay.js --mode dry-run
 *   node scripts/migrate_crm_to_overlay.js --mode apply
 */
import { connectMongo, getMongo } from '../src/db.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';

const argv = yargs(hideBin(process.argv))
  .option('mode', { type: 'string', default: 'dry-run', choices: ['dry-run', 'apply'], describe: 'dry-run or apply changes' })
  .option('collections', { type: 'string', default: 'simple_harris,simple_jefferson', describe: 'comma-separated legacy collection names' })
  .option('overwrite', { type: 'boolean', default: false, describe: 'overwrite an existing crm_overlays row for a caseId instead of skipping it' })
  .option('batch', { type: 'number', default: 1000, describe: 'batch size for bulkWrite' })
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

function hasRealCrmSignal(doc) {
  if (doc.crm_stage && doc.crm_stage !== 'new') return true;
  if (Array.isArray(doc.crm_stage_history) && doc.crm_stage_history.length) return true;
  if (Array.isArray(doc.manual_tags) && doc.manual_tags.length) return true;
  const d = doc.crm_details;
  if (!d) return false;
  if (d.qualificationNotes) return true;
  if (Array.isArray(d.documents) && d.documents.some((item) => item?.status === 'completed')) return true;
  if (d.followUpAt) return true;
  if (d.assignedTo) return true;
  if (d.address?.streetLine1) return true;
  if (d.phone) return true;
  if (Array.isArray(d.attachments) && d.attachments.length) return true;
  if (d.acceptance?.accepted) return true;
  if (d.denial?.denied) return true;
  return false;
}

async function processCollection(db, name, mode, overwrite, batchSize) {
  console.log(`Processing collection ${name} mode=${mode} overwrite=${overwrite}`);
  const legacyCol = db.collection(name);
  const overlayCol = db.collection('crm_overlays');

  const total = await legacyCol.countDocuments();
  console.log(`Total documents in ${name}: ${total}`);

  const cursor = legacyCol.find({}).batchSize(batchSize);

  const summary = { total, withSignal: 0, migrated: 0, skippedExisting: 0, errors: 0, migratedIds: [] };
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;
    if (mode === 'apply') {
      try {
        const res = await overlayCol.bulkWrite(batch, { ordered: false });
        console.log(`Applied batch, upserted ${res.upsertedCount ?? 0}, modified ${res.modifiedCount ?? 0}`);
      } catch (err) {
        console.error('Batch write error', err.message);
        summary.errors += batch.length;
      }
    }
    batch = [];
  };

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!hasRealCrmSignal(doc)) continue;
    summary.withSignal += 1;

    const existing = await overlayCol.findOne({ caseId: doc._id }, { projection: { _id: 1 } });
    if (existing && !overwrite) {
      console.warn(`Skipping ${doc._id} — crm_overlays row already exists (pass --overwrite to replace)`);
      summary.skippedExisting += 1;
      continue;
    }

    const overlayDoc = {
      caseId: doc._id,
      sourceCollection: name,
      county: doc.county || null,
      manual_tags: Array.isArray(doc.manual_tags) ? doc.manual_tags : [],
      crm_stage: doc.crm_stage || 'new',
      crm_stage_history: Array.isArray(doc.crm_stage_history) ? doc.crm_stage_history : [],
      crm_details: doc.crm_details || {},
      updatedAt: new Date(),
    };

    batch.push({
      updateOne: {
        filter: { caseId: doc._id },
        update: {
          $set: overlayDoc,
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    });
    summary.migrated += 1;
    summary.migratedIds.push(String(doc._id));

    if (batch.length >= batchSize) await flush();
  }

  await flush();
  return summary;
}

async function main() {
  await connectMongo(MONGO_URI, MONGO_DB);
  const conn = getMongo();
  const db = conn.db;

  const collections = argv.collections.split(',').map((s) => s.trim()).filter(Boolean);

  const out = { ranAt: new Date().toISOString(), mode: argv.mode, overwrite: argv.overwrite, collections: {} };

  for (const c of collections) {
    try {
      out.collections[c] = await processCollection(db, c, argv.mode, argv.overwrite, argv.batch);
    } catch (e) {
      console.error('Error processing', c, e);
      out.collections[c] = { error: String(e) };
    }
  }

  const summaryPath = path.join(process.cwd(), 'scripts', 'crm_overlay_migration_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(out, null, 2));
  console.log('Wrote summary to', summaryPath);
  console.log(JSON.stringify(out, null, 2));

  await conn.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal', e);
  process.exit(1);
});
