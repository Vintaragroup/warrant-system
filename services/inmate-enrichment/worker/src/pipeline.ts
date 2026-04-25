import { InmateModel, EnrichmentJobModel, RawProviderPayloadModel, logger, config, scoreRelatedParty, RelatedPartyModel, buildPartyId, getIngestionTimestamp, isWithinWindow } from '@inmate/shared';
import { deriveLocationFromAddress } from '@inmate/shared';
import { pdlSearch, pdlReverseAddress, pdlReversePhone } from './providers/pdlClient';
import { piplSearch } from './providers/piplClient';
import { whitepagesLookup } from './providers/whitepagesClient';
import { socialScan } from './providers/openaiClient';
import { lookupDobBySpn } from './providers/hcsoClient';

type StepName = 'hcso_dob' | 'pdl_search' | 'pick_candidate' | 'reverse_address' | 'reverse_phone' | 'whitepages' | 'social_scan' | 'rank_store';

async function updateStep(jobId: string, name: StepName, status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'UNRESOLVED', info?: any) {
  const job = await EnrichmentJobModel.findOne({ jobId });
  if (!job) return;
  const now = new Date();
  const step = job.steps?.find((s: any) => s.name === name);
  if (!step) {
    job.steps?.push({ name, status, startedAt: status === 'RUNNING' ? now : undefined, finishedAt: status !== 'RUNNING' ? now : undefined, info });
  } else {
    if (status === 'RUNNING' && !step.startedAt) step.startedAt = now;
    if (status !== 'RUNNING') step.finishedAt = now;
    step.status = status as any;
    if (info) step.info = info;
  }
  await job.save();
}

export async function runPipeline({ subjectId, mode, jobId, runOpts }: { subjectId: string; mode: 'standard' | 'deep' | 'dob-only'; jobId: string; runOpts?: { windowHoursOverride?: number; minBondOverride?: number } }): Promise<{ partial: boolean }> {
  const subject = await InmateModel.findOne({ $or: [{ spn: subjectId }, { subject_id: subjectId }, { subjectId }] });
  if (!subject) throw new Error('Subject not found');
  let partial = false;

  // 0a) Backfill city/state/country from existing address fields if missing
  try {
    const sAny: any = subject;
    const hasCity = !!(sAny.city && String(sAny.city).trim());
    const hasState = !!(sAny.state && String(sAny.state).trim());
    const hasCountry = !!(sAny.country && String(sAny.country).trim());
    if (!hasCity || !hasState || !hasCountry) {
      const baseAddr = sAny.address || sAny.addr || null;
      const loc = deriveLocationFromAddress(baseAddr, { city: sAny.city, state: sAny.state, zip: sAny.zip });
      if (!hasCity && loc.city) subject.set('city', loc.city);
      if (!hasState && loc.state) subject.set('state', loc.state);
      if (!hasCountry) subject.set('country', 'US');
      await subject.save();
    }
  } catch (e) {
    logger.warn('city/state backfill failed', { err: String(e) });
  }

  // 0) hcso_dob (only if dob missing)
  const existingDob = (subject as any)?.dob;
  const hcsoEnabled = (config as any).hcsoEnabled;
  if (!existingDob && hcsoEnabled) {
    await updateStep(jobId, 'hcso_dob', 'RUNNING');
    try {
      const spn = (subject as any)?.spn || (subject as any)?.subject_id || (subject as any)?.subjectId || subjectId;
      const res = await lookupDobBySpn(spn);
      await RawProviderPayloadModel.create({ jobId, provider: 'hcso', step: 'hcso_dob', payload: res, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
      // If site indicates not in jail, flag subject
      if (res?.notInJail) {
        subject.set('hcso_status', { notInJail: true, asOf: res.asOf || null, message: res.statusMessage || null, source: 'hcso', notBondable: !!res.notBondable, bondExceptionText: res.bondExceptionText || null, moreChargesPossible: !!res.moreChargesPossible });
        await subject.save();
  await updateStep(jobId, 'hcso_dob', 'SKIPPED', { reason: 'NOT_IN_JAIL', asOf: res?.asOf, notBondable: !!res?.notBondable, bondExceptionText: res?.bondExceptionText, moreChargesPossible: !!res?.moreChargesPossible });
        partial = true;
      }
      // If bond exception exists independent of notInJail, persist it as well
      if (res?.bondExceptionText || res?.notBondable || res?.moreChargesPossible) {
        const current = subject.get('hcso_status') || {};
        subject.set('hcso_status', { ...current, source: 'hcso', notBondable: current.notBondable || !!res?.notBondable, bondExceptionText: res?.bondExceptionText || current.bondExceptionText || null, moreChargesPossible: current.moreChargesPossible || !!res?.moreChargesPossible });
        await subject.save();
      }
      if (res?.dob) {
        subject.set('dob', res.dob);
        await subject.save();
        await updateStep(jobId, 'hcso_dob', 'SUCCEEDED');
      } else {
        if (!res?.notInJail) {
          const reason = res?.noRecord ? 'NO_RECORD' : 'DOB_NOT_FOUND';
          await updateStep(jobId, 'hcso_dob', 'UNRESOLVED', { reason, info: res?.rawHtmlSnippet ? 'SNIPPET_ATTACHED' : 'NO_MATCH', notBondable: !!res?.notBondable, bondExceptionText: res?.bondExceptionText, moreChargesPossible: !!res?.moreChargesPossible });
        }
        partial = true;
      }
    } catch (e: any) {
      await updateStep(jobId, 'hcso_dob', 'UNRESOLVED', { error: String(e) });
      partial = true;
    }
  } else {
    await updateStep(jobId, 'hcso_dob', 'SKIPPED', { reason: existingDob ? 'DOB_ALREADY_PRESENT' : 'DISABLED' });
  }

  if (mode === 'dob-only') {
    // End early after DOB step
    subject.set('enrichment_status', partial ? 'PARTIAL' : 'SUCCEEDED');
    subject.set('enrichment_last_run_at', new Date());
    await subject.save();
    return { partial };
  }

  // 1) provider search (prefer Pipl if enabled, else PDL)
  await updateStep(jobId, 'pdl_search', 'RUNNING');
  let pdl: any = null;
  let usedProvider: 'pipl' | 'pdl' | null = null;
  const dobPresent = !!(subject as any)?.dob;
  const ingestionIso = getIngestionTimestamp(subject as any);
  const winHours = Math.max(1, Math.min(168, Number(runOpts?.windowHoursOverride || config.enrichmentWindowHours)));
  const withinWindow = ingestionIso ? isWithinWindow(ingestionIso, winHours) : false;
  const bondVal = typeof (subject as any)?.bond_amount === 'number' ? (subject as any).bond_amount : (typeof (subject as any)?.bond === 'number' ? (subject as any).bond : 0);
  const bondOk = bondVal >= (typeof runOpts?.minBondOverride === 'number' ? runOpts!.minBondOverride! : config.bondThreshold);
  if ((config as any).providerPiplEnabled && (config as any).piplApiKey && dobPresent && withinWindow && bondOk) {
    try {
      pdl = await piplSearch(subject);
      usedProvider = 'pipl';
      await updateStep(jobId, 'pdl_search', 'SUCCEEDED', { provider: 'pipl' });
    } catch (e: any) {
      await updateStep(jobId, 'pdl_search', 'UNRESOLVED', { error: String(e), provider: 'pipl' });
      partial = true;
    }
  } else if ((config as any).providerPdlEnabled && config.pdlApiKey && dobPresent && withinWindow && bondOk) {
    try {
      pdl = await pdlSearch(subject);
      usedProvider = 'pdl';
      await updateStep(jobId, 'pdl_search', 'SUCCEEDED', { provider: 'pdl' });
    } catch (e: any) {
      await updateStep(jobId, 'pdl_search', 'UNRESOLVED', { error: String(e), provider: 'pdl' });
      partial = true;
    }
  } else {
    const reason = !dobPresent ? 'NO_DOB' : (!withinWindow ? 'OUT_OF_WINDOW' : (!bondOk ? 'BOND_BELOW_THRESHOLD' : 'PROVIDER_DISABLED'));
    await updateStep(jobId, 'pdl_search', 'SKIPPED', { reason, piplEnabled: !!(config as any).providerPiplEnabled, pdlEnabled: !!(config as any).providerPdlEnabled });
  }
  // raw payload persistence handled by pdlClient (cache or network)

  // 2) pick_candidate
  await updateStep(jobId, 'pick_candidate', 'RUNNING');
  const candidates = (pdl?.data?.matches || []) as any[];
  let chosen: any = null;
  let matchScore = 0;
  // augment scoring: boost if dob/address agree with base subject
  const subjDobIso = ((): string|undefined => { try { const d=(subject as any)?.dob; if(!d) return; const dt=new Date(d); if(!isNaN(dt.getTime())){ const y=dt.getFullYear(), m=String(dt.getMonth()+1).padStart(2,'0'), day=String(dt.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; } } catch{} return undefined; })();
  const subjStreet = ((subject as any)?.address || (subject as any)?.addr || '').toString().toLowerCase().replace(/\s+/g,' ').trim();
  const subjZip = ((subject as any)?.zip || '').toString().trim();
  const scoreCandidate = (c: any) => {
    let base = typeof c['@match'] === 'number' ? c['@match'] : 0;
    // DOB agreement
    if (subjDobIso && c?.dob && String(c.dob).startsWith(subjDobIso)) base += 0.2;
    // Address agreement (street contains street and/or zip matches)
    const addr = Array.isArray(c?.addresses) ? c.addresses[0] : undefined;
    const cStreet = (addr?.street || addr?.display || '').toString().toLowerCase();
    const cZip = (addr?.zip || '').toString().trim();
    if (subjStreet && cStreet && cStreet.includes(subjStreet)) base += 0.2;
    if (subjZip && cZip && subjZip === cZip) base += 0.1;
    return base;
  };
  for (const c of candidates) {
    const s = scoreCandidate(c);
    if (s > matchScore) { matchScore = s; chosen = c; }
  }
  if (!chosen || matchScore < 0.7) {
    partial = true;
    await updateStep(jobId, 'pick_candidate', 'FAILED', { reason: 'LOW_MATCH', matchScore });
    // Relationship-first capture: if provider returned possible persons, try to lift any relationships into RelatedPartyModel
    try {
      const relLifted: any[] = [];
      for (const c of candidates.slice(0, 5)) {
        const rels = Array.isArray((c as any)?.relationships) ? (c as any).relationships : [];
        for (const r of rels.slice(0, 5)) {
          const name = [r?.names?.[0]?.first, r?.names?.[0]?.last].filter(Boolean).join(' ').trim() || r?.name || r?.display || null;
          if (!name) continue;
          const signals = { sharesRecentAddress: false, reversePhoneHit: false, explicitRelationship: true, lastNameCityMatch: false, appearsInProviders: 1, socialConsistencyScore: 0 };
          const { score, label } = scoreRelatedParty(signals);
          const pid = buildPartyId(String(name), (subject as any)?.city, (subject as any)?.dob || null);
          await RelatedPartyModel.updateOne(
            { subjectId, partyId: pid },
            { $set: { name: String(name), relationType: label === 'likely_kin' ? 'family' : 'associate', confidence: score }, $addToSet: { sources: { $each: [usedProvider || 'pdl'] } } },
            { upsert: true }
          );
          relLifted.push(String(name));
        }
      }
      if (relLifted.length) {
        await RawProviderPayloadModel.create({ jobId, provider: usedProvider || 'pdl', step: 'relationships_lifted', payload: { count: relLifted.length, names: relLifted.slice(0, 10) }, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
      }
    } catch (e) {
      logger.warn('relationship-first lift failed', { err: String(e) });
    }
  } else {
  await updateStep(jobId, 'pick_candidate', 'SUCCEEDED', { matchScore, provider: usedProvider });
    // Persist core PDL mapping to subject (subdoc) and update DOB if missing
    try {
      const pdlMap: any = {
        asOf: new Date().toISOString(),
        matchScore,
        phones: Array.isArray(chosen?.phones) ? chosen.phones : [],
        emails: Array.isArray(chosen?.emails) ? chosen.emails : [],
        addresses: Array.isArray(chosen?.addresses) ? chosen.addresses : [],
        usernames: Array.isArray(chosen?.usernames) ? chosen.usernames : [],
        user_ids: Array.isArray(chosen?.user_ids) ? chosen.user_ids : [],
      };
      subject.set('pdl', pdlMap);
      if (!subject.get('dob') && (chosen as any)?.dob) {
        subject.set('dob', (chosen as any).dob);
      }
      await subject.save();
    } catch (e) {
      logger.warn('PDL mapping save error', { err: String(e) });
    }
  }

  // 3) reverse_address (cap 3)
  await updateStep(jobId, 'reverse_address', 'RUNNING');
  const addresses = (chosen?.addresses || []).slice(0, 3);
  const addrRes = (config as any).providerPdlEnabled && config.pdlApiKey && candidates.length && usedProvider==='pdl' ? await pdlReverseAddress(addresses) : { data: [] };
  await RawProviderPayloadModel.create({ jobId, provider: 'pdl', step: 'reverse_address', payload: addrRes, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
  await updateStep(jobId, 'reverse_address', (config as any).providerPdlEnabled && config.pdlApiKey ? 'SUCCEEDED' : 'SKIPPED');

  // 4) reverse_phone (cap 5)
  await updateStep(jobId, 'reverse_phone', 'RUNNING');
  const doNotCall = Boolean((subject as any)?.do_not_call);
  let phones = doNotCall ? [] : (chosen?.phones || []).slice(0, 5);
  if (!doNotCall && phones.length === 0) {
    const subjPhones = Array.isArray((subject as any)?.phones) ? (subject as any).phones : [];
    const norm = (p: any) => String(p||'').replace(/\D+/g,'').replace(/^1(?=\d{10}$)/,'');
    const unique = Array.from(new Set(subjPhones.map(norm))).filter(Boolean).slice(0, 5);
    phones = unique;
  }
  const phoneRes = doNotCall ? { data: [] } : ((config as any).providerPdlEnabled && config.pdlApiKey && candidates.length && usedProvider==='pdl' ? await pdlReversePhone(phones) : { data: [] });
  await RawProviderPayloadModel.create({ jobId, provider: 'pdl', step: 'reverse_phone', payload: phoneRes, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
  await updateStep(jobId, 'reverse_phone', (config as any).providerPdlEnabled && config.pdlApiKey ? 'SUCCEEDED' : 'SKIPPED');

  // 5) whitepages
  await updateStep(jobId, 'whitepages', 'RUNNING');
  const wp = ((config as any).providerWhitepagesEnabled && config.whitepagesApiKey) ? await whitepagesLookup({ phones, subject }) : { data: [] };
  await RawProviderPayloadModel.create({ jobId, provider: 'whitepages', step: 'whitepages', payload: wp, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
  await updateStep(jobId, 'whitepages', ((config as any).providerWhitepagesEnabled && config.whitepagesApiKey) ? 'SUCCEEDED' : 'SKIPPED');

  // 6) social_scan
  await updateStep(jobId, 'social_scan', 'RUNNING');
  const social = ((config as any).providerOpenaiEnabled && config.openaiApiKey) ? await socialScan({ chosen, subject }) : { data: { score: 0 } };
  await RawProviderPayloadModel.create({ jobId, provider: 'openai', step: 'social_scan', payload: social, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
  await updateStep(jobId, 'social_scan', ((config as any).providerOpenaiEnabled && config.openaiApiKey) ? 'SUCCEEDED' : 'SKIPPED');

  // 7) rank_store
  await updateStep(jobId, 'rank_store', 'RUNNING');
  // naive summary: save facts to subject
  const facts = subject.get('facts') || {};
  facts.phones = Array.from(new Set([...(facts.phones || []), ...phones]));
  const emails = Array.isArray((chosen as any)?.emails) ? (chosen as any).emails : [];
  facts.emails = Array.from(new Set([...(facts.emails || []), ...emails]));
  facts.addresses = Array.from(new Set([...(facts.addresses || []), ...addresses.map((a: any) => a?.street || a)]));
  facts.usernames = Array.from(new Set([...(facts.usernames || []), ...(chosen?.usernames || [])]));
  facts.user_ids = Array.from(new Set([...(facts.user_ids || []), ...(chosen?.user_ids || [])]));
  subject.set('facts', facts);
  subject.set('enrichment_status', partial ? 'PARTIAL' : 'SUCCEEDED');
  subject.set('enrichment_last_run_at', new Date());
  await subject.save();
  // create one related party if we have a username as associate
  const username = (chosen?.usernames || [])[0];
  if (username) {
    const signals = { sharesRecentAddress: false, reversePhoneHit: phones.length > 0, explicitRelationship: false, lastNameCityMatch: false, appearsInProviders: 2, socialConsistencyScore: social?.data?.score || 0 };
    const { score, label } = scoreRelatedParty(signals);
    const partyName = String(username);
    const pid = buildPartyId(partyName, subject.city, (subject as any)?.dob || null);
    await RelatedPartyModel.updateOne(
      { subjectId, partyId: pid },
      {
        $set: {
          name: partyName,
          relationType: label === 'likely_kin' ? 'family' : 'associate',
          confidence: score,
        },
        $addToSet: { sources: { $each: ['pdl', 'openai'] }, 'contacts.phones': { $each: phones } },
      },
      { upsert: true }
    );
  }
  await updateStep(jobId, 'rank_store', 'SUCCEEDED');

  return { partial };
}
