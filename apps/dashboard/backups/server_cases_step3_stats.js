import { Router } from 'express';
import mongoose from 'mongoose';
import Case from '../models/Case.js';
import Message from '../models/Message.js';
import CaseAudit from '../models/CaseAudit.js';

// Per-file DB timeout for potentially expensive queries
const MAX_DB_MS = 5000;

// Helper to timeout a promise-returning DB operation so handlers don't hang
function withTimeout(promise, ms = MAX_DB_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('operation timed out')), ms)),
  ]);
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

r.get('/stats', async (_req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    const upcomingEnd = new Date(startOfToday);
    upcomingEnd.setDate(upcomingEnd.getDate() + 7);

    const agg = Case.aggregate([
      {
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
      },
    ]).option({ maxTimeMS: MAX_DB_MS });

    const [result] = await withTimeout(agg.exec(), MAX_DB_MS).catch((err) => {
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

    res.json({
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
    });
  } catch (err) {
    console.error('GET /cases/stats error:', err);
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
    const {
      query = '',
      county,
      status,
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
    } = req.query;
    const bondLabelAlias = req.query.bond_label;

    const filter = {};

    // Core filters
    if (county) filter.county = county;
    if (status) filter.status = status;

    // Text search (ensure a text index on relevant fields: full_name, offense, case_number, etc.)
    if (query) filter.$text = { $search: query };

    // Date window on normalized booking_date (YYYY-MM-DD)
    if (startDate || endDate) {
      filter.booking_date = {};
      if (startDate) filter.booking_date.$gte = String(startDate);
      if (endDate) filter.booking_date.$lte = String(endDate);
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
      filter.$or = [
        { bond_label: { $regex: /^REFER TO MAGISTRATE$/i } },
        { bond: { $regex: /^REFER TO MAGISTRATE$/i } },
        { "_upsert_key.anchor": { $not: /^[0-9]+$/ } }
      ];
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
      "_upsert_key.anchor": 1,
      // Legacy fields kept only for back-compat view (not used for sorting/sums)
      bookedAt: 1,
      booking_date_iso: 1,
      bond: 1,
    };

    const qFind = Case
      .find(filter)
      .select(projection)
      .sort({ [sortField]: sortDir, booking_date: -1, _id: -1 })
      .limit(limitNum)
      .lean();

    const qCount = Case.countDocuments(filter);

    // Apply maxTimeMS when the driver/query supports it, and wrap with a timeout
    let items = await withTimeout((qFind.maxTimeMS ? qFind.maxTimeMS(MAX_DB_MS) : qFind), MAX_DB_MS).catch((e) => {
      console.warn('cases: find timed out or failed', e?.message);
      return [];
    });
    const count = await withTimeout((qCount.maxTimeMS ? qCount.maxTimeMS(MAX_DB_MS) : qCount), MAX_DB_MS).catch((e) => {
      console.warn('cases: count timed out or failed', e?.message);
      return 0;
    });

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
    item.crm_details = {
      qualificationNotes: item.crm_details.qualificationNotes || '',
      documents: normalizeChecklist(item.crm_details.documents),
      followUpAt: item.crm_details.followUpAt || null,
      assignedTo: item.crm_details.assignedTo || '',
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

    res.json({ items: limitedItems, count: mappedItems.length, total: count });
  } catch (err) {
    console.error('GET /cases error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/tags', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
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

    const existing = await withTimeout(
      Case.findById(req.params.id).select({ manual_tags: 1 }),
      MAX_DB_MS
    );

    if (!existing) {
      return res.status(404).json({ error: 'Case not found' });
    }

    await withTimeout(
      Case.findByIdAndUpdate(
        req.params.id,
        { $set: { manual_tags: normalized, updatedAt: new Date() } },
        { new: false }
      ),
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
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cases/:id
 * Returns a single case document. Fields already normalized.
 */
r.get('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const qGet = Case.findById(req.params.id).lean();
    const doc = await withTimeout((qGet.maxTimeMS ? qGet.maxTimeMS(MAX_DB_MS) : qGet), MAX_DB_MS).catch((e) => {
      console.error('GET /cases/:id timed out or failed', e?.message);
      return null;
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (!Array.isArray(doc.manual_tags)) doc.manual_tags = [];
    if (!doc.crm_stage) doc.crm_stage = 'new';
    doc.crm_details = {
      qualificationNotes: doc.crm_details?.qualificationNotes || '',
      documents: normalizeChecklist(doc.crm_details?.documents),
      followUpAt: doc.crm_details?.followUpAt || null,
      assignedTo: doc.crm_details?.assignedTo || '',
      attachments: Array.isArray(doc.crm_details?.attachments) ? doc.crm_details.attachments : [],
      acceptance: {
        accepted: Boolean(doc.crm_details?.acceptance?.accepted),
        acceptedAt: doc.crm_details?.acceptance?.acceptedAt || null,
        notes: doc.crm_details?.acceptance?.notes || '',
      },
      denial: {
        denied: Boolean(doc.crm_details?.denial?.denied),
        deniedAt: doc.crm_details?.denial?.deniedAt || null,
        reason: doc.crm_details?.denial?.reason || '',
        notes: doc.crm_details?.denial?.notes || '',
      },
    };

    const attachmentsRaw = Array.isArray(doc.crm_details.attachments) ? doc.crm_details.attachments : [];
    const normalizedAttachments = normalizeAttachments(attachmentsRaw, attachmentsRaw);
    doc.crm_details.attachments = normalizedAttachments;
    if (attachmentsRaw.some((att) => att && !att.id)) {
      await Case.updateOne(
        { _id: doc._id },
        { $set: { 'crm_details.attachments': normalizedAttachments } }
      ).catch((err) => {
        console.warn('Failed to backfill attachment ids for case', doc._id?.toString?.() || doc._id, err?.message);
      });
    }
    const { contactSet, lastMap } = await fetchContactMeta([doc._id]);
    const idStr = String(doc._id);
    doc.contacted = contactSet.has(idStr);
    const last = lastMap.get(idStr);
    if (last) doc.last_contact_at = last;

    res.json(doc);
  } catch (err) {
    console.error('GET /cases/:id error:', err);
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

    const qMsg = Message.find({ caseId: objectId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select({
        direction: 1,
        channel: 1,
        status: 1,
        body: 1,
        createdAt: 1,
        sentAt: 1,
        deliveredAt: 1,
        errorCode: 1,
        errorMessage: 1,
      })
      .lean();

    const itemsRaw = await withTimeout((qMsg.maxTimeMS ? qMsg.maxTimeMS(MAX_DB_MS) : qMsg), MAX_DB_MS).catch(() => []);

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

    const original = await Message.findOne({ _id: messageObjectId, caseId: caseObjectId }).lean();
    if (!original) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (original.direction !== 'out') {
      return res.status(400).json({ error: 'Only outbound messages can be resent' });
    }

    if (!original.to) {
      return res.status(400).json({ error: 'Original message missing recipient' });
    }
    if (!original.body) {
      return res.status(400).json({ error: 'Original message missing body content' });
    }

    const doc = await Message.create({
      caseId: caseObjectId,
      direction: 'out',
      channel: original.channel,
      to: original.to,
      from: original.from,
      body: original.body,
      status: 'queued',
      provider: original.provider,
      meta: {
        ...(original.meta || {}),
        resendOf: original._id,
      },
    });

    await CaseAudit.create({
      caseId: caseObjectId,
      type: 'message_resend',
      actor: req.user?.email || req.user?.id || 'system',
      details: { messageId: doc._id, originalId: original._id },
    });

    res.status(201).json({ id: doc._id.toString(), status: doc.status, queuedAt: doc.createdAt });
  } catch (err) {
    console.error('POST /cases/:caseId/messages/:messageId/resend error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/stage', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const stage = String(req.body?.stage || '').toLowerCase();
    const note = req.body?.note ? String(req.body.note) : undefined;

    if (!CRM_STAGES.includes(stage)) {
      return res.status(400).json({ error: 'Invalid stage' });
    }

    const existing = await withTimeout(
      Case.findById(req.params.id).select({ crm_stage: 1 }),
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

    await withTimeout(
      Case.findByIdAndUpdate(
        req.params.id,
        {
          $set: { crm_stage: stage, updatedAt: new Date() },
          $push: { crm_stage_history: historyEntry },
        },
        { new: false }
      ),
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
    if (err?.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid case id' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/crm', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    const existing = await withTimeout(
      Case.findById(req.params.id).lean(),
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

    const doc = await withTimeout(
      Case.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean(),
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
        Case.findByIdAndUpdate(objectId, { $set: update }, { new: false }),
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

    const qCase = Case.findById(objectId).lean();
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
