import { sanitizeString, sanitizePhone } from '../utils.js';

const ENDPOINT = 'https://api.pipl.com/search/';
const DEFAULT_TIMEOUT_MS = Number(process.env.PIPL_TIMEOUT_MS || 8000);
const DEFAULT_CACHE_MINUTES = Number(process.env.PIPL_CACHE_TTL_MINUTES || 240);
const DEFAULT_ERROR_CACHE_MINUTES = Number(process.env.PIPL_ERROR_CACHE_TTL_MINUTES || Math.min(DEFAULT_CACHE_MINUTES, 30));

function buildRequestBody(params = {}) {
  const apiKey = process.env.PIPL_API_KEY;
  if (!apiKey) {
    const err = new Error('PIPL_API_KEY is not configured');
    err.code = 'ENRICHMENT_MISCONFIGURED';
    throw err;
  }

  const {
    firstName,
    lastName,
    fullName,
    city,
    stateCode,
    postalCode,
    addressLine1,
    addressLine2,
    phone,
  } = params;

  const person = {};

  const names = [];
  const sanitizedFirst = sanitizeString(firstName);
  const sanitizedLast = sanitizeString(lastName);
  const sanitizedFull = sanitizeString(fullName);

  if (sanitizedFirst || sanitizedLast) {
    names.push({ first: sanitizedFirst, last: sanitizedLast });
  } else if (sanitizedFull) {
    const split = sanitizedFull.split(/\s+/);
    if (split.length > 1) {
      names.push({ first: split[0], last: split.slice(1).join(' ') });
    } else {
      names.push({ first: sanitizedFull });
    }
  }

  if (names.length) {
    person.names = names;
  }

  const streets = sanitizeString(addressLine1) || sanitizeString(addressLine2);
  const citySanitized = sanitizeString(city);
  const stateSanitized = sanitizeString(stateCode);
  const postalSanitized = sanitizeString(postalCode);

  const addresses = [];
  if (streets || citySanitized || stateSanitized || postalSanitized) {
    addresses.push({
      street: sanitizeString(addressLine1),
      street_2: sanitizeString(addressLine2),
      city: citySanitized,
      state: stateSanitized,
      postal_code: postalSanitized,
    });
  }
  if (addresses.length) {
    person.addresses = addresses;
  }

  const phoneDigits = sanitizePhone(phone);
  if (phoneDigits) {
    person.phones = [{ number: phoneDigits }];
  }

  return {
    api_key: apiKey,
    person,
    minimum_probability: 0.5,
    show_sources: false,
  };
}

function normalizeEmails(emails = []) {
  if (!Array.isArray(emails)) return [];
  return emails
    .map((entry) => sanitizeString(entry?.address || entry?.email))
    .filter(Boolean);
}

function normalizePhones(phones = []) {
  if (!Array.isArray(phones)) return [];
  return phones
    .map((phone) => {
      const number = sanitizeString(phone?.display || phone?.number);
      if (!number) return null;
      return {
        type: sanitizeString(phone?.type) || 'phone',
        value: number,
        lineType: sanitizeString(phone?.number_type || phone?.valid_since),
        carrier: sanitizeString(phone?.carrier),
      };
    })
    .filter(Boolean);
}

function normalizeAddresses(addresses = []) {
  if (!Array.isArray(addresses)) return [];
  return addresses
    .map((address) => ({
      streetLine1: sanitizeString(address?.street || address?.display)
        || [sanitizeString(address?.house), sanitizeString(address?.street)].filter(Boolean).join(' ')
        || undefined,
      streetLine2: sanitizeString(address?.apartment) || undefined,
      city: sanitizeString(address?.city),
      stateCode: sanitizeString(address?.state || address?.stateCode),
      postalCode: sanitizeString(address?.postal_code || address?.zip),
      countryCode: sanitizeString(address?.country || address?.country_code),
      type: sanitizeString(address?.type),
    }))
    .filter((item) => item.streetLine1 || item.city || item.stateCode || item.postalCode);
}

function normalizeRelations(relationships = []) {
  if (!Array.isArray(relationships)) return [];
  return relationships
    .map((relation) => {
      const names = Array.isArray(relation?.names) ? relation.names : [];
      const primary = names.length ? names[0] : null;
      const name = sanitizeString(primary?.display) || sanitizeString(primary?.first);
      const relationType = sanitizeString(relation?.type || relation?.relationship);
      if (!name && !relationType) return null;
      return { name, relation: relationType };
    })
    .filter(Boolean);
}

function normalizeCandidate(person = {}) {
  const recordId = sanitizeString(person['@id'] || person?.id || person?.match_id);
  const names = Array.isArray(person.names) ? person.names : [];
  const primaryName = names.length ? names[0] : null;
  const fullName = sanitizeString(person.display) || sanitizeString(person.name) || sanitizeString(person?.full_name);

  return {
    recordId,
    fullName: fullName || sanitizeString(primaryName?.first && primaryName?.last ? `${primaryName.first} ${primaryName.last}` : primaryName?.first),
    firstName: sanitizeString(primaryName?.first),
    lastName: sanitizeString(primaryName?.last),
    ageRange: sanitizeString(person?.age_range?.display || person?.dob?.display),
    gender: sanitizeString(person?.gender),
    score: typeof person?.match === 'number' ? person.match : undefined,
    contacts: normalizePhones(person?.phones),
    addresses: normalizeAddresses(person?.addresses),
    relations: normalizeRelations(person?.relationships),
    additional: {
      emails: normalizeEmails(person?.emails),
      educations: person?.educations,
      jobs: person?.jobs,
      pronouns: person?.pronouns,
      sources: Array.isArray(person?.sources) ? person.sources.map((src) => sanitizeString(src?.name)).filter(Boolean) : undefined,
    },
  };
}

async function search(params = {}) {
  const body = buildRequestBody(params);
  const timeoutMs = Number(params.timeoutMs || DEFAULT_TIMEOUT_MS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `Pipl request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.code = 'ENRICHMENT_HTTP_ERROR';
      throw error;
    }

    if (payload?.error) {
      const error = new Error(payload.error.message || 'Pipl request failed');
      error.code = payload.error.code || 'ENRICHMENT_HTTP_ERROR';
      throw error;
    }

    const possiblePersons = Array.isArray(payload?.possible_persons) ? payload.possible_persons : [];
    const candidates = possiblePersons
      .map((person) => normalizeCandidate(person))
      .filter((candidate) => candidate && (candidate.fullName || candidate.recordId));

    if (!candidates.length) {
      return {
        status: 'empty',
        candidates: [],
        meta: { count: 0 },
      };
    }

    return {
      status: 'success',
      candidates,
      meta: {
        count: candidates.length,
        availableRecords: payload?.available_records,
      },
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Pipl request timed out');
      timeoutError.code = 'ENRICHMENT_TIMEOUT';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  id: 'pipl',
  label: 'Pipl Identity',
  description: 'Pipl person search & relationship enrichment',
  ttlMinutes: DEFAULT_CACHE_MINUTES,
  errorTtlMinutes: DEFAULT_ERROR_CACHE_MINUTES,
  supportsForce: true,
  search,
};
