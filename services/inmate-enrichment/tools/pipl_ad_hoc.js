#!/usr/bin/env node
/*
  Ad-hoc Pipl query by name/location/DOB range using PIPL_API_KEY from .env
  Usage:
    node tools/pipl_ad_hoc.js --first=Alexander --last=Giovanni --city=Katy --state=TX --country=US --dobStart=1996-10-19 --dobEnd=1999-10-18
*/
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main(){
  const args = process.argv.slice(2);
  const get = (k, d) => { const p = `--${k}=`; const a = args.find(x=>x.startsWith(p)); return a ? a.slice(p.length) : d; };
  const first = get('first', 'Alexander');
  const last = get('last', 'Giovanni');
  const city = get('city', 'Katy');
  const state = get('state', 'TX');
  const country = get('country', 'US');
  const dobStart = get('dobStart', '1996-10-19');
  const dobEnd = get('dobEnd', '1999-10-18');
  const key = process.env.PIPL_API_KEY;
  if (!key) { console.error('Missing PIPL_API_KEY in .env'); process.exit(1); }
  const person = { names: [{ first, last }], addresses: [{ city, state, country }] };
  if (dobStart || dobEnd) person.dob = { date_range: {} };
  if (dobStart) person.dob.date_range.start = dobStart;
  if (dobEnd) person.dob.date_range.end = dobEnd;
  const bodyReq = { key, person };
  const resp = await fetch('https://api.pipl.com/search/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyReq) });
  const text = await resp.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  const summary = {
    http_status_code: data?.['@http_status_code'] || resp.status,
    visible_sources: data?.['@visible_sources'] || 0,
    available_sources: data?.['@available_sources'] || 0,
    persons_count: data?.['@persons_count'] || 0,
    search_id: data?.['@search_id'] || null,
    available_data: data?.available_data?.premium || null,
  };
  // Extract a compact top-candidate preview for evaluation
  const persons = Array.isArray(data?.possible_persons) ? data.possible_persons : (data?.person ? [data.person] : []);
  const top = persons[0] || null;
  const topPreview = top ? (() => {
    const m = typeof top['@match'] === 'number' ? top['@match'] : (typeof data['@match'] === 'number' ? data['@match'] : null);
    const addr = Array.isArray(top.addresses) ? top.addresses.slice(0, 3).map(a => [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', ')) : [];
    const rels = Array.isArray(top.relationships) ? top.relationships.slice(0, 5).map(r => ({ type: r?.type || r?.relation || null, name: (r?.names && r.names[0] && (r.names[0].display || [r.names[0].first, r.names[0].last].filter(Boolean).join(' '))) || (r?.name || null) })) : [];
    const dob = top?.dob?.date || top?.dob || null;
    const dobMatch = (dobStart && dobEnd && String(dobStart) === String(dobEnd) && !!dob && String(dob).startsWith(String(dobStart))) || false;
    return { match: m, dob, dobMatch, sample_addresses: addr, sample_relationships: rels };
  })() : null;
  console.log(JSON.stringify({ ok: resp.ok, summary, topPreview, sampleQuery: { first, last, city, state, country, dobStart, dobEnd } }, null, 2));
}

main().catch(e=>{ console.error('Error:', e?.message || e); process.exit(1); });
