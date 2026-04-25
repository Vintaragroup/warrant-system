import { URL } from 'node:url';
import { sanitizeString } from '../utils.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.WHITEPAGES_TIMEOUT_MS || 8000);
const DEFAULT_CACHE_MINUTES = Number(process.env.WHITEPAGES_CACHE_TTL_MINUTES || process.env.WHITEPAGES_TTL_MINUTES || 60);
const DEFAULT_ERROR_CACHE_MINUTES = Number(process.env.WHITEPAGES_ERROR_CACHE_TTL_MINUTES || Math.min(DEFAULT_CACHE_MINUTES, 15));

function buildSearchUrl(params = {}) {
  const apiKey = process.env.WHITEPAGES_API_KEY;
  if (!apiKey) {
    const err = new Error('WHITEPAGES_API_KEY is not configured');
    err.code = 'ENRICHMENT_MISCONFIGURED';
    throw err;
  }

  const endpoint = 'https://proapi.whitepages.com/3.3/person';
  const url = new URL(endpoint);
  url.searchParams.set('api_key', apiKey);

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

  const normalizedFullName = sanitizeString(fullName);
  const normalizedFirst = sanitizeString(firstName);
  const normalizedLast = sanitizeString(lastName);
  const normalizedCity = sanitizeString(city);
  const normalizedState = sanitizeString(stateCode);
  const normalizedPostal = sanitizeString(postalCode);
  const normalizedAddress1 = sanitizeString(addressLine1);
  const normalizedAddress2 = sanitizeString(addressLine2);
  const normalizedPhone = sanitizeString(phone);

  if (normalizedFullName) url.searchParams.set('name', normalizedFullName);
  if (normalizedFirst) url.searchParams.set('first_name', normalizedFirst);
  if (normalizedLast) url.searchParams.set('last_name', normalizedLast);
  if (normalizedAddress1) url.searchParams.set('street_line_1', normalizedAddress1);
  if (normalizedAddress2) url.searchParams.set('street_line_2', normalizedAddress2);
  if (normalizedCity) url.searchParams.set('city', normalizedCity);
  if (normalizedState) url.searchParams.set('state_code', normalizedState);
  if (normalizedPostal) url.searchParams.set('postal_code', normalizedPostal);
  if (normalizedPhone) url.searchParams.set('phone', normalizedPhone);

  return url;
}

function normalizeContacts(phones = []) {
  if (!Array.isArray(phones)) return [];
  return phones
    .map((entry) => ({
      type: sanitizeString(entry?.contact_type || entry?.type),
      value: sanitizeString(entry?.phone_number || entry?.value || entry?.phone),
      lineType: sanitizeString(entry?.line_type || entry?.lineType),
      carrier: sanitizeString(entry?.carrier || entry?.carrier_name),
    }))
    .filter((item) => Boolean(item.value));
}

function normalizeAddresses(addresses = []) {
  if (!Array.isArray(addresses)) return [];
  return addresses.map((address) => ({
    streetLine1: sanitizeString(address?.street_line_1 || address?.streetLine1 || address?.street),
    streetLine2: sanitizeString(address?.street_line_2 || address?.streetLine2),
    city: sanitizeString(address?.city),
    stateCode: sanitizeString(address?.state_code || address?.state || address?.stateCode),
    postalCode: sanitizeString(address?.postal_code || address?.postalCode),
    countryCode: sanitizeString(address?.country_code || address?.countryCode),
    type: sanitizeString(address?.address_type || address?.type),
  }));
}

function normalizeRelations(relatives = []) {
  if (!Array.isArray(relatives)) return [];
  return relatives
    .map((relative) => ({
      name: sanitizeString(relative?.name || relative?.full_name || relative?.person_name),
      relation: sanitizeString(relative?.relation || relative?.relationship_type || relative?.relationship),
    }))
    .filter((item) => item.name || item.relation);
}

function normalizeCandidate(result) {
  if (!result || typeof result !== 'object') return null;
  const names = result.names || [];
  const primaryName = Array.isArray(names) && names.length ? names[0] : null;
  const fullName = sanitizeString(
    result?.full_name
      || result?.name
      || (primaryName?.first_name && primaryName?.last_name
        ? `${primaryName.first_name} ${primaryName.last_name}`
        : undefined)
  );

  const recordId = sanitizeString(result?.id || result?.uuid || result?.identity_id || fullName);

  return {
    recordId,
    fullName,
    firstName: sanitizeString(primaryName?.first_name || result?.first_name),
    lastName: sanitizeString(primaryName?.last_name || result?.last_name),
    ageRange: sanitizeString(result?.age_range?.description || result?.age_range || result?.ageRange),
    gender: sanitizeString(result?.gender),
    score: typeof result?.best_location_score === 'number' ? result.best_location_score : undefined,
    contacts: normalizeContacts(result?.phones || result?.phone_numbers),
    addresses: normalizeAddresses(result?.addresses || result?.locations),
    relations: normalizeRelations(result?.relatives || result?.associates),
    additional: {
      ids: result?.ids || result?.identity_ids || undefined,
      lastSeen: result?.last_seen || result?.last_seen_date || undefined,
    },
  };
}

async function search(params = {}) {
  const url = buildSearchUrl(params);
  const timeoutMs = Number(params.timeoutMs || DEFAULT_TIMEOUT_MS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Whitepages request failed (${response.status})`;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error?.message) message = parsed.error.message;
        else if (parsed?.message) message = parsed.message;
      } catch {
        if (text) message = text;
      }
      const error = new Error(message || 'Whitepages request failed');
      error.status = response.status;
      error.code = 'ENRICHMENT_HTTP_ERROR';
      throw error;
    }

    const payload = await response.json();
    const rawResults = Array.isArray(payload?.results) ? payload.results : [];
    const candidates = rawResults
      .map((entry) => normalizeCandidate(entry))
      .filter(Boolean);

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
      meta: { count: candidates.length },
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('Whitepages request timed out');
      timeoutError.code = 'ENRICHMENT_TIMEOUT';
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  id: 'whitepages',
  label: 'Whitepages Pro',
  description: 'Whitepages skip-trace enrichment',
  ttlMinutes: DEFAULT_CACHE_MINUTES,
  errorTtlMinutes: DEFAULT_ERROR_CACHE_MINUTES,
  supportsForce: false,
  search,
};
