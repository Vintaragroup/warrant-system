#!/usr/bin/env node
/*
  Upsert normalized name and relationships for a subject (by SPN/subjectId).

  Usage:
    node tools/upsert_name_relations.js --subject 02991269 --first "Giovanni" --middle "Alexander" --last "Rivera" \
      --relations '[{"name":"Jose Alejandro Rivera","relationType":"family","confidence":0.9},{"name":"Litzy Rivera","relationType":"family","confidence":0.85},{"name":"Jose David Espinosa","relationType":"associate","confidence":0.7}]'

  Env:
    - MONGO_URI (required)
    - MONGO_DB (default: warrantdb)
    - SUBJECTS_COLLECTION (default: simple_harris)
*/
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const out = { relations: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--subject' || a === '-s') { out.subject = next; i++; }
    else if (a === '--first') { out.first = next; i++; }
    else if (a === '--middle') { out.middle = next; i++; }
    else if (a === '--last') { out.last = next; i++; }
    else if (a === '--relations' || a === '-r') {
      try { out.relations = JSON.parse(next || '[]'); } catch { out.relations = []; }
      i++;
    }
  }
  return out;
}

function sha1Hex(input) { return crypto.createHash('sha1').update(input).digest('hex'); }
function buildPartyId(name, city, dob) {
  const key = [String(name || '').toLowerCase().trim(), String(city || '').toLowerCase().trim(), String(dob || '')].join('|');
  return sha1Hex(key);
}

(async () => {
  const args = parseArgs(process.argv);
  const subjectId = args.subject || process.env.SUBJECT_ID;
  if (!subjectId) {
    console.error('Missing --subject');
    process.exit(1);
  }
  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB || 'warrantdb';
  const collName = process.env.SUBJECTS_COLLECTION || 'simple_harris';
  if (!uri) { console.error('MONGO_URI missing'); process.exit(2); }

  const client = new MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
    const db = client.db(dbName);
    const coll = db.collection(collName);

    const subject = await coll.findOne({ $or: [ { spn: subjectId }, { subject_id: subjectId }, { subjectId } ] }, { projection: { spn:1, subject_id:1, subjectId:1, city:1, dob:1 } });
    if (!subject) { console.error('Subject not found:', subjectId); process.exit(3); }
    const sid = String(subject.spn || subject.subject_id || subject.subjectId || subjectId);
    const patch = {};
    if (args.first != null) patch.first_name = String(args.first).trim();
    if (args.middle != null) patch.middle_name = String(args.middle).trim();
    if (args.last != null) patch.last_name = String(args.last).trim();
    if (Object.keys(patch).length) {
      await coll.updateOne({ $or: [ { spn: sid }, { subject_id: sid }, { subjectId: sid } ] }, { $set: patch });
    }

    const rels = Array.isArray(args.relations) ? args.relations : [];
    const relColl = db.collection('related_parties');
    let upserts = 0;
    for (const r of rels) {
      if (!r || !r.name) continue;
      const relationType = ['family','household','associate'].includes(String(r.relationType).toLowerCase()) ? String(r.relationType).toLowerCase() : 'associate';
      const confidence = typeof r.confidence === 'number' ? r.confidence : (relationType === 'family' ? 0.8 : 0.6);
      const pid = buildPartyId(r.name, subject.city, subject.dob || null);
      const filter = { subjectId: sid, partyId: pid };
      const update = { $set: { name: r.name, relationType, confidence }, $addToSet: { sources: 'pipl' } };
      await relColl.updateOne(filter, update, { upsert: true });
      upserts++;
    }

    console.log(JSON.stringify({ ok: true, subjectId: sid, nameUpdated: Object.keys(patch).length > 0, relationsUpserted: upserts }, null, 2));
  } catch (e) {
    console.error('Error:', e);
    process.exit(4);
  } finally {
    await client.close();
  }
})();
