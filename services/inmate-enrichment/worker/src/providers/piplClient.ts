import axios from 'axios';
import pRetry from 'p-retry';
import { config, RawProviderPayloadModel } from '@inmate/shared';

function toDobIso(d: any): string | undefined {
  if (!d) return undefined;
  try {
    if (d instanceof Date) {
      const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
    if (typeof d === 'number') {
      const dt = new Date(d > 1e12 ? d : d * 1000);
      if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear(); const m = String(dt.getMonth() + 1).padStart(2, '0'); const dd = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      }
    }
    if (typeof d === 'string') {
      const s = d.trim(); if (!s) return undefined;
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear(); const m = String(dt.getMonth() + 1).padStart(2, '0'); const dd = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
      }
    }
  } catch {}
  return undefined;
}

export async function piplSearch(subject: any): Promise<any> {
  if (!(config as any).piplApiKey) {
    return { data: { matches: [] } };
  }
  // Pipl Search expects JSON body with key and a person object
  const url = 'https://api.pipl.com/search/';
  const first = (subject.first_name || '').toString().trim();
  const last = (subject.last_name || '').toString().trim();
  const altFirst = ((): string => {
    const t = first.split(/[\s-]+/).filter(Boolean);
    return t.length > 0 ? t[0] : first;
  })();
  const dobIso = toDobIso(subject.dob);
  const street = (subject.address || subject.addr || '').toString().trim();
  const city = (subject.city || '').toString().trim();
  const state = (subject.state || '').toString().trim();
  const zip = (subject.zip || '').toString().trim();

  const mkPerson = (opts: { useName?: boolean; useDob?: boolean; useAddress?: boolean; addressOnlyZip?: boolean; useAltFirst?: boolean }) => {
    const person: any = {};
    if (opts.useName && (first || last)) person.names = [{ first: opts.useAltFirst ? altFirst : first, last }];
    if (opts.useDob && dobIso) person.dob = dobIso;
    if (opts.useAddress) {
      const addr: any = { country: 'US' };
      if (opts.addressOnlyZip) {
        if (zip) addr.postal_code = zip; else {
          if (city) addr.city = city; if (state) addr.state = state;
        }
      } else {
        if (street) addr.street = street;
        if (city) addr.city = city;
        if (state) addr.state = state;
        if (zip) addr.postal_code = zip;
      }
      person.addresses = [addr];
    }
    return person;
  };

  const buildBodies = () => {
    const key = (config as any).piplApiKey;
    const bodies: any[] = [];
    // If we have a strong address (street + zip), try address-first to tighten the candidate pool
    const hasStrongAddr = Boolean(street && zip);
    if (hasStrongAddr) {
      // Attempt 1: name + full address (no dob)
      bodies.push({ key, person: mkPerson({ useName: true, useDob: false, useAddress: true, addressOnlyZip: false, useAltFirst: false }) });
      // Attempt 2: name + dob + full address
      bodies.push({ key, person: mkPerson({ useName: true, useDob: true, useAddress: true, addressOnlyZip: false, useAltFirst: false }) });
    } else {
      // Attempt 1: name + dob + full address
      bodies.push({ key, person: mkPerson({ useName: true, useDob: true, useAddress: true, addressOnlyZip: false, useAltFirst: false }) });
      // Attempt 2: name + full address (no dob)
      bodies.push({ key, person: mkPerson({ useName: true, useDob: false, useAddress: true, addressOnlyZip: false, useAltFirst: false }) });
    }
    // Attempt 3: name (altFirst) + ZIP/city/state only (coarse location)
    if (zip || city || state) bodies.push({ key, person: mkPerson({ useName: true, useDob: false, useAddress: true, addressOnlyZip: true, useAltFirst: true }) });
    // Fallback 4: name (altFirst) only
    bodies.push({ key, person: mkPerson({ useName: true, useDob: false, useAddress: false, addressOnlyZip: false, useAltFirst: true }) });
    return bodies;
  };

  const normalizeResponse = (data: any) => {
    const toIsoDob = (p: any): string | undefined => {
      try {
        const d = p?.dob;
        if (!d) return undefined;
        if (typeof d === 'string') return toDobIso(d);
        if (typeof d === 'object') {
          if (d?.date) return toDobIso(d.date);
          const y = d?.year, m = d?.month, day = d?.day;
          if (y && m && day) return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        }
      } catch {}
      return undefined;
    };
    const normalizePerson = (p: any) => {
      const phones = Array.isArray(p?.phones) ? p.phones.map((x: any) => x?.display_international || x?.number || x) : [];
      const emails = Array.isArray(p?.emails) ? p.emails.map((e: any) => e?.address || e) : [];
      const addresses = Array.isArray(p?.addresses)
        ? p.addresses.map((a: any) => ({
            street: a?.street || [a?.house, a?.street, a?.apt].filter(Boolean).join(' ').trim() || undefined,
            city: a?.city,
            state: a?.state,
            zip: a?.postal_code || a?.zip,
            display: [a?.street, a?.city, a?.state, a?.postal_code || a?.zip, a?.country].filter(Boolean).join(', '),
          }))
        : [];
      const relationships = Array.isArray(p?.relationships) ? p.relationships : Array.isArray(p?.relatives) ? p.relatives : [];
      const m = typeof p['@match'] === 'number' ? p['@match'] : (typeof data['@match'] === 'number' ? data['@match'] : 0.0);
      const dobN = toIsoDob(p) || undefined;
      return { '@match': m, phones, emails, addresses, relationships, dob: dobN };
    };
    let matches: any[] = [];
    if (Array.isArray(data?.possible_persons) && data.possible_persons.length) {
      matches = data.possible_persons.map((pp: any) => normalizePerson(pp));
    } else if (data?.person) {
      matches = [normalizePerson(data.person)];
    } else {
      matches = [];
    }
    return { data: { matches } };
  };

  const attemptBodies = buildBodies();
  let finalPayload: any = { data: { matches: [] } };
  for (let i = 0; i < attemptBodies.length; i++) {
    const body = attemptBodies[i];
    const payload = await pRetry(async () => {
      const resp = await axios.post(url, body, { timeout: 10000, headers: { 'Content-Type': 'application/json' } });
      const normalized = normalizeResponse(resp.data || {});
      await RawProviderPayloadModel.create({ provider: 'pipl', step: 'pipl_search', payload: { attempt: i+1, bodyPreview: { useName: !!body.person?.names, useDob: !!body.person?.dob, useAddress: !!body.person?.addresses, zip: body.person?.addresses?.[0]?.postal_code || undefined, altFirstUsed: body.person?.names?.[0]?.first === altFirst }, ...normalized }, ttlExpiresAt: new Date(Date.now() + config.rawPayloadTtlHours * 3600 * 1000) });
      return normalized;
    }, { retries: (config as any).providerMaxRetries || 2 });
    if ((payload?.data?.matches || []).length > 0) { finalPayload = payload; break; }
  }
  return finalPayload;
}
