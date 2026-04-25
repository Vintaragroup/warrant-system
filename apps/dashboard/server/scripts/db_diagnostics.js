#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectMongo } from '../src/db.js';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGO_URL;
const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME || 'warrantdb';
if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Export MONGO_URI and MONGO_DB before running.');
  process.exit(1);
}

const OUT_FILE = path.resolve(process.cwd(), 'server', 'scripts', 'diagnostics.json');

await connectMongo(MONGO_URI, MONGO_DB);
const db = mongoose.connection.db;

const COLS = (process.env.DIAG_COLLECTIONS || 'simple_harris,simple_jefferson').split(',').map(s => s.trim()).filter(Boolean);

function simNormalizePipeline() {
  return [
    { $set: {
        booking_date_n: { $ifNull: ['$booking_date', { $ifNull: ['$booked_at', '$booking_date_iso'] }] },
        bond_amount_n: {
          $let: {
            vars: { bAmt: '$bond_amount', b: '$bond', bl: { $toString: { $ifNull: ['$bond_label', ''] } } },
            in: {
              $switch: {
                branches: [
                  { case: { $ne: ['$$bAmt', null] }, then: '$$bAmt' },
                  { case: { $isNumber: '$$b' }, then: '$$b' },
                  { case: { $regexMatch: { input: { $toString: '$$b' }, regex: /^\d+(\.\d+)?$/ } }, then: { $toDouble: '$$b' } },
                  { case: { $regexMatch: { input: '$$bl', regex: /REFER TO MAGISTRATE/i } }, then: null }
                ],
                default: null
              }
            }
          }
        }
    }} ,
    { $set: {
        booking_date: '$booking_date_n',
        bond_amount: '$bond_amount_n',
        bond_raw: { $toString: { $ifNull: ['$bond', { $ifNull: ['$bond_label',''] }] } },
        bond_status: {
          $switch: {
            branches: [
              { case: { $ne: ['$bond_amount_n', null] }, then: 'numeric' },
              { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /REFER TO MAGISTRATE/i } }, then: 'refer_to_magistrate' },
              { case: { $regexMatch: { input: { $toString: '$bond' }, regex: /REFER TO MAGISTRATE/i } }, then: 'refer_to_magistrate' },
              { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /SUMMONS/i } }, then: 'summons' },
              { case: { $regexMatch: { input: { $toString: '$bond' }, regex: /SUMMONS/i } }, then: 'summons' },
              { case: { $regexMatch: { input: { $toString: '$bond_label' }, regex: /UNSECURED|GOB/i } }, then: 'unsecured' },
              { case: { $eq: [{ $toString: { $ifNull: ['$bond', ''] } }, ''] }, then: 'no_bond' }
            ],
            default: 'unknown_text'
          }
        },
        bond_sort_value: {
          $switch: {
            branches: [
              { case: { $eq: ['$bond_status', 'numeric'] }, then: { $ifNull: ['$bond_amount_n', 0] } },
              { case: { $eq: ['$bond_status', 'refer_to_magistrate'] }, then: 1000000000 },
              { case: { $eq: ['$bond_status', 'unsecured'] }, then: 100 },
              { case: { $eq: ['$bond_status', 'summons'] }, then: 0 }
            ],
            default: 0
          }
        },
        county: { $toLower: { $trim: { input: { $ifNull: ['$county', 'unknown'] } } } }
    }}
  ];
}

const results = { meta: { ranAt: new Date().toISOString(), db: MONGO_DB, cols: COLS }, collections: {} };

for (const coll of COLS) {
  try {
    const cRes = {};

    // bond_status counts
    cRes.bond_status_counts = await db.collection(coll).aggregate([
      ...simNormalizePipeline(),
      { $group: { _id: '$bond_status', n: { $sum: 1 } } },
      { $sort: { n: -1 } }
    ]).toArray();

    // sample non-numeric
    cRes.non_numeric_samples = await db.collection(coll).aggregate([
      ...simNormalizePipeline(),
      { $match: { bond_status: { $ne: 'numeric' } } },
      { $project: { _id:0, full_name:1, case_number:1, bond_raw:1, bond_status:1, bond_sort_value:1, county:1 } },
      { $limit: 50 }
    ]).toArray();

    // distinct county values (post-canonicalization)
    cRes.county_values = await db.collection(coll).aggregate([
      { $project: { county: { $toLower: { $trim: { input: { $ifNull: ['$county',''] } } } } } },
      { $group: { _id: '$county', n: { $sum: 1 } } },
      { $sort: { n: -1 } }
    ]).toArray();

    // current hasLetterCase (legacy: not purely digits)
    const curHas = await db.collection(coll).aggregate([
      { $set: { _cn: { $toString: { $ifNull: ['$case_number',''] } } } },
      { $set: { hasLetterCase: { $and: [ { $ne: ['$_cn',''] }, { $not: [{ $regexMatch: { input: '$_cn', regex: /^\\d+$/ } }] } ] } } },
      { $match: { hasLetterCase: true } },
      { $count: 'n' }
    ]).toArray();
    cRes.legacy_hasLetterCase = curHas.length ? curHas[0].n : 0;

    // trailing-letter based hasLetterCase (new rule)
    const newHas = await db.collection(coll).aggregate([
      { $set: { _cn: { $toString: { $ifNull: ['$case_number',''] } } } },
      { $set: { hasLetterCase: { $and: [ { $ne: ['$_cn',''] }, { $regexMatch: { input: '$_cn', regex: /[A-Za-z]$/ } } ] } } },
      { $match: { hasLetterCase: true } },
      { $count: 'n' }
    ]).toArray();
    cRes.trailing_letter_hasLetterCase = newHas.length ? newHas[0].n : 0;

    results.collections[coll] = cRes;
  } catch (e) {
    console.error('Error inspecting', coll, e);
    results.collections[coll] = { error: String(e?.message || e) };
  }
}

// write output
try {
  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  console.log('Wrote diagnostics to', OUT_FILE);
} catch (e) {
  console.error('Failed to write diagnostics file:', e.message);
}

// print a short human summary
for (const [k,v] of Object.entries(results.collections)) {
  if (v.error) {
    console.log(k, 'error:', v.error);
    continue;
  }
  console.log(`\n${k}:`);
  console.log('  bond_status_counts:', v.bond_status_counts.map(x=>`${x._id}:${x.n}`).join(', '));
  console.log('  legacy_hasLetterCase:', v.legacy_hasLetterCase, ' -> trailing_letter_hasLetterCase:', v.trailing_letter_hasLetterCase);
}

await mongoose.connection.close();
process.exit(0);
