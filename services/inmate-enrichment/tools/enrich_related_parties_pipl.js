#!/usr/bin/env node
/*
  Enrich related parties for a subject via Pipl and upsert phones/emails/addresses.

  Usage:
    node tools/enrich_related_parties_pipl.js 02991269 [--max=3] [--unique] [--min=0.85]

  Requires .env with MONGO_URI, MONGO_DB, PIPL_API_KEY
*/
const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function sha1Hex(input) { return crypto.createHash('sha1').update(input).digest('hex'); }
function buildPartyId(name, city, dob) { return sha1Hex([String(name||'').toLowerCase().trim(), String(city||'').toLowerCase().trim(), String(dob||'')].join('|')); }
function splitName(n){ const parts=String(n||'').trim().split(/\s+/).filter(Boolean); if(parts.length<=1) return {first:parts[0]||'', last:''}; return {first:parts.slice(0,-1).join(' '), last:parts[parts.length-1]}; }

async function piplQuery({ key, first, last, city, state }){
  const person = { names: [{ first, last }], addresses: [{ city, state, country: 'US' }] };
  const resp = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, person }) });
  const text = await resp.text(); let data={}; try{ data=JSON.parse(text);}catch{}
  const personsCount = Number(data?.['@persons_count'] || 0);
  const extract = (pp) => {
    const m = typeof pp?.['@match'] === 'number' ? pp['@match'] : (typeof data?.['@match'] === 'number' ? data['@match'] : 0.0);
    const phones = Array.isArray(pp?.phones) ? pp.phones.map(x => x?.display_international || x?.number || x) : [];
    const emails = Array.isArray(pp?.emails) ? pp.emails.map(e => e?.address || e) : [];
    const addresses = Array.isArray(pp?.addresses) ? pp.addresses.map(a => a?.display || [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')) : [];
    const lastName = (Array.isArray(pp?.names) && pp.names[0]?.last) ? String(pp.names[0].last) : '';
    return { m, phones, emails, addresses, lastName };
  };
  let matches = [];
  if (Array.isArray(data?.possible_persons) && data.possible_persons.length) matches = data.possible_persons.map(extract);
  else if (data?.person) matches = [extract(data.person)];
  const best = matches.sort((a,b)=> (b.m||0)-(a.m||0))[0] || null;
  return { personsCount, best, raw: data };
}

(async () => {
  const subjectId = process.argv[2];
  if (!subjectId) { console.error('Usage: node tools/enrich_related_parties_pipl.js <subjectId> [--max=3] [--unique] [--min=0.85]'); process.exit(1); }
  const args = process.argv.slice(3);
  const getNum = (k, d) => { const p='--'+k+'='; const a=args.find(x=>x.startsWith(p)); return a? Number(a.slice(p.length)) : d; };
  const has = (k) => args.includes('--'+k);
  const max = Math.max(1, Math.min(10, getNum('max', 3)));
  const requireUnique = has('unique');
  const matchMin = getNum('min', Number(process.env.HIGH_QUALITY_MATCH || 0.75));

  const key = process.env.PIPL_API_KEY;
  if (!key) { console.error('Missing PIPL_API_KEY'); process.exit(2); }
  const uri = process.env.MONGO_URI; if (!uri) { console.error('Missing MONGO_URI'); process.exit(3); }
  const dbName = process.env.MONGO_DB || 'warrantdb';
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  const db = client.db(dbName);
  try {
    const collSubj = db.collection(process.env.SUBJECTS_COLLECTION || 'simple_harris');
    const subject = await collSubj.findOne({ $or: [ { spn: subjectId }, { subject_id: subjectId }, { subjectId } ] }, { projection: { city:1, state:1 } });
    if (!subject) { console.error('Subject not found'); process.exit(4); }
    const city = String(subject.city || 'Katy');
    const state = String(subject.state || 'TX');
    const relColl = db.collection('related_parties');
    const parties = await relColl.find({ subjectId: String(subjectId) }, { projection: { name:1, contacts:1 } }).limit(20).toArray();
    const need = parties.filter(p => !p?.contacts || ((!Array.isArray(p.contacts?.phones) || p.contacts.phones.length===0) && (!Array.isArray(p.contacts?.emails) || p.contacts.emails.length===0)));
    const candidates = (need.length? need : parties).slice(0, max);
    let tried=0, updated=0, skipped=0; const details=[];
    for (const p of candidates){
      tried++;
      const name = String(p.name||'').trim(); if(!name){ skipped++; details.push({ name, reason:'EMPTY_NAME' }); continue; }
      const { first, last } = splitName(name);
      let data; try { data = await piplQuery({ key, first, last, city, state }); } catch(e){ skipped++; details.push({ name, error: String(e) }); continue; }
      const best = data.best; const personsCount = data.personsCount; const lastOk = best && last && best.lastName && String(best.lastName).toLowerCase()===String(last).toLowerCase();
      const accept = requireUnique ? (personsCount===1) : (best && (best.m||0) >= matchMin);
      if (!best || !(accept || lastOk)) { skipped++; details.push({ name, personsCount, match: best?.m||0, accepted:false }); continue; }
      const phonesU = Array.from(new Set((best.phones||[]).map(x=>String(x).trim()).filter(Boolean))).slice(0,10);
      const emailsU = Array.from(new Set((best.emails||[]).map(x=>String(x).trim()).filter(Boolean))).slice(0,10);
      const addrsU = Array.from(new Set((best.addresses||[]).map(x=>String(x).trim()).filter(Boolean))).slice(0,10);
      const pid = buildPartyId(name, subject.city||null, null);
      await relColl.updateOne(
        { subjectId: String(subjectId), $or: [ { partyId: pid }, { name } ] },
        { $setOnInsert: { partyId: pid, name }, $addToSet: { sources: 'pipl', 'contacts.phones': { $each: phonesU }, 'contacts.emails': { $each: emailsU }, addresses: { $each: addrsU } } },
        { upsert: true }
      );
      updated++; details.push({ name, accepted:true, match: best.m||0, phones: phonesU.length, emails: emailsU.length, addresses: addrsU.length });
    }
    console.log(JSON.stringify({ ok:true, subjectId: String(subjectId), city, state, tried, updated, skipped, details }, null, 2));
  } finally {
    await client.close();
  }
})().catch(e=>{ console.error('Error:', e?.message || e); process.exit(99); });
