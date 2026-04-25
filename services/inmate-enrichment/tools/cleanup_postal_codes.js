#!/usr/bin/env node
/**
 * Cleanup Postal Codes Script
 * 
 * Finds all inmates with missing, empty, or stray ';' postal codes in either:
 * - crm_details.address.postalCode
 * - Inferred from mapped address (city, state)
 * 
 * For each, attempts to geocode the address and extract a valid ZIP.
 * 
 * Usage:
 *   node tools/cleanup_postal_codes.js [--dry-run] [--limit=50] [--collection=simple_harris]
 * 
 * Environment:
 *   MONGO_URI, MONGO_DB, SUBJECTS_COLLECTION (default: simple_harris)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

// Parse CLI args
const dryRun = process.argv.includes('--dry-run');
const limitStr = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1];
const collectionStr = process.argv.find(arg => arg.startsWith('--collection='))?.split('=')[1];
const limit = limitStr ? Number(limitStr) : null;
const collectionOverride = collectionStr || null;

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const warn = (msg) => console.warn(`[WARN] ${msg}`);

async function geocodeAddress(addressText) {
  if (!addressText || typeof addressText !== 'string') return null;
  const q = addressText.trim();
  if (!q) return null;

  try {
    // Try Nominatim first
    const nomUrl = new URL(NOMINATIM_URL);
    nomUrl.searchParams.append('format', 'json');
    nomUrl.searchParams.append('q', q);
    nomUrl.searchParams.append('limit', '1');
    nomUrl.searchParams.append('addressdetails', '1');

    const nomRes = await fetch(nomUrl.toString(), {
      headers: { 'User-Agent': 'cleanup_postal_codes/1.0' },
    });
    if (nomRes.ok) {
      const data = await nomRes.json();
      const first = Array.isArray(data) && data.length ? data[0] : null;
      if (first?.address?.postcode) {
        const addr = first.address || {};
        // Extract state code from address.state_code (e.g., "TX") or derive from state name
        let stateCode = addr.state_code ? addr.state_code.toUpperCase() : '';
        if (!stateCode && addr.state) {
          // Try to extract 2-letter abbreviation from state name if available
          const stateMatch = String(addr.state).match(/[A-Z]{2}/);
          stateCode = stateMatch ? stateMatch[0] : '';
        }
        return {
          zip: first.address.postcode,
          stateCode,
          lat: first.lat,
          lon: first.lon,
          provider: 'nominatim',
        };
      }
    }
  } catch (e) {
    warn(`Nominatim geocode error for "${q}": ${e.message}`);
  }

  try {
    // Fallback: US Census
    const censusUrl = new URL(CENSUS_URL);
    censusUrl.searchParams.append('address', q);
    censusUrl.searchParams.append('benchmark', '2020');
    censusUrl.searchParams.append('format', 'json');

    const censusRes = await fetch(censusUrl.toString(), {
      headers: { 'User-Agent': 'cleanup_postal_codes/1.0' },
    });
    if (censusRes.ok) {
      const data = await censusRes.json();
      const match = data?.result?.addressMatches?.[0];
      if (match?.addressComponents?.zip) {
        const comp = match.addressComponents || {};
        const stateCode = String(comp.state || '').toUpperCase().slice(0, 2) || '';
        return {
          zip: match.addressComponents.zip,
          stateCode,
          lat: match.coordinates?.y,
          lon: match.coordinates?.x,
          provider: 'census',
        };
      }
    }
  } catch (e) {
    warn(`Census geocode error for "${q}": ${e.message}`);
  }

  return null;
}

async function buildAddressString(doc) {
  // Try CRM address first
  const crmAddr = doc.crm_details?.address;
  if (crmAddr && (crmAddr.streetLine1 || crmAddr.city)) {
    const parts = [];
    if (crmAddr.streetLine1) parts.push(crmAddr.streetLine1);
    if (crmAddr.city) parts.push(crmAddr.city);
    // Use state from CRM, fallback to root doc state
    const state = crmAddr.stateCode || doc.state || 'TX';
    if (state) parts.push(state);
    if (parts.length >= 2) return parts.join(', ');
  }

  // Fallback to subject address
  const subjectAddr = doc.address;
  if (subjectAddr && (subjectAddr.line1 || subjectAddr.city)) {
    const parts = [];
    if (subjectAddr.line1) parts.push(subjectAddr.line1);
    if (subjectAddr.city) parts.push(subjectAddr.city);
    const state = subjectAddr.state || doc.state || 'TX';
    if (state) parts.push(state);
    if (parts.length >= 2) return parts.join(', ');
  }

  return null;
}

function isValidZip(v) {
  if (!v) return false;
  const s = String(v).trim();
  return /^(\d{5})(?:-\d{4})?$/.test(s);
}

function isBadZip(v) {
  if (!v) return false;
  const s = String(v).trim();
  return s === ';' || s === '' || !isValidZip(s);
}

async function processBatch(col, docs) {
  const results = {
    total: docs.length,
    found_bad_zip: 0,
    geocoded: 0,
    updated: 0,
    errors: 0,
    samples: [],
  };

  for (const doc of docs) {
    try {
      const crmPostal = doc.crm_details?.address?.postalCode;
      const hasBadCrmZip = isBadZip(crmPostal);

      if (!hasBadCrmZip) {
        continue; // Skip if CRM zip is valid
      }

      results.found_bad_zip++;

      // Build address string to geocode
      const addressStr = await buildAddressString(doc);
      if (!addressStr) {
        warn(`No addressable for ${doc.spn}: skipping`);
        continue;
      }

      // Geocode
      const geoResult = await geocodeAddress(addressStr);
      if (!geoResult?.zip) {
        if (results.samples.length < 3) {
          results.samples.push({
            spn: doc.spn,
            reason: 'geocode_failed',
            addressTried: addressStr,
          });
        }
        continue;
      }

      results.geocoded++;

      if (dryRun) {
        if (results.samples.length < 5) {
          results.samples.push({
            spn: doc.spn,
            currentZip: crmPostal,
            currentState: doc.crm_details?.address?.stateCode || '(empty)',
            proposedZip: geoResult.zip,
            proposedState: geoResult.stateCode || '(not determined)',
            addressStr,
            provider: geoResult.provider,
            dryRun: true,
          });
        }
        continue;
      }

      // Update DB using updateOne (more reliable than findOneAndUpdate)
      const updateResult = await col.updateOne(
        { spn: doc.spn },
        {
          $set: {
            'crm_details.address.postalCode': geoResult.zip,
            ...(geoResult.stateCode && { 'crm_details.address.stateCode': geoResult.stateCode }),
            updatedAt: new Date(),
          },
        }
      );

      if (updateResult.modifiedCount > 0 || updateResult.matchedCount > 0) {
        results.updated++;
        if (results.samples.length < 5) {
          results.samples.push({
            spn: doc.spn,
            oldZip: crmPostal,
            oldState: doc.crm_details?.address?.stateCode || '(empty)',
            newZip: geoResult.zip,
            newState: geoResult.stateCode || '(not determined)',
            provider: geoResult.provider,
          });
        }
      } else {
        warn(`Update returned no result for ${doc.spn}: ${JSON.stringify(updateResult)}`);
      }
    } catch (e) {
      results.errors++;
      warn(`Error processing ${doc.spn}: ${e.message}`);
    }
  }

  return results;
}

(async () => {
  const MONGO_URI = process.env.MONGO_URI;
  const MONGO_DB = process.env.MONGO_DB || process.env.MONGO_DB_NAME;
  let COLLECTION = collectionOverride || process.env.SUBJECTS_COLLECTION || 'simple_harris';

  if (!MONGO_URI || !MONGO_DB) {
    console.error('MONGO_URI and MONGO_DB required');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
    const db = mongoose.connection.db;
    const col = db.collection(COLLECTION);

    log(`Connected to ${MONGO_DB}.${COLLECTION}`);
    log(`Dry-run mode: ${dryRun}`);
    if (limit) log(`Limit: ${limit}`);

    // Find docs with bad postal codes (including missing or ";" or empty)
    // First, let's get all with CRM address and check manually
    const allDocs = await col.find({ 'crm_details.address': { $exists: true } })
      .limit(limit || 1000)
      .toArray();
    
    const docs = allDocs.filter(doc => {
      const postal = doc.crm_details?.address?.postalCode;
      return isBadZip(postal);
    });

    log(`Found ${docs.length} candidates with bad postal codes`);

    if (!docs.length) {
      log('No postal codes to clean. Exiting.');
      await mongoose.disconnect();
      process.exit(0);
    }

    const batchSize = 10;
    const allResults = {
      total: 0,
      found_bad_zip: 0,
      geocoded: 0,
      updated: 0,
      errors: 0,
      samples: [],
    };

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize);
      log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(docs.length / batchSize)} (${batch.length} items)`);

      const batchResults = await processBatch(col, batch);
      allResults.total += batchResults.total;
      allResults.found_bad_zip += batchResults.found_bad_zip;
      allResults.geocoded += batchResults.geocoded;
      allResults.updated += batchResults.updated;
      allResults.errors += batchResults.errors;
      allResults.samples.push(...batchResults.samples);

      // Rate-limit
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    log('');
    log('=== SUMMARY ===');
    log(`Dry-run: ${dryRun}`);
    log(`Total candidates: ${allResults.total}`);
    log(`Found bad ZIPs: ${allResults.found_bad_zip}`);
    log(`Successfully geocoded: ${allResults.geocoded}`);
    log(`Updated in DB: ${allResults.updated}`);
    log(`Errors: ${allResults.errors}`);
    log('');
    log('Sample outcomes:');
    console.log(JSON.stringify(allResults.samples.slice(0, 10), null, 2));

    await mongoose.disconnect();
    log('Disconnected. Done.');
    process.exit(0);
  } catch (e) {
    console.error('Fatal error:', e);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(1);
  }
})();
