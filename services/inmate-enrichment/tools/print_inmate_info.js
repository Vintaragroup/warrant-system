#!/usr/bin/env node
/*
  Fetch an inmate by SPN/subjectId and print first, middle, last, city, state, country, age.
  Usage: node tools/print_inmate_info.js 02991269
*/
const { MongoClient } = require('mongodb');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function parseDob(dob) {
  if (!dob) return null;
  if (dob instanceof Date && !isNaN(dob.getTime())) return dob;
  if (typeof dob === 'number') {
    const dt = new Date(dob > 1e12 ? dob : dob * 1000);
    return isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof dob === 'string') {
    const s = dob.trim();
    if (!s) return null;
    const parts = s.split(/[\/-]/);
    if (parts.length === 3) {
      // Assume MM/DD/YYYY or similar
      const [a, b, c] = parts.map((x) => x.replace(/[^0-9]/g, ''));
      let y, m, d;
      if (String(c).length === 4) { y = Number(c); m = Number(a); d = Number(b); }
      else if (String(a).length === 4) { y = Number(a); m = Number(b); d = Number(c); }
      else { const dt0 = new Date(s); if (!isNaN(dt0.getTime())) return dt0; return null; }
      const dt = new Date(Date.UTC(y, (m||1)-1, d||1));
      return isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function calcAge(dob) {
  if (!dob) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const m = today.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

(async () => {
  const subjectId = process.argv[2] || '02991269';
  const uri = process.env.MONGO_URI;
  const dbName = process.env.MONGO_DB || 'warrantdb';
  const collName = process.env.SUBJECTS_COLLECTION || 'simple_harris';
  if (!uri) {
    console.error('MONGO_URI missing');
    process.exit(1);
  }
  const client = new MongoClient(uri, { ignoreUndefined: true });
  try {
    await client.connect();
    const db = client.db(dbName);
    const coll = db.collection(collName);
    const doc = await coll.findOne(
      { $or: [ { spn: subjectId }, { subject_id: subjectId }, { subjectId } ] },
      { projection: { first_name: 1, middle_name: 1, middle: 1, last_name: 1, city: 1, state: 1, country: 1, zip: 1, address: 1, addr: 1, dob: 1 } }
    );
    if (!doc) {
      console.error('Subject not found:', subjectId);
      process.exit(2);
    }
    const first = (doc.first_name || '').toString().trim();
    const middle = (doc.middle_name || doc.middle || '').toString().trim();
    const last = (doc.last_name || '').toString().trim();
    // Derive city/state from explicit fields or fallback to address
    let city = (doc.city || '').toString().trim();
    let state = (doc.state || '').toString().trim();
    const country = (doc.country || 'US').toString().trim();
    const zip = (doc.zip || '').toString().trim();
    const addr = doc.address || doc.addr || null;
    const parseAddrObj = (a) => {
      if (!a) return {};
      if (typeof a === 'string') {
        // Try to split lines and commas to guess city/state/zip
        const lines = a.split(/\n|\r|;/).map(s => s.trim()).filter(Boolean);
        const last = lines[lines.length - 1] || '';
        const parts = last.split(',').map(s => s.trim()).filter(Boolean);
        // Heuristic: if we see a 5-digit number, treat as ZIP; otherwise treat first token as city
        const zipMatch = last.match(/\b\d{5}(?:-\d{4})?\b/);
        return {
          city: parts[0] || undefined,
          state: parts[1] || undefined,
          zip: (zipMatch ? zipMatch[0] : undefined)
        };
      }
      if (typeof a === 'object') {
        return {
          city: a.city || a.town || undefined,
          state: a.state || a.region || undefined,
          zip: a.zip || a.postal_code || undefined
        };
      }
      return {};
    };
    if ((!city || !state) && addr) {
      const fromAddr = parseAddrObj(addr);
      if (!city && fromAddr.city) city = fromAddr.city;
      if (!state && fromAddr.state) state = fromAddr.state;
    }
    // As a last resort, since this dataset is Harris County (TX), assume TX if state still empty
    if (!state) state = 'TX';
    const dob = parseDob(doc.dob);
    const age = calcAge(dob);
  const out = { first, middle, last, country, state, city, age };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('Error:', e);
    process.exit(3);
  } finally {
    await client.close();
  }
})();
