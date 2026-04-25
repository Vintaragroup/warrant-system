#!/usr/bin/env node
/*
Validate related-party phones via Whitepages and persist evidence.
Usage:
  node tools/validate_related_phones.js --subject=02991269 [--limit=20]
  npm run phones:validate -- --subject=02991269
*/
const { connectMongo, config, logger } = require('@inmate/shared');
const { RelatedPartyModel, RawProviderPayloadModel } = require('@inmate/shared');
const axios = require('axios');

async function whitepagesLookupPhones(phones) {
  const demo = () => phones.map((p) => ({ phoneNumber: p, reputation: { level: 'medium' }, _demo: true }));
  if (!config.whitepagesApiKey) {
    logger.warn('WHITEPAGES_API_KEY missing; returning demo evidence');
    return demo();
  }
  const url = 'https://proapi.whitepages.com/3.5/phone';
  const out = [];
  for (const p of phones) {
    try {
      const resp = await axios.get(url, { params: { api_key: config.whitepagesApiKey, phone: p }, timeout: 8000 });
      out.push(resp.data);
    } catch (err) {
      logger.warn('Whitepages lookup failed; using demo for phone', { phone: p, err: String(err && err.message || err) });
      out.push({ phoneNumber: p, reputation: { level: 'unknown' }, _demo: true, _error: true });
    }
  }
  return out;
}

function phoneStrings(parties) {
  const set = new Set();
  for (const rp of parties) {
    const arr = (rp.contacts && rp.contacts.phones) || [];
    for (const ph of arr) set.add(ph);
  }
  return Array.from(set);
}

async function persistRawPayload({ provider, step, payload }) {
  const ttlHours = config.rawPayloadTtlHours || 72;
  const ttlExpiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  await RawProviderPayloadModel.create({ provider, step, payload, ttlExpiresAt });
}

async function run() {
  const subjectArg = process.argv.find((a) => a.startsWith('--subject='));
  if (!subjectArg) {
    console.error('Missing --subject=<subjectId>');
    process.exit(1);
  }
  const subjectId = subjectArg.split('=')[1];
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  await connectMongo();

  const parties = await RelatedPartyModel.find({ subjectId }).limit(limit).lean();
  if (!parties.length) {
    console.log(JSON.stringify({ ok: true, subjectId, tried: 0, updated: 0, skipped: 0 }));
    process.exit(0);
  }
  const phones = phoneStrings(parties);
  if (phones.length === 0) {
    console.log(JSON.stringify({ ok: true, subjectId, tried: 0, updated: 0, skipped: parties.length }));
    process.exit(0);
  }

  const wp = await whitepagesLookupPhones(phones);
  await persistRawPayload({ provider: 'whitepages', step: 'related_party_phone_validate', payload: wp });

  let updated = 0;
  for (const rp of parties) {
    const rpPhones = (rp.contacts && rp.contacts.phones) || [];
    const evidence = [];
    for (const p of rpPhones) {
      const rec = wp.find((x) => (x.phoneNumber || x.phone || '').replace(/\D/g, '') === p.replace(/\D/g, '')) || wp.find((x) => (x.belongs_to?.phones || []).includes(p));
      if (!rec) continue;
      // Basic signal extraction; extend as needed
      const level = rec.reputation?.level || rec.reputation || 'unknown';
      const carrier = rec.carrier || rec.current_carrier || undefined;
      evidence.push({ type: 'phone_validation', value: p, weight: level === 'high' ? 1 : level === 'medium' ? 0.6 : 0.3, provider: 'whitepages' });
    }
    if (evidence.length) {
      await RelatedPartyModel.updateOne({ _id: rp._id }, { $push: { evidence: { $each: evidence } } });
      updated++;
    }
  }

  console.log(JSON.stringify({ ok: true, subjectId, tried: parties.length, updated }));
}

run().catch((err) => { console.error(err); process.exit(1); });
