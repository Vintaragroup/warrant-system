import mongoose from 'mongoose';
import { filterByDepartment } from './authz.js';

// County collections mapping (read directly from simple_* collections)
export const COUNTY_COLLECTIONS = [
  'simple_brazoria',
  'simple_fortbend',
  'simple_galveston',
  'simple_harris',
  'simple_jefferson',
];

// V2 pipeline collections — the fallback search order matches GET /cases/:id
// so records displayed by the dashboard (which reads v2_* collections) can
// be resolved.
export const V2_COUNTY_COLLECTIONS = [
  'v2_galveston_events',
  'v2_harris_reports',
  'v2_wharton_events',
  'v2_lookup_results',
  'v2_jefferson_events',
];

export const ALL_CASE_COLLECTIONS = [...COUNTY_COLLECTIONS, ...V2_COUNTY_COLLECTIONS];

export const CASE_SCOPE_FIELDS = [
  'crm_details.assignedDepartment',
  'crm_details.department',
  'crm_details.assignedTo',
  'department',
  'county',
];

export function scopedCaseFilter(req, baseFilter = {}, options = { includeUnassigned: true }) {
  return filterByDepartment(baseFilter, req, CASE_SCOPE_FIELDS, options);
}

const MAX_DB_MS = parseInt(process.env.CASES_MAX_DB_MS || process.env.MAX_DB_MS || '12000', 10);

function withTimeout(promise, ms = MAX_DB_MS, label = 'caseAccess op') {
  let timer;
  const p = (promise && typeof promise.then === 'function') ? promise : Promise.resolve(promise);
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => {
        console.warn(`[caseAccess] ${label} timed out after ${ms}ms`);
        rej(new Error('operation timed out'));
      }, ms);
    }),
  ]);
}

/**
 * Resolves a case by searching simple_* first, then v2_* pipeline
 * collections — same fallback order as GET /cases/:id. This is an
 * EXISTENCE/ACCESS check (applies scopedCaseFilter for department/county
 * scoping) that returns which collection the case actually lives in, so
 * callers can key CRM overlay writes correctly regardless of source.
 *
 * Returns { doc, collection } or null if not found / not in scope.
 */
export async function findRawCaseDocForAccessCheck(req, caseIdParam) {
  let objectId;
  try {
    objectId = new mongoose.Types.ObjectId(caseIdParam);
  } catch {
    const err = new Error('Invalid case id');
    err.statusCode = 400;
    throw err;
  }

  const scoped = scopedCaseFilter(req, { _id: objectId });
  const db = mongoose.connection.db;
  for (const collName of ALL_CASE_COLLECTIONS) {
    const found = await withTimeout(
      db.collection(collName).findOne(scoped),
      MAX_DB_MS,
      `case lookup: ${collName}`
    ).catch(() => null);
    if (found) return { doc: found, collection: collName };
  }
  return null;
}
