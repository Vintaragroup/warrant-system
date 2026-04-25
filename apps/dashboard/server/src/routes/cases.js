import { Router } from 'express';
import mongoose from 'mongoose';
import Case from '../models/Case.js';
import Message from '../models/Message.js';
import CaseAudit from '../models/CaseAudit.js';
import CaseEnrichment from '../models/CaseEnrichment.js';
import { listMessages, resendMessage as queueResendMessage } from '../services/messaging.js';
import { assertPermission as ensurePermission, filterByDepartment, hasPermission } from './utils/authz.js';
import { listProviders as listEnrichmentProviders, getProvider as getEnrichmentProvider, getDefaultProviderId } from '../lib/enrichment/registry.js';
import { splitName, nextExpiry } from '../lib/enrichment/utils.js';

// County collections mapping (read directly from simple_* collections)
const COUNTY_COLLECTIONS = [
  'simple_brazoria',
  'simple_fortbend',
  'simple_galveston',
  'simple_harris',
  'simple_jefferson',
];

const COUNTY_MAP = new Map([
  ['brazoria', 'simple_brazoria'],
  ['fortbend', 'simple_fortbend'],
  ['galveston', 'simple_galveston'],
  ['harris', 'simple_harris'],
  ['jefferson', 'simple_jefferson'],
]);

// Per-file DB timeout for potentially expensive queries (env overridable)
// Bump a bit for wide attention scans to avoid near-miss timeouts
const MAX_DB_MS = parseInt(process.env.CASES_MAX_DB_MS || process.env.MAX_DB_MS || '12000', 10);

// Helper to timeout a promise-returning DB operation so handlers don't hang
function withTimeout(promise, ms = MAX_DB_MS, label = 'cases op') {
  let timer;
  const p = (promise && typeof promise.then === 'function') ? promise : Promise.resolve(promise);
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => {
        console.warn(`[cases] ${label} timed out after ${ms}ms`);
        rej(new Error('operation timed out'));
      }, ms);
    }),
  ]);
}

// Tiny in-memory cache for expensive stats endpoint
const CACHE_TTL_MS = parseInt(process.env.CASES_CACHE_MS || process.env.DASH_CACHE_MS || '30000', 10);
const _cache = new Map(); // key -> { ts, data }
const _inflight = new Map(); // key -> Promise
const cacheGet = (k) => {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(k); return null; }
  return e.data;
};
const cacheSet = (k, v) => _cache.set(k, { ts: Date.now(), data: v });
const DEFAULT_ENRICHMENT_TTL_MINUTES = Number(process.env.ENRICHMENT_CACHE_TTL_MINUTES || 60);
const DEFAULT_ENRICHMENT_ERROR_TTL_MINUTES = Number(process.env.ENRICHMENT_ERROR_CACHE_TTL_MINUTES || 15);
async function withCache(key, compute) {
  const hit = cacheGet(key);
  if (hit !== null) return { fromCache: true, data: hit };
  if (_inflight.has(key)) {
    try { const d = await _inflight.get(key); return { fromCache: true, data: d }; } catch {}
  }
  const p = (async () => await compute())();
  _inflight.set(key, p);
  try { const d = await p; cacheSet(key, d); return { fromCache: false, data: d }; }
  finally { _inflight.delete(key); }
}

const r = Router();

const ALLOWED_MANUAL_TAGS = new Set(['priority', 'needs_attention', 'disregard']);
const TRUE_SET = new Set(['1', 'true', 'yes']);
const CRM_STAGES = ['new', 'contacted', 'qualifying', 'accepted', 'denied'];
const CRM_CHECKLIST = [
  { key: 'id', label: 'Photo ID', required: true },
  { key: 'references', label: 'References verified', required: true },
  { key: 'proof_income', label: 'Proof of income', required: true },
  { key: 'collateral', label: 'Collateral documented', required: false },
  { key: 'co_signer', label: 'Co-signer interviewed', required: false },
];

const CASE_SCOPE_FIELDS = [
  'crm_details.assignedDepartment',
  'crm_details.department',
  'crm_details.assignedTo',
  'department',
  'county',
];

function scopedCaseFilter(req, baseFilter = {}, options = { includeUnassigned: true }) {
  return filterByDepartment(baseFilter, req, CASE_SCOPE_FIELDS, options);
}

function ensureMongoConnected(res) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }
  return true;
}

function normalizeChecklist(documents = []) {
  const map = new Map();

  documents.forEach((item) => {
    if (!item) return;
    if (typeof item === 'string') {
      map.set(item, {
        key: item,
        label: item.replace(/_/g, ' '),
        required: false,
        status: 'completed',
        completedAt: null,
        note: '',
      });
      return;
    }
    const key = item.key || item.label || null;
    if (!key) return;
    map.set(String(key), {
      key: String(key),
      label: item.label || String(key).replace(/_/g, ' '),
      required: Boolean(item.required),
      status: item.status === 'completed' ? 'completed' : 'pending',
      completedAt: item.completedAt ? new Date(item.completedAt) : null,
      note: item.note ? String(item.note) : '',
    });
  });

  CRM_CHECKLIST.forEach((item) => {
    if (!map.has(item.key)) {
      map.set(item.key, {
        key: item.key,
        label: item.label,
        required: item.required,
        status: 'pending',
        completedAt: null,
        note: '',
      });
    } else {
      const existing = map.get(item.key);
      existing.label = existing.label || item.label;
      if (item.required) existing.required = true;
    }
  });

  return Array.from(map.values());
}

function normalizeAttachments(attachments = [], previous = []) {
  const prevMap = new Map();
  (previous || []).forEach((att) => {
    if (!att) return;
    if (att.id) {
      prevMap.set(String(att.id), att);
    } else if (att.attachmentId) {
      prevMap.set(String(att.attachmentId), att);
    } else if (att.filename) {
      prevMap.set(att.filename, att);
    }
  });

  const parseDate = (value, fallback) => {
    if (!value) return fallback || null;
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback || null : dt;
  };

  return (attachments || [])
    .map((item) => {
      if (!item) return null;
      const id = String(item.id || item.attachmentId || item.filename || new mongoose.Types.ObjectId().toString());
      const existing = prevMap.get(String(item.id || ''))
        || prevMap.get(String(item.attachmentId || ''))
        || (item.filename ? prevMap.get(item.filename) : null)
        || {};

      return {
        id,
        filename: item.filename ?? existing.filename ?? '',
        originalName: item.originalName ?? existing.originalName ?? '',
        url: item.url ?? existing.url ?? '',
        mimeType: item.mimeType ?? existing.mimeType ?? '',
        size: item.size != null ? Number(item.size) : existing.size ?? 0,
        uploadedAt: parseDate(item.uploadedAt, parseDate(existing.uploadedAt, new Date())) || new Date(),
        label:
          item.label != null
            ? String(item.label)
            : existing.label ?? existing.originalName ?? existing.filename ?? item.originalName ?? item.filename ?? '',
        note: item.note != null ? String(item.note) : existing.note ?? '',
        checklistKey:
          item.checklistKey != null
            ? (item.checklistKey === '' ? null : String(item.checklistKey))
            : existing.checklistKey ?? null,
      };
    })
    .filter(Boolean);
}

r.get('/enrichment/providers', (req, res) => {
  try {
    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const providers = listEnrichmentProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      description: provider.description || null,
      supportsForce: Boolean(provider.supportsForce),
      default: provider.id === getDefaultProviderId(),
    }));
    res.json({ providers });
  } catch (err) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

function buildEnrichmentParams(caseDoc = {}, overrides = {}) {
  const sourceName = overrides.fullName || overrides.name || caseDoc?.full_name || '';
  const nameParts = splitName(sourceName);

  const firstName = overrides.firstName || overrides.givenName || nameParts.firstName;
  const lastName = overrides.lastName || overrides.surname || nameParts.lastName;
  const fullName = overrides.fullName || overrides.name || nameParts.fullName;

  const crmAddr = caseDoc?.crm_details?.address || {};
  const crmPhone = caseDoc?.crm_details?.phone || undefined;

  const city = overrides.city || overrides.town || crmAddr.city || undefined;
  const stateCode = overrides.state || overrides.stateCode || crmAddr.stateCode || undefined;
  const postalCode = overrides.postalCode || overrides.postal_code || overrides.zip || crmAddr.postalCode || undefined;
  const addressLine1 = overrides.addressLine1 || overrides.address || overrides.streetLine1 || crmAddr.streetLine1 || undefined;
  const addressLine2 = overrides.addressLine2 || overrides.streetLine2 || crmAddr.streetLine2 || undefined;
  const phone = overrides.phone || overrides.phoneNumber || crmPhone || undefined;

  return {
    fullName,
    firstName,
    lastName,
    city,
    stateCode,
    postalCode,
    addressLine1,
    addressLine2,
    phone,
  };
}

function mapEnrichmentDocument(doc, provider) {
  if (!doc) return null;
  return {
    id: doc.id || doc._id?.toString(),
    provider: doc.provider,
    providerLabel: provider?.label || null,
    status: doc.status,
    params: doc.params,
    requestedAt: doc.requestedAt || doc.createdAt,
    expiresAt: doc.expiresAt,
    requestedBy: doc.requestedBy,
    meta: doc.meta || null,
    candidates: Array.isArray(doc.candidates) ? doc.candidates : [],
    error: doc.error || null,
    selectedRecords: Array.isArray(doc.selectedRecords) ? doc.selectedRecords : [],
  };
}

function userIdentity(req) {
  return {
    uid: req.user?.uid || req.user?.id || null,
    email: req.user?.email || null,
    name: req.user?.name || req.user?.displayName || req.user?.email || null,
  };
}

async function fetchContactMeta(caseIds = []) {
  if (!caseIds.length) return { contactSet: new Set(), lastMap: new Map() };

  const objectIds = caseIds
    .map((id) => {
      if (!id) return null;
      try {
        return new mongoose.Types.ObjectId(String(id));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (!objectIds.length) return { contactSet: new Set(), lastMap: new Map() };

  const agg = Message.aggregate([
    { $match: { caseId: { $in: objectIds } } },
    {
      $group: {
        _id: '$caseId',
        lastContact: {
          $max: {
            $ifNull: ['$sentAt', { $ifNull: ['$deliveredAt', { $ifNull: ['$createdAt', '$updatedAt'] }] }]
          }
        },
        hasOutreach: {
          $max: {
            $cond: [
              { $eq: ['$direction', 'out'] },
              1,
              0
            ]
          }
        }
      }
    }
  ]).option({ maxTimeMS: MAX_DB_MS });

  const rows = await withTimeout(agg.exec(), MAX_DB_MS).catch(() => []);
  const contactSet = new Set();
  const lastMap = new Map();
  rows.forEach((row) => {
    const key = String(row?._id);
    if (!key) return;
    if (row.hasOutreach) contactSet.add(key);
    if (row.lastContact) lastMap.set(key, row.lastContact);
  });
  return { contactSet, lastMap };
}

r.get('/meta', (_req, res) => {
  res.json({
    manualTagOptions: Array.from(ALLOWED_MANUAL_TAGS),
    stages: CRM_STAGES,
    checklist: CRM_CHECKLIST,
  });
});

r.get('/stats', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const rolesKey = Array.isArray(req.user?.roles)
      ? [...req.user.roles].sort().join(',')
      : 'none';
    const deptKey = Array.isArray(req.user?.departments)
      ? [...req.user.departments].sort().join(',')
      : 'none';
    const cacheKey = `cases:stats:v1:${rolesKey}:${deptKey}`;

    const { fromCache, data } = await withCache(cacheKey, async () => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);
      const upcomingEnd = new Date(startOfToday);
      upcomingEnd.setDate(upcomingEnd.getDate() + 7);

      const scopedMatch = scopedCaseFilter(req, {});
      const pipeline = [];
      if (Object.keys(scopedMatch).length) {
        pipeline.push({ $match: scopedMatch });
      }

      pipeline.push({
        $facet: {
          stages: [
            {
              $group: {
                _id: { $ifNull: ['$crm_stage', 'new'] },
                count: { $sum: 1 },
              },
            },
          ],
          followUps: [
            {
              $group: {
                _id: null,
                overdue: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$crm_details.followUpAt', null] },
                          { $lt: ['$crm_details.followUpAt', startOfToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                dueToday: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ['$crm_details.followUpAt', startOfToday] },
                          { $lt: ['$crm_details.followUpAt', endOfToday] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                upcoming: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gte: ['$crm_details.followUpAt', endOfToday] },
                          { $lt: ['$crm_details.followUpAt', upcomingEnd] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                unscheduled: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $eq: ['$crm_details.followUpAt', null] },
                          { $not: ['$crm_details.followUpAt'] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          checklist: [
            {
              $project: {
                documents: { $ifNull: ['$crm_details.documents', []] },
              },
            },
            {
              $project: {
                totalPending: {
                  $size: {
                    $filter: {
                      input: '$documents',
                      as: 'doc',
                      cond: { $ne: ['$$doc.status', 'completed'] },
                    },
                  },
                },
                requiredPending: {
                  $size: {
                    $filter: {
                      input: '$documents',
                      as: 'doc',
                      cond: {
                        $and: [
                          { $eq: ['$$doc.required', true] },
                          { $ne: ['$$doc.status', 'completed'] },
                        ],
                      },
                    },
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                totalPending: { $sum: '$totalPending' },
                requiredPending: { $sum: '$requiredPending' },
                casesMissingRequired: {
                  $sum: {
                    $cond: [{ $gt: ['$requiredPending', 0] }, 1, 0],
                  },
                },
              },
            },
          ],
          assignments: [
            {
              $project: {
                owner: {
                  $cond: [
                    {
                      $or: [
                        { $eq: [{ $ifNull: ['$crm_details.assignedTo', ''] }, ''] },
                        { $eq: ['$crm_details.assignedTo', null] },
                      ],
                    },
                    'unassigned',
                    'assigned',
                  ],
                },
              },
            },
            {
              $group: {
                _id: '$owner',
                count: { $sum: 1 },
              },
            },
          ],
          tags: [
            {
              $project: {
                manual_tags: { $ifNull: ['$manual_tags', []] },
              },
            },
            { $unwind: { path: '$manual_tags', preserveNullAndEmptyArrays: false } },
            {
              $group: {
                _id: '$manual_tags',
                count: { $sum: 1 },
              },
            },
          ],
          attention: [
            {
              $project: {
                needs_attention: { $eq: ['$needs_attention', true] },
                attention_reasons: { $ifNull: ['$attention_reasons', []] },
              },
            },
            {
              $group: {
                _id: null,
                needsAttention: {
                  $sum: { $cond: ['$needs_attention', 1, 0] },
                },
                referToMagistrate: {
                  $sum: {
                    $cond: [
                      { $in: ['refer_to_magistrate', '$attention_reasons'] },
                      1,
                      0,
                    ],
                  },
                },
                letterSuffix: {
                  $sum: {
                    $cond: [
                      { $in: ['letter_suffix_case', '$attention_reasons'] },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
        },
      });

      const agg = Case.aggregate(pipeline).option({ maxTimeMS: MAX_DB_MS, allowDiskUse: true });

      const [result] = await withTimeout(agg.exec(), MAX_DB_MS, 'stats.aggregate').catch((err) => {
        console.error('GET /cases/stats aggregate failed', err?.message);
        return [{}];
      });

      const stageCounts = {};
      let totalCases = 0;
      if (Array.isArray(result?.stages)) {
        result.stages.forEach((row) => {
          const key = row?._id || 'unknown';
          const count = Number(row?.count || 0);
          stageCounts[key] = count;
          totalCases += count;
        });
      }
      CRM_STAGES.forEach((stage) => {
        if (!Object.prototype.hasOwnProperty.call(stageCounts, stage)) {
          stageCounts[stage] = 0;
        }
      });

      const followRaw = Array.isArray(result?.followUps) ? result.followUps[0] || {} : {};
      const followUps = {
        overdue: Number(followRaw.overdue || 0),
        dueToday: Number(followRaw.dueToday || 0),
        upcoming: Number(followRaw.upcoming || 0),
        unscheduled: Number(followRaw.unscheduled || 0),
      };

      const checklistRaw = Array.isArray(result?.checklist) ? result.checklist[0] || {} : {};
      const checklist = {
        totalPending: Number(checklistRaw.totalPending || 0),
        requiredPending: Number(checklistRaw.requiredPending || 0),
        casesMissingRequired: Number(checklistRaw.casesMissingRequired || 0),
      };

      const assignments = { assigned: 0, unassigned: 0 };
      if (Array.isArray(result?.assignments)) {
        result.assignments.forEach((row) => {
          if (!row?._id) return;
          if (row._id === 'unassigned') assignments.unassigned = Number(row.count || 0);
          else assignments.assigned += Number(row.count || 0);
        });
      }

      const tags = {};
      if (Array.isArray(result?.tags)) {
        result.tags.forEach((row) => {
          if (!row?._id) return;
          tags[row._id] = Number(row.count || 0);
        });
      }

      const attentionRaw = Array.isArray(result?.attention) ? result.attention[0] || {} : {};
      const attention = {
        needsAttention: Number(attentionRaw.needsAttention || 0),
        referToMagistrate: Number(attentionRaw.referToMagistrate || 0),
        letterSuffix: Number(attentionRaw.letterSuffix || 0),
      };

      return {
        stages: stageCounts,
        followUps,
        checklist,
        assignments,
        tags,
        attention,
        totals: {
          cases: totalCases,
        },
        generatedAt: new Date().toISOString(),
      };
    });
    res.set('X-Cache', data && fromCache ? 'HIT' : 'MISS');
    res.json(data);
  } catch (err) {
    console.error('GET /cases/stats error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cases
 * Query params:
 *  - query: full-text search (requires text index)
 *  - county: filter by county (e.g., 'harris')
 *  - status: optional status filter if present in schema
 *  - startDate, endDate: inclusive YYYY-MM-DD (applies to booking_date)
 *  - minBond, maxBond: numeric filters on bond_amount
 *  - sortBy: 'booking_date' | 'bond_amount' (default: 'booking_date')
 *  - order: 'desc' | 'asc' (default: 'desc')
 *  - limit: number of docs to return (default: 25)
 *  - timeBucket: filter by time_bucket field
 *  - bondLabel: filter by bond_label field
 *  - attention: if truthy, filter cases needing attention (refer to magistrate or letter suffix cases)
 *
 * Notes:
 *  - Uses normalized fields: booking_date (YYYY-MM-DD), bond_amount (Number).
 *  - Falls back to legacy fields only when necessary.
 */
r.get('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const {
      query = '',
      county,
      status,
      window: windowId,
      startDate,
      endDate,
      minBond,
      maxBond,
      sortBy = 'booking_date',
      order = 'desc',
      limit = 25,
      attention,
      timeBucket,
      bondLabel,
      attentionType,
      contacted,
      stage,
      noCount,
    } = req.query;
    const bondLabelAlias = req.query.bond_label;

    const filter = {};

    // Core filters
    if (county) filter.county = county;
    if (status) filter.status = status;

    // Text search (ensure a text index on relevant fields: full_name, offense, case_number, etc.)
    if (query) filter.$text = { $search: query };

    // Date window based on booking time: support rolling windows via ?window=24h|48h|72h
    const WINDOW_SET = new Set(['24h','48h','72h']);
    const now = Date.now();
    let useExprWindow = false;
    if (windowId && WINDOW_SET.has(String(windowId).toLowerCase())) {
      const id = String(windowId).toLowerCase();
      const sinceHours = id === '24h' ? 24 : id === '48h' ? 48 : 72;
      const prevHours  = id === '24h' ? null : id === '48h' ? 24 : 48;
      const since = new Date(now - sinceHours * 3600000);
      const until = prevHours != null ? new Date(now - prevHours * 3600000) : new Date();
      // Build $expr comparing coalesced booking_dt to [since, until)
      filter.$expr = {
        $and: [
          { $gte: [
            {
              $let: {
                vars: { ba: '$bookedAt', iso: '$booking_date_iso', ymd: '$booking_date' },
                in: {
                  $let: {
                    vars: {
                      baD: { $cond: [ { $eq: [ { $type: '$$ba' }, 'date' ] }, '$$ba', null ] },
                      isoD: { $cond: [ { $eq: [ { $type: '$$iso' }, 'date' ] }, '$$iso', null ] },
                      ymdD: {
                        $cond: [
                          { $and: [ { $ne: ['$$ymd', null] }, { $ne: ['$$ymd', ''] } ] },
                          { $dateFromString: { dateString: '$$ymd', format: '%Y-%m-%d', timezone: 'America/Chicago', onError: null, onNull: null } },
                          null
                        ]
                      }
                    },
                    in: { $ifNull: ['$$baD', { $ifNull: ['$$isoD', '$$ymdD'] }] }
                  }
                }
              }
            }, since ] },
          { $lt: [
            {
              $let: {
                vars: { ba: '$bookedAt', iso: '$booking_date_iso', ymd: '$booking_date' },
                in: {
                  $let: {
                    vars: {
                      baD: { $cond: [ { $eq: [ { $type: '$$ba' }, 'date' ] }, '$$ba', null ] },
                      isoD: { $cond: [ { $eq: [ { $type: '$$iso' }, 'date' ] }, '$$iso', null ] },
                      ymdD: {
                        $cond: [
                          { $and: [ { $ne: ['$$ymd', null] }, { $ne: ['$$ymd', ''] } ] },
                          { $dateFromString: { dateString: '$$ymd', format: '%Y-%m-%d', timezone: 'America/Chicago', onError: null, onNull: null } },
                          null
                        ]
                      }
                    },
                    in: { $ifNull: ['$$baD', { $ifNull: ['$$isoD', '$$ymdD'] }] }
                  }
                }
              }
            }, until ] },
        ]
      };
      useExprWindow = true;
    }
    // Date window on normalized booking_date (YYYY-MM-DD) for non-rolling cases
    if (!useExprWindow && (startDate || endDate)) {
      filter.booking_date = {};
      if (startDate) filter.booking_date.$gte = String(startDate);
      if (endDate) filter.booking_date.$lte = String(endDate);
    }
    // Safety default: for attention scans with no explicit window, restrict to last 30 days
    if ((attention === '1' || attention === 'true' || attention === true) && !startDate && !endDate) {
      const dt = new Date();
      dt.setDate(dt.getDate() - 30);
      const ymd = dt.toISOString().slice(0, 10);
      filter.booking_date = { ...(filter.booking_date || {}), $gte: ymd };
    }

    // Bond range on normalized bond_amount
    const minBondNum = Number(minBond);
    const maxBondNum = Number(maxBond);
    if (!Number.isNaN(minBondNum) || !Number.isNaN(maxBondNum)) {
      filter.bond_amount = {};
      if (!Number.isNaN(minBondNum)) filter.bond_amount.$gte = minBondNum;
      if (!Number.isNaN(maxBondNum)) filter.bond_amount.$lte = maxBondNum;
    }

    // Additional filters
    if (timeBucket) filter.time_bucket = timeBucket;
    const limitNum = Math.min(Number(limit) || 25, 500);
    if (bondLabel || bondLabelAlias) filter.bond_label = bondLabel || bondLabelAlias;
    if (attention === '1' || attention === 'true' || attention === true) {
      const referValues = ['REFER TO MAGISTRATE', 'Refer to Magistrate', 'refer to magistrate'];
      // By default, prefer fast equality checks that hit the bond_label index.
      // The anchor regex is expensive; include it only if attentionType=letter or attentionType=all.
      const ors = [
        { bond_label: { $in: referValues } },
        { bond: { $in: referValues } },
      ];
      const attType = String(attentionType || '').toLowerCase();
      if (attType === 'letter' || attType === 'all') {
        ors.push({ "_upsert_key.anchor": { $not: /^[0-9]+$/ } });
      }
      filter.$or = ors;
    }
    if (stage && CRM_STAGES.includes(String(stage).toLowerCase())) {
      filter.crm_stage = String(stage).toLowerCase();
    }

    // Sorting
    const allowedSort = new Set(['booking_date', 'bond_amount']);
    const sortField = allowedSort.has(String(sortBy)) ? String(sortBy) : 'booking_date';
    const sortDir = String(order).toLowerCase() === 'asc' ? 1 : -1;

    // Select the key fields we actually use in the UI
    const projection = {
      full_name: 1,
      first_name: 1,
      last_name: 1,
      county: 1,
      dob: 1,
      offense: 1,
      agency: 1,
      facility: 1,
      booking_date: 1,       // normalized YYYY-MM-DD
      bond_amount: 1,        // normalized Number
      case_number: 1,
      booking_number: 1,
      spn: 1,
      time_bucket: 1,        // optional: present from normalizer
      charge: 1,
      status: 1,
      race: 1,
      sex: 1,
      tags: 1,
      bond_label: 1,
      manual_tags: 1,
      crm_stage: 1,
      crm_details: 1,
  // Phone enrichment fields (simple_harris)
  phone_nbr1: 1,
  phone_nbr2: 1,
  phone_nbr3: 1,
  phones_source: 1,
  phones_updated_at: 1,
      "_upsert_key.anchor": 1,
      // Timestamps to compute "age" on the client
      createdAt: 1,
      updatedAt: 1,
      normalized_at: 1,
      scraped_at: 1,
      // Legacy fields kept only for back-compat view (not used for sorting/sums)
      bookedAt: 1,
      booking_date_iso: 1,
      bond: 1,
    };

    const scopedFilter = scopedCaseFilter(req, filter);

    const wantCount = !noCount || !TRUE_SET.has(String(noCount).toLowerCase());

    // Query directly from county collections (simple_harris, simple_jefferson, etc.)
    // instead of a normalized 'cases' collection
    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    // Determine which collection(s) to query
    let collections = [];
    if (county) {
      const collName = COUNTY_MAP.get(String(county).toLowerCase());
      if (collName) {
        collections = [collName];
      } else {
        return res.status(400).json({ error: `Unknown county: ${county}` });
      }
    } else {
      // Query all county collections if no specific county is provided
      collections = COUNTY_COLLECTIONS;
    }

    // Build aggregation pipeline for all collections
    let items = [];
    let totalCount = 0;

    for (const collName of collections) {
      const coll = db.collection(collName);
      
      // Build the aggregation pipeline
      const pipeline = [
        { $match: scopedFilter },
      ];

      if (useExprWindow) {
        pipeline.push({ $match: filter });
      }

      pipeline.push(
        { $sort: { [sortField]: sortDir, booking_date: -1, _id: -1 } },
        { $project: projection }
      );

      // Apply limit only for single collection queries
      if (collections.length === 1) {
        pipeline.push({ $limit: limitNum });
      }

      try {
        const collItems = await withTimeout(
          coll.aggregate(pipeline).maxTimeMS(MAX_DB_MS).toArray(),
          MAX_DB_MS,
          `cases aggregate from ${collName}`
        );
        items = items.concat(collItems);
      } catch (e) {
        console.warn(`cases: aggregate from ${collName} failed`, e?.message);
      }

      // Get count for this collection
      if (wantCount) {
        try {
          const count = await withTimeout(
            coll.countDocuments(scopedFilter),
            MAX_DB_MS,
            `cases count from ${collName}`
          );
          totalCount += count;
        } catch (e) {
          console.warn(`cases: count from ${collName} failed`, e?.message);
        }
      }
    }

    // If querying multiple collections, sort and limit combined results
    if (collections.length > 1) {
      items.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDir === 1 ? cmp : -cmp;
      });
      items = items.slice(0, limitNum);
    }

    const caseIds = items.map((item) => item._id).filter(Boolean);
    const { contactSet, lastMap } = await fetchContactMeta(caseIds);

    // Map items for charge fallback and attention flags
    let mappedItems = items.map(item => {
      if ((!item.charge || item.charge === '') && item.offense) {
        item.charge = item.offense;
        delete item.offense;
      }

      let needs_attention = false;
      const reasons = [];

      if ((item.bond_label && /^REFER TO MAGISTRATE$/i.test(item.bond_label)) ||
          (item.bond && /^REFER TO MAGISTRATE$/i.test(item.bond))) {
        needs_attention = true;
        reasons.push('refer_to_magistrate');
      }

      if (item._upsert_key?.anchor && !/^[0-9]+$/.test(item._upsert_key.anchor)) {
        needs_attention = true;
        reasons.push('letter_suffix_case');
      }

      item.needs_attention = needs_attention;
      item.attention_reasons = reasons;
      if (!Array.isArray(item.manual_tags)) item.manual_tags = [];
    const idStr = String(item._id);
    item.contacted = contactSet.has(idStr);
    const last = lastMap.get(idStr);
    if (last) item.last_contact_at = last;
    if (!item.crm_stage) item.crm_stage = 'new';
    if (!item.crm_details) item.crm_details = {};
    // Backfill canonical CRM contact fields from any available source keys
    const sourceAddr = item.address || item.address_obj || null;
    const normalizedCrmAddress = {
      streetLine1:
        item.address_line_1
        || item.addressLine1
        || sourceAddr?.streetLine1
        || sourceAddr?.street_line_1
        || sourceAddr?.line1
        || sourceAddr?.line_1
        || '',
      streetLine2:
        item.address_line_2
        || item.addressLine2
        || sourceAddr?.streetLine2
        || sourceAddr?.street_line_2
        || sourceAddr?.line2
        || sourceAddr?.line_2
        || '',
      city: item.city || sourceAddr?.city || '',
      stateCode:
        item.state
        || item.stateCode
        || sourceAddr?.state
        || sourceAddr?.stateCode
        || sourceAddr?.state_code
        || '',
      postalCode:
        item.postal_code
        || item.postalCode
        || item.zip
        || sourceAddr?.postalCode
        || sourceAddr?.postal_code
        || sourceAddr?.zip
        || '',
      countryCode: sourceAddr?.countryCode || sourceAddr?.country_code || '',
    };
    const normalizedPhone = item.phone || item.primary_phone || '';

    item.crm_details = {
      qualificationNotes: item.crm_details.qualificationNotes || '',
      documents: normalizeChecklist(item.crm_details.documents),
      followUpAt: item.crm_details.followUpAt || null,
      assignedTo: item.crm_details.assignedTo || '',
      address: item.crm_details.address || normalizedCrmAddress,
      phone: item.crm_details.phone || normalizedPhone,
      attachments: Array.isArray(item.crm_details.attachments) ? item.crm_details.attachments : [],
      acceptance: {
        accepted: Boolean(item.crm_details.acceptance?.accepted),
        acceptedAt: item.crm_details.acceptance?.acceptedAt || null,
        notes: item.crm_details.acceptance?.notes || '',
      },
      denial: {
        denied: Boolean(item.crm_details.denial?.denied),
        deniedAt: item.crm_details.denial?.deniedAt || null,
        reason: item.crm_details.denial?.reason || '',
        notes: item.crm_details.denial?.notes || '',
      },
    };

    return item;
  });

    if (typeof contacted !== 'undefined') {
      const want = TRUE_SET.has(String(contacted).toLowerCase());
      mappedItems = mappedItems.filter((item) => Boolean(item.contacted) === want);
    }

    if (attentionType) {
      const type = String(attentionType).toLowerCase();
      mappedItems = mappedItems.filter((item) =>
        Array.isArray(item.attention_reasons) && item.attention_reasons.map((r) => String(r).toLowerCase()).includes(type)
      );
    }

    const limitedItems = mappedItems.slice(0, limitNum);

  res.json({ items: limitedItems, count: mappedItems.length, total: totalCount });
  } catch (err) {
    console.error('GET /cases error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/tags', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const incoming = Array.isArray(req.body?.tags) ? req.body.tags : null;
    if (!incoming) {
      return res.status(400).json({ error: 'tags array is required' });
    }

    const normalized = Array.from(new Set(
      incoming
        .map((tag) => String(tag || '').trim().toLowerCase())
        .filter(Boolean)
    ));

    const invalid = normalized.filter((tag) => !ALLOWED_MANUAL_TAGS.has(tag));
    if (invalid.length) {
      return res.status(400).json({ error: `Invalid tags: ${invalid.join(', ')}` });
    }

    const selector = scopedCaseFilter(req, { _id: req.params.id });
    const existing = await withTimeout(
      Case.findOne(selector).select({ manual_tags: 1 }),
      MAX_DB_MS
    );

    if (!existing) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const updateQuery = Case.updateOne(
      selector,
      { $set: { manual_tags: normalized, updatedAt: new Date() } }
    );

    await withTimeout(
      (updateQuery.maxTimeMS ? updateQuery.maxTimeMS(MAX_DB_MS) : updateQuery),
      MAX_DB_MS
    );

    const before = Array.isArray(existing.manual_tags) ? existing.manual_tags : [];
    const changed = before.sort().join(',') !== normalized.sort().join(',');
    if (changed) {
      await CaseAudit.create({
        caseId: existing._id,
        type: 'manual_tags',
        actor: req.user?.email || req.user?.id || 'system',
        details: { before, after: normalized },
      });
    }

    res.json({ manual_tags: normalized });
  } catch (err) {
    console.error('PATCH /cases/:id/tags error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cases/by-case-number/:caseNumber
 * Looks up a case by case_number (e.g., from enrichment prospects).
 * Queries county collections directly, returns { _id, case_number, full_name, county } to enable navigation.
 */
r.get('/by-case-number/:caseNumber', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const rawIdentifier = String(req.params.caseNumber || '').trim();
    if (!rawIdentifier) {
      return res.status(400).json({ error: 'Case identifier required' });
    }

    const compact = rawIdentifier.replace(/\s+/g, '');
    const stripped = compact.replace(/^0+/, '');
    const normalizedNoZeros = stripped.length ? stripped : (compact ? '0' : '');
    const stringCandidates = Array.from(new Set(
      [rawIdentifier, compact, normalizedNoZeros].filter((v) => typeof v === 'string' && v.length)
    ));

    const numericCandidates = [];
    if (/^\d+$/.test(normalizedNoZeros)) {
      const asNumber = Number(normalizedNoZeros);
      if (Number.isFinite(asNumber)) {
        numericCandidates.push(asNumber);
      }
    }

    const stringFields = [
      'case_number',
      'caseNumber',
      'anchor',
      'booking_number',
      'bookingNumber',
      'booking_id',
      'bookingId',
      'spn',
      'subjectId',
      'subject_id',
    ];
    const numericFields = ['subjectId', 'subject_id', 'spn', 'booking_number', 'booking_id'];

    const orClauses = [];
    for (const field of stringFields) {
      if (stringCandidates.length) {
        orClauses.push({ [field]: { $in: stringCandidates } });
      }
    }
    for (const field of numericFields) {
      for (const value of numericCandidates) {
        orClauses.push({ [field]: value });
      }
    }

    if (!orClauses.length) {
      return res.status(400).json({ error: 'Unable to build lookup query' });
    }

    const query = { $or: orClauses };
    const db = mongoose.connection.db;

    // Search across all county collections for any identifier match
    for (const collName of COUNTY_COLLECTIONS) {
      const coll = db.collection(collName);
      const doc = await coll.findOne(query);
      if (doc) {
        return res.json({
          _id: doc._id,
          case_number: doc.case_number,
          full_name: doc.full_name,
          county: collName.replace('simple_', '').toUpperCase(),
        });
      }
    }

    return res.status(404).json({ error: 'Case not found' });
  } catch (err) {
    console.error('GET /cases/by-case-number/:caseNumber error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cases/:id
 * Returns a single case document from county collections, enriched with metadata.
 * The :id is an ObjectId from a county collection (simple_harris, etc.).
 */
r.get('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);
    
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    
    const db = mongoose.connection.db;
    let doc = null;
    
    // Search county collections for the case by _id
    for (const collName of COUNTY_COLLECTIONS) {
      const coll = db.collection(collName);
      const found = await withTimeout(
        coll.findOne({ _id: objectId }),
        MAX_DB_MS,
        `cases get from ${collName}`
      ).catch(() => null);
      
      if (found) {
        doc = found;
        break;
      }
    }
    
    if (!doc) return res.status(404).json({ error: 'Not found' });
    
    // Now enrich with metadata from Case model
    let caseMetadata = null;
    try {
      caseMetadata = await Case.findOne({ _id: objectId }).lean();
    } catch (e) {
      console.warn('Failed to fetch case metadata for', objectId.toString(), e?.message);
    }

    // Use metadata if available, otherwise default values
    const meta = caseMetadata || {};
    if (!Array.isArray(meta.manual_tags)) meta.manual_tags = [];
    if (!meta.crm_stage) meta.crm_stage = 'new';
    
    // Build normalized CRM contact fields from any available source keys
    const sourceAddr = meta.address || meta.address_obj || doc.address || doc.address_obj || null;
    const normalizedCrmAddress = {
      streetLine1:
        meta.address_line_1 || meta.addressLine1 || doc.address_line_1 || doc.addressLine1
        || sourceAddr?.streetLine1 || sourceAddr?.street_line_1 || sourceAddr?.line1 || sourceAddr?.line_1
        || '',
      streetLine2:
        meta.address_line_2 || meta.addressLine2 || doc.address_line_2 || doc.addressLine2
        || sourceAddr?.streetLine2 || sourceAddr?.street_line_2 || sourceAddr?.line2 || sourceAddr?.line_2
        || '',
      city: meta.city || doc.city || sourceAddr?.city || '',
      stateCode:
        meta.state || meta.stateCode || doc.state || doc.stateCode
        || sourceAddr?.state || sourceAddr?.stateCode || sourceAddr?.state_code
        || '',
      postalCode:
        meta.postal_code || meta.postalCode || meta.zip || doc.postal_code || doc.postalCode || doc.zip
        || sourceAddr?.postalCode || sourceAddr?.postal_code || sourceAddr?.zip
        || '',
      countryCode: sourceAddr?.countryCode || sourceAddr?.country_code || '',
    };
    const normalizedPhone = meta.phone || meta.primary_phone || doc.phone || doc.primary_phone || '';

    // Build response with both case data (from county collection) and CRM metadata
    const response = {
      ...doc,
      manual_tags: meta.manual_tags,
      crm_stage: meta.crm_stage,
      crm_details: {
        qualificationNotes: meta.crm_details?.qualificationNotes || '',
        documents: normalizeChecklist(meta.crm_details?.documents),
        followUpAt: meta.crm_details?.followUpAt || null,
        assignedTo: meta.crm_details?.assignedTo || '',
        address: meta.crm_details?.address || normalizedCrmAddress,
        phone: meta.crm_details?.phone || normalizedPhone,
        attachments: Array.isArray(meta.crm_details?.attachments) ? meta.crm_details.attachments : [],
        acceptance: {
          accepted: Boolean(meta.crm_details?.acceptance?.accepted),
          acceptedAt: meta.crm_details?.acceptance?.acceptedAt || null,
          notes: meta.crm_details?.acceptance?.notes || '',
        },
        denial: {
          denied: Boolean(meta.crm_details?.denial?.denied),
          deniedAt: meta.crm_details?.denial?.deniedAt || null,
          reason: meta.crm_details?.denial?.reason || '',
          notes: meta.crm_details?.denial?.notes || '',
        },
      },
    };

    const attachmentsRaw = Array.isArray(response.crm_details.attachments) ? response.crm_details.attachments : [];
    const normalizedAttachments = normalizeAttachments(attachmentsRaw, attachmentsRaw);
    response.crm_details.attachments = normalizedAttachments;
    
    const needBackfillAttachments = attachmentsRaw.some((att) => att && !att.id);
    const needBackfillContact = (!response.crm_details?.address || !response.crm_details?.address?.streetLine1) && (normalizedCrmAddress.streetLine1 || normalizedCrmAddress.city || normalizedPhone);
    
    if (caseMetadata && (needBackfillAttachments || needBackfillContact)) {
      await Case.updateOne(
        { _id: objectId },
        {
          $set: {
            'crm_details.attachments': normalizedAttachments,
            ...(needBackfillContact ? { 'crm_details.address': normalizedCrmAddress, 'crm_details.phone': normalizedPhone } : {}),
          }
        }
      ).catch((err) => {
        console.warn('Failed to backfill attachment ids for case', objectId.toString(), err?.message);
      });
    }
    
    const { contactSet, lastMap } = await fetchContactMeta([objectId]);
    const idStr = String(objectId);
    response.contacted = contactSet.has(idStr);
    const last = lastMap.get(idStr);
    if (last) response.last_contact_at = last;

    res.json(response);
  } catch (err) {
    console.error('GET /cases/:id error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.get('/:id/messages', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const selector = scopedCaseFilter(req, { _id: objectId });
    const accessible = await Case.findOne(selector).select({ _id: 1 }).lean();
    if (!accessible) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const itemsRaw = await listMessages({ caseId: objectId, limit: 100 }).catch(() => []);

    let traceIds = [];
    const traceParam = req.query.trace;
    if (traceParam) {
      traceIds = traceParam.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const items = itemsRaw.map((msg) => ({
      ...msg,
      id: msg._id?.toString?.() || msg._id,
      traceId: msg.providerMessageId || null,
    }));

    res.json({ items, traces: traceIds });
  } catch (err) {
    console.error('GET /cases/:id/messages error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:caseId/messages/:messageId/resend', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    let caseObjectId;
    let messageObjectId;
    try {
      caseObjectId = new mongoose.Types.ObjectId(req.params.caseId);
      messageObjectId = new mongoose.Types.ObjectId(req.params.messageId);
    } catch {
      return res.status(400).json({ error: 'Invalid identifiers provided' });
    }

    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const selector = scopedCaseFilter(req, { _id: caseObjectId });
    const accessible = await Case.findOne(selector).select({ _id: 1 }).lean();
    if (!accessible) {
      return res.status(404).json({ error: 'Case not found' });
    }

    try {
      const doc = await queueResendMessage({
        caseId: caseObjectId,
        messageId: messageObjectId,
        actor: req.user?.email || req.user?.id || 'system',
      });
      res.status(201).json({ id: doc._id.toString(), status: doc.status, queuedAt: doc.createdAt });
    } catch (err) {
      const status = err?.message === 'Only outbound messages can be resent' ? 400 : 500;
      return res.status(status).json({ error: err?.message || 'Unable to queue resend' });
    }
  } catch (err) {
    console.error('POST /cases/:caseId/messages/:messageId/resend error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/stage', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const stage = String(req.body?.stage || '').toLowerCase();
    const note = req.body?.note ? String(req.body.note) : undefined;

    if (!CRM_STAGES.includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const selector = scopedCaseFilter(req, { _id: req.params.id });
    const existing = await withTimeout(
      Case.findOne(selector).select({ crm_stage: 1 }),
      MAX_DB_MS
    );

    if (!existing) return res.status(404).json({ error: 'Case not found' });

    if (existing.crm_stage === stage) {
      return res.json({ crm_stage: stage });
    }

    const historyEntry = {
      stage,
      changedAt: new Date(),
      actor: req.user?.email || req.user?.id || 'system',
      note,
    };

    const updateQuery = Case.updateOne(
      selector,
      {
        $set: { crm_stage: stage, updatedAt: new Date() },
        $push: { crm_stage_history: historyEntry },
      }
    );

    await withTimeout(
      (updateQuery.maxTimeMS ? updateQuery.maxTimeMS(MAX_DB_MS) : updateQuery),
      MAX_DB_MS
    );

    await CaseAudit.create({
      caseId: existing._id,
      type: 'stage_change',
      actor: req.user?.email || req.user?.id || 'system',
      details: { stage, note },
    });

    res.json({ crm_stage: stage });
  } catch (err) {
    console.error('PATCH /cases/:id/stage error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/crm', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const selector = scopedCaseFilter(req, { _id: req.params.id });
    let qExisting = Case.findOne(selector);
    if (qExisting && typeof qExisting.lean === 'function') {
      qExisting = qExisting.lean();
    }
    const existing = await withTimeout(
      qExisting && typeof qExisting.exec === 'function' ? qExisting.exec() : qExisting,
      MAX_DB_MS
    ).catch((err) => {
      console.error('PATCH /cases/:id/crm load error', err?.message);
      return null;
    });

    if (!existing) return res.status(404).json({ error: 'Case not found' });

    const payload = req.body || {};
    const update = {};

    if (typeof payload.qualificationNotes === 'string') {
      update['crm_details.qualificationNotes'] = payload.qualificationNotes;
    }
    if (Array.isArray(payload.documents)) {
      update['crm_details.documents'] = normalizeChecklist(payload.documents);
    }
    if (payload.followUpAt) {
      const dt = new Date(payload.followUpAt);
      if (!Number.isNaN(dt.getTime())) update['crm_details.followUpAt'] = dt;
    } else if (payload.followUpAt === null) {
      update['crm_details.followUpAt'] = null;
    }
    if (payload.assignedTo !== undefined) {
      update['crm_details.assignedTo'] = String(payload.assignedTo || '');
    }

    // Optional contact info updates
    if (payload.address || payload.crm_details?.address) {
      const addr = payload.address || payload.crm_details.address;
      if (addr && typeof addr === 'object') {
        const nextAddr = {
          streetLine1: String(addr.streetLine1 || addr.addressLine1 || addr.street_line_1 || ''),
          streetLine2: String(addr.streetLine2 || addr.addressLine2 || addr.street_line_2 || ''),
          city: String(addr.city || ''),
          stateCode: String(addr.stateCode || addr.state || addr.state_code || ''),
          postalCode: String(addr.postalCode || addr.postal_code || addr.zip || ''),
          countryCode: String(addr.countryCode || addr.country_code || ''),
        };
        update['crm_details.address'] = nextAddr;
      } else if (addr === null) {
        update['crm_details.address'] = undefined;
      }
    }

    if (payload.phone !== undefined || payload.crm_details?.phone !== undefined) {
      const nextPhone = payload.phone ?? payload.crm_details?.phone ?? '';
      update['crm_details.phone'] = String(nextPhone || '');
    }

    if (payload.acceptance) {
      update['crm_details.acceptance'] = {
        accepted: Boolean(payload.acceptance.accepted),
        acceptedAt: payload.acceptance.accepted ? new Date(payload.acceptance.acceptedAt || Date.now()) : null,
        notes: String(payload.acceptance.notes || ''),
      };
    }

    if (payload.denial) {
      update['crm_details.denial'] = {
        denied: Boolean(payload.denial.denied),
        deniedAt: payload.denial.denied ? new Date(payload.denial.deniedAt || Date.now()) : null,
        reason: String(payload.denial.reason || ''),
        notes: String(payload.denial.notes || ''),
      };
    }

    const previousAttachments = Array.isArray(existing.crm_details?.attachments)
      ? existing.crm_details.attachments
      : [];

    if (payload.attachments !== undefined) {
      if (Array.isArray(payload.attachments)) {
        update['crm_details.attachments'] = normalizeAttachments(payload.attachments, previousAttachments);
      } else if (payload.attachments === null) {
        update['crm_details.attachments'] = [];
      }
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No CRM fields provided' });
    }

    update.updatedAt = new Date();

    let updateQuery = Case.findOneAndUpdate(selector, { $set: update }, { new: true });
    if (updateQuery && typeof updateQuery.lean === 'function') {
      updateQuery = updateQuery.lean();
    }
    const toAwait = (updateQuery && typeof updateQuery.exec === 'function') ? updateQuery.exec() : updateQuery;
    const doc = await withTimeout(
      (toAwait && typeof toAwait.maxTimeMS === 'function') ? toAwait.maxTimeMS(MAX_DB_MS) : toAwait,
      MAX_DB_MS
    ).catch((err) => {
      console.error('PATCH /cases/:id/crm update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Case not found' });

    await CaseAudit.create({
      caseId: doc._id,
      type: 'crm_update',
      actor: req.user?.email || req.user?.id || 'system',
      details: { updated: Object.keys(update) },
    });

    if (doc.crm_details?.attachments) {
      doc.crm_details.attachments = normalizeAttachments(doc.crm_details.attachments, doc.crm_details.attachments);
    }

    res.json({ crm_details: doc.crm_details, crm_stage: doc.crm_stage });
  } catch (err) {
    console.error('PATCH /cases/:id/crm error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/activity', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const selector = scopedCaseFilter(req, { _id: objectId });
    const accessible = await Case.findOne(selector).select({ _id: 1 }).lean();
    if (!accessible) {
      return res.status(404).json({ error: 'Case not found' });
    }

    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const outcome = typeof req.body?.outcome === 'string' ? req.body.outcome.trim() : '';
    const followUpAt = req.body?.followUpAt ? new Date(req.body.followUpAt) : null;

    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }

    if (followUpAt && Number.isNaN(followUpAt.getTime())) {
      return res.status(400).json({ error: 'followUpAt is invalid' });
    }

    const actor = req.user?.email || req.user?.id || 'system';

    const audit = await CaseAudit.create({
      caseId: objectId,
      type: 'crm_note',
      actor,
      details: {
        note,
        outcome: outcome || undefined,
        followUpAt: followUpAt ? followUpAt.toISOString() : undefined,
      },
    });

    if (followUpAt) {
      const update = {
        'crm_details.followUpAt': followUpAt,
        updatedAt: new Date(),
      };
      await withTimeout(
        Case.updateOne(selector, { $set: update }),
        MAX_DB_MS
      ).catch(() => {});
    }

    const event = {
      type: 'crm_note',
      title: outcome ? `Outcome: ${outcome}` : 'CRM note added',
      occurredAt: audit.createdAt,
      details: note,
      actor,
    };

    res.status(201).json({ event });
  } catch (err) {
    console.error('POST /cases/:id/activity error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.get('/:id/activity', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(req.params.id);
    } catch {
      return res.status(400).json({ error: 'Invalid case id' });
    }

    ensurePermission(req, ['cases:read', 'cases:read:department']);
    const selector = scopedCaseFilter(req, { _id: objectId });
    const qCase = Case.findOne(selector).lean();
    const doc = await withTimeout((qCase.maxTimeMS ? qCase.maxTimeMS(MAX_DB_MS) : qCase), MAX_DB_MS).catch(() => null);
    if (!doc) return res.status(404).json({ error: 'Not found' });

    const events = [];
    if (doc.createdAt) {
      events.push({
        type: 'created',
        title: 'Case created',
        occurredAt: doc.createdAt,
        details: null,
        actor: 'system',
      });
    }
    if (doc.updatedAt && (!doc.createdAt || doc.updatedAt > doc.createdAt)) {
      events.push({
        type: 'updated',
        title: 'Case updated',
        occurredAt: doc.updatedAt,
        details: null,
        actor: 'system',
      });
    }

    const { contactSet, lastMap } = await fetchContactMeta([objectId]);
    const idStr = String(objectId);
    if (contactSet.has(idStr)) {
      const last = lastMap.get(idStr);
      events.push({
        type: 'contact',
        title: 'Most recent outreach',
        occurredAt: last || doc.updatedAt || doc.createdAt,
        details: 'Outbound communication logged',
        actor: 'system',
      });
    }

    const attentionReasons = Array.isArray(doc.attention_reasons) ? doc.attention_reasons : [];
    if (attentionReasons.length) {
      events.push({
        type: 'attention',
        title: 'Needs attention flagged',
        occurredAt: doc.updatedAt || doc.createdAt,
        details: attentionReasons.join(', '),
        actor: 'system',
      });
    }

    const audits = await CaseAudit.find({ caseId: objectId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    audits.forEach((audit) => {
      if (audit.type === 'manual_tags') {
        const before = Array.isArray(audit.details?.before) ? audit.details.before : [];
        const after = Array.isArray(audit.details?.after) ? audit.details.after : [];
        events.push({
          type: 'tags',
          title: 'Manual tags updated',
          occurredAt: audit.createdAt,
          details: `Before: ${before.join(', ') || 'none'} | After: ${after.join(', ') || 'none'}`,
          actor: audit.actor || 'system',
        });
      } else if (audit.type && audit.type.startsWith('enrichment_')) {
        // Handle enrichment audits with full JSON response and parameters
        const providerId = String(audit.type.replace(/^enrichment_/, '')).toLowerCase();
        const details = audit.details;
        const status = details?.status || 'unknown';
        const title = `Enrichment: ${providerId} (${status})`;
        
        events.push({
          type: audit.type,
          title,
          occurredAt: audit.createdAt,
          // Pass details object as-is so frontend can parse JSON responses
          details: details,
          actor: audit.actor || 'system',
        });
      } else {
        events.push({
          type: audit.type,
          title: audit.type.replace(/_/g, ' '),
          occurredAt: audit.createdAt,
          details: typeof audit.details === 'string' ? audit.details : JSON.stringify(audit.details),
          actor: audit.actor || 'system',
        });
      }
    });

    events.sort((a, b) => {
      const da = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const db = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return db - da;
    });

    res.json({ events });
  } catch (err) {
    console.error('GET /cases/:id/activity error:', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.get('/:caseId/enrichment/:providerId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

  const provider = getEnrichmentProvider(req.params.providerId);
    if (!provider) {
      return res.status(404).json({ error: 'Unknown enrichment provider' });
    }

    const selector = scopedCaseFilter(req, { _id: req.params.caseId });
    let qCase = Case.findOne(selector);
    if (qCase && typeof qCase.select === 'function') {
      qCase = qCase.select({ _id: 1 });
    }
    if (qCase && typeof qCase.lean === 'function') {
      qCase = qCase.lean();
    }
    const caseDoc = await withTimeout(
      qCase && typeof qCase.exec === 'function' ? qCase.exec() : qCase,
      MAX_DB_MS,
      `${provider.id}:case`
    );

    if (!caseDoc) {
      return res.status(404).json({ error: 'Case not found' });
    }

    let qEnrichment = CaseEnrichment.findOne({
      caseId: caseDoc._id,
      provider: provider.id,
    });
    if (qEnrichment && typeof qEnrichment.sort === 'function') {
      qEnrichment = qEnrichment.sort({ requestedAt: -1, createdAt: -1 });
    }
    if (qEnrichment && typeof qEnrichment.lean === 'function') {
      qEnrichment = qEnrichment.lean();
    }

    const enrichmentDoc = await withTimeout(
      qEnrichment && typeof qEnrichment.exec === 'function' ? qEnrichment.exec() : qEnrichment,
      MAX_DB_MS,
      `${provider.id}:enrichment`
    );

    if (!enrichmentDoc) {
      return res.json({ enrichment: null, cached: false, nextRefreshAt: null });
    }

    const expiresAt = enrichmentDoc.expiresAt ? new Date(enrichmentDoc.expiresAt) : null;
    const cached = Boolean(expiresAt && expiresAt > new Date());

    res.json({
      enrichment: mapEnrichmentDocument(enrichmentDoc, provider),
      cached,
      nextRefreshAt: expiresAt,
    });
  } catch (err) {
    console.error(`GET /cases/:caseId/enrichment/${req.params?.providerId} error:`, err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:caseId/enrichment/:providerId', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:enrich', 'cases:enrich:department']);

    const provider = getEnrichmentProvider(req.params.providerId);
    if (!provider) {
      return res.status(404).json({ error: 'Unknown enrichment provider' });
    }

    const selector = scopedCaseFilter(req, { _id: req.params.caseId });
    let qCase = Case.findOne(selector);
    if (qCase && typeof qCase.lean === 'function') {
      qCase = qCase.lean();
    }
    const caseDoc = await withTimeout(
      qCase && typeof qCase.exec === 'function' ? qCase.exec() : qCase,
      MAX_DB_MS,
      `${provider.id}:case`
    );

    if (!caseDoc) {
      return res.status(404).json({ error: 'Case not found' });
    }

    let qLatest = CaseEnrichment.findOne({
      caseId: caseDoc._id,
      provider: provider.id,
    });
    if (qLatest && typeof qLatest.sort === 'function') {
      qLatest = qLatest.sort({ requestedAt: -1, createdAt: -1 });
    }
    if (qLatest && typeof qLatest.lean === 'function') {
      qLatest = qLatest.lean();
    }

    const latest = await withTimeout(
      qLatest && typeof qLatest.exec === 'function' ? qLatest.exec() : qLatest,
      MAX_DB_MS,
      `${provider.id}:latest`
    );

    const ttlMinutesResolved = Number.isFinite(provider.ttlMinutes) && provider.ttlMinutes > 0
      ? provider.ttlMinutes
      : DEFAULT_ENRICHMENT_TTL_MINUTES;
    const errorTtlMinutesResolved = Number.isFinite(provider.errorTtlMinutes) && provider.errorTtlMinutes > 0
      ? provider.errorTtlMinutes
      : Math.min(ttlMinutesResolved, DEFAULT_ENRICHMENT_ERROR_TTL_MINUTES);

    const now = new Date();
    const forceRequested = Boolean(req.body?.force);
    const supportsForce = Boolean(provider.supportsForce);
    const allowForce = forceRequested && supportsForce && hasPermission(req, 'cases:enrich');
    if (!allowForce && latest?.expiresAt && new Date(latest.expiresAt) > now) {
      return res.json({
        enrichment: mapEnrichmentDocument(latest, provider),
        cached: true,
        nextRefreshAt: latest.expiresAt,
      });
    }

    const { force: _force, ...overrideParams } = req.body || {};
    const params = buildEnrichmentParams(caseDoc, overrideParams);

    if (!params.firstName && !params.lastName && !params.fullName) {
      return res.status(400).json({ error: 'Provide at least a name to run enrichment.' });
    }

    let lookupResult = null;
    let status = 'success';
    let errorPayload = null;

    try {
      const preparedParams = provider.prepareParams
        ? provider.prepareParams(params, { case: caseDoc, overrides: overrideParams })
        : params;
      lookupResult = await provider.search(preparedParams, { case: caseDoc, overrides: overrideParams });
      status = lookupResult?.status || 'success';
    } catch (serviceError) {
      status = 'error';
      errorPayload = {
        code: serviceError.code || 'ENRICHMENT_ERROR',
        message: serviceError.message || 'Enrichment request failed',
      };
      console.error(`${provider.id} lookup error:`, serviceError);
    }

    const ttlMinutes = status === 'error' ? errorTtlMinutesResolved : ttlMinutesResolved;
    const expiresAt = nextExpiry(ttlMinutes);

    const enrichmentDoc = await CaseEnrichment.create({
      caseId: caseDoc._id,
      provider: provider.id,
      status,
      params,
      requestedBy: userIdentity(req),
      requestedAt: now,
      expiresAt,
      candidates: status === 'error' ? [] : (lookupResult?.candidates || []),
      error: errorPayload,
      meta: lookupResult?.meta || null,
    });

    // Build comprehensive audit details with full response for debugging
    const auditDetails = {
      status,
      httpStatus: status === 'error' ? 500 : 200,
      candidateCount: enrichmentDoc.candidates?.length || 0,
      error: errorPayload,
      expiresAt,
      // Include full enrichment result for review and debugging
      enrichmentResult: lookupResult ? JSON.stringify(lookupResult, null, 2) : null,
      // Include search parameters that were sent
      params: JSON.stringify(params, null, 2),
    };

    await CaseAudit.create({
      caseId: caseDoc._id,
      type: `enrichment_${provider.id}`,
      actor: req.user?.email || req.user?.uid || 'system',
      details: auditDetails,
    });

    const responsePayload = mapEnrichmentDocument(enrichmentDoc.toObject({ virtuals: true }), provider);

    res.json({
      enrichment: responsePayload,
      cached: false,
      nextRefreshAt: expiresAt,
    });
  } catch (err) {
    console.error(`POST /cases/:caseId/enrichment/${req.params?.providerId} error:`, err);
    if (err?.code === 'ENRICHMENT_MISCONFIGURED') {
      return res.status(500).json({ error: 'Enrichment provider is not configured on the server.' });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    if (err?.status) {
      return res.status(err.status).json({ error: err.message || 'Enrichment request failed' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:caseId/enrichment/:providerId/select', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:enrich', 'cases:enrich:department']);

    const provider = getEnrichmentProvider(req.params.providerId);
    if (!provider) {
      return res.status(404).json({ error: 'Unknown enrichment provider' });
    }

    const { recordId } = req.body || {};
    if (!recordId || typeof recordId !== 'string') {
      return res.status(400).json({ error: 'recordId is required' });
    }

    const selector = scopedCaseFilter(req, { _id: req.params.caseId });
    let qCase = Case.findOne(selector);
    if (qCase && typeof qCase.lean === 'function') {
      qCase = qCase.lean();
    }
    const caseDoc = await withTimeout(
      qCase && typeof qCase.exec === 'function' ? qCase.exec() : qCase,
      MAX_DB_MS,
      `${provider.id}:case`
    );

    if (!caseDoc) {
      return res.status(404).json({ error: 'Case not found' });
    }

    let qSel = CaseEnrichment.findOne({
      caseId: caseDoc._id,
      provider: provider.id,
    });
    if (qSel && typeof qSel.sort === 'function') {
      qSel = qSel.sort({ requestedAt: -1, createdAt: -1 });
    }
    const enrichmentDoc = await withTimeout(
      qSel && typeof qSel.exec === 'function' ? qSel.exec() : qSel,
      MAX_DB_MS,
      `${provider.id}:selectLatest`
    );

    if (!enrichmentDoc) {
      return res.status(404).json({ error: 'No enrichment results available for selection' });
    }

    const candidates = Array.isArray(enrichmentDoc.candidates) ? enrichmentDoc.candidates : [];
    const candidate = candidates.find((item) => item?.recordId === recordId);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found in the latest enrichment run' });
    }

    const selection = {
      recordId,
      selectedAt: new Date(),
      selectedBy: userIdentity(req),
      payload: candidate,
    };

    const existingIndex = enrichmentDoc.selectedRecords.findIndex((item) => item?.recordId === recordId);
    if (existingIndex === -1) {
      enrichmentDoc.selectedRecords.push(selection);
    } else {
      enrichmentDoc.selectedRecords[existingIndex] = selection;
    }

    await enrichmentDoc.save();

    await CaseAudit.create({
      caseId: caseDoc._id,
      type: `enrichment_${provider.id}_select`,
      actor: req.user?.email || req.user?.uid || 'system',
      details: { recordId },
    });

    const responsePayload = mapEnrichmentDocument(enrichmentDoc.toObject({ virtuals: true }), provider);
    const expiresAt = enrichmentDoc.expiresAt ? new Date(enrichmentDoc.expiresAt) : null;

    res.json({
      enrichment: responsePayload,
      cached: Boolean(expiresAt && expiresAt > new Date()),
      nextRefreshAt: expiresAt,
    });
  } catch (err) {
    console.error(`POST /cases/:caseId/enrichment/${req.params?.providerId}/select error:`, err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
