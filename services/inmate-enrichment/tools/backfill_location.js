#!/usr/bin/env node
/*
  Backfill city/state/country from address fields for recent inmates.
  Usage: node tools/backfill_location.js --windowHours=168 --limit=500
*/
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseTs(v) {
  if (v == null) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number') return new Date(v > 1e12 ? v : v * 1000);
  if (typeof v === 'string') {
    const s = v.trim(); if (!s) return null;
    const d0 = new Date(s); if (!isNaN(d0.getTime())) return d0;
    if (/^\d{10,13}$/.test(s)) { const n = Number(s); return new Date(s.length === 13 ? n : n * 1000); }
  }
  return null;
}
function bestBooking(doc){
  const fields = ['booking_datetime','booking_at','booking_time','booking_date'];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(doc, f)) {
      const d = parseTs(doc[f]);
      if (d && !isNaN(d.getTime())) return d;
    }
  }
  return null;
}
function deriveFromAddress(addr, fallbacks={}){
  const out = { city: fallbacks.city, state: fallbacks.state, zip: fallbacks.zip };
  if (!addr) return out;
  if (typeof addr === 'string') {
    const lines = addr.split(/\n|\r|;/).map(s=>s.trim()).filter(Boolean);
    const last = lines[lines.length-1] || '';
    const parts = last.split(',').map(s=>s.trim()).filter(Boolean);
    const zipMatch = last.match(/\b\d{5}(?:-\d{4})?\b/);
    if (!out.city && parts[0]) out.city = parts[0];
    if (!out.state && parts[1]) out.state = parts[1];
    if (!out.zip && zipMatch) out.zip = zipMatch[0];
    return out;
  }
  if (typeof addr === 'object') {
    if (!out.city && addr.city) out.city = String(addr.city).trim();
    if (!out.state && addr.state) out.state = String(addr.state).trim();
    if (!out.zip && (addr.zip || addr.postal_code)) out.zip = String(addr.zip || addr.postal_code).trim();
    return out;
  }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const getArg = (k, def) => {
    const p = `--${k}=`; const a = args.find(x=>x.startsWith(p));
    if (!a) return def; const v = a.slice(p.length);
    const n = Number(v); return isFinite(n) ? n : def;
  };
  const windowHours = Math.max(1, Math.min(720, getArg('windowHours', 168)));
  const limit = Math.max(1, Math.min(10000, getArg('limit', 500)));

  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB || 'warrantdb';
  const collName = process.env.SUBJECTS_COLLECTION || 'simple_harris';
  if (!uri) { console.error('MONGO_URI missing'); process.exit(1); }

  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);

  const client = new MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
    const coll = client.db(dbName).collection(collName);
    const cursor = coll.find({}, { projection: { spn:1, subject_id:1, subjectId:1, address:1, addr:1, city:1, state:1, country:1, zip:1, booking_datetime:1, booking_at:1, booking_time:1, booking_date:1 } }).sort({ _id: -1 });
    let updated = 0; const sample = [];
    while (await cursor.hasNext()) {
      const d = await cursor.next();
      const bAt = bestBooking(d); if (!bAt || bAt < cutoff) continue;
      if (updated >= limit) break;
      const hasCity = !!(d.city && String(d.city).trim());
      const hasState = !!(d.state && String(d.state).trim());
      const hasCountry = !!(d.country && String(d.country).trim());
      if (hasCity && hasState && hasCountry) continue;
      const addr = d.address || d.addr || null;
      const fromAddr = deriveFromAddress(addr, { city: d.city, state: d.state, zip: d.zip });
      const patch = {};
      if (!hasCity && fromAddr.city) patch.city = fromAddr.city;
      if (!hasState && fromAddr.state) patch.state = fromAddr.state;
      if (!hasCountry) patch.country = 'US';
      if (Object.keys(patch).length) {
        await coll.updateOne({ _id: d._id }, { $set: patch });
        updated++;
        const sid = d.spn || d.subject_id || d.subjectId; if (sample.length < 10) sample.push(String(sid));
      }
    }
    console.log(JSON.stringify({ ok:true, windowHours, limit, updated, sample }, null, 2));
  } catch (e) {
    console.error('Error:', e);
    process.exit(2);
  } finally {
    await client.close();
  }
})();
