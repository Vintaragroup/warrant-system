/**
 * Shared helpers for querying the v2_* booking pipeline collections.
 *
 * These collections are the live source of truth written by the v2 ingestion pipeline.
 * The dashboard, cases, reports, and enrichment proxy all use this same list + normalization.
 *
 * Collection layout (matches dashboard.js COUNTY_COLLECTIONS exactly):
 *   v2_galveston_events   - Galveston current roster (arrest_date as primary date)
 *   v2_harris_reports     - Harris reports (observed_at as primary date)
 *   v2_lookup_results     - Fort Bend, Jefferson, Brazoria (booking_date)
 *   v2_wharton_events     - Wharton (booking_date)
 *   v2_jefferson_events   - Jefferson secondary (booking_date)
 *
 * NOTE: there is NO v2_fortbend_events - Fort Bend data lives in v2_lookup_results.
 */

export const V2_CASE_COLLECTIONS = [
  'v2_galveston_events',
  'v2_harris_reports',
  'v2_lookup_results',
  'v2_wharton_events',
  'v2_jefferson_events',
];

export const DASHBOARD_TZ = process.env.DASHBOARD_TZ || 'America/Chicago';

// Maps a county name to a friendly fallback label when the doc lacks a county field.
// Used during normalization to ensure every doc has a county string.
const COLLECTION_COUNTY_FALLBACK = {
  v2_galveston_events:  'galveston',
  v2_harris_reports:    'harris',
  v2_lookup_results:    'lookup',
  v2_wharton_events:    'wharton',
  v2_jefferson_events:  'jefferson',
};

/**
 * Build the MongoDB $let expression that converts a field to a YYYY-MM-DD string.
 * Fast-paths YYYY-MM-DD strings to avoid UTC-offset drift.
 * @param {string} fieldPath - e.g. 'arrest_date'
 */
export function toYmdExpr(fieldPath) {
  const tz = DASHBOARD_TZ;
  return {
    $let: {
      vars: {
        value: `$${fieldPath}`,
        asDate: { $convert: { input: `$${fieldPath}`, to: 'date', onError: null, onNull: null } },
        strValue: { $toString: { $ifNull: [`$${fieldPath}`, ''] } },
      },
      in: {
        $cond: [
          {
            $or: [
              { $eq: ['$$value', null] },
              { $eq: [{ $type: '$$value' }, 'missing'] },
              { $eq: ['$$strValue', ''] },
            ],
          },
          null,
          {
            $cond: [
              { $regexMatch: { input: '$$strValue', regex: /^\d{4}-\d{2}-\d{2}$/ } },
              { $substrCP: ['$$strValue', 0, 10] },
              {
                $cond: [
                  { $ne: ['$$asDate', null] },
                  { $dateToString: { date: '$$asDate', timezone: tz, format: '%Y-%m-%d' } },
                  null,
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * Returns the two $set aggregation stages that compute booking_date_n and bond_amount_n.
 * After these stages every document has:
 *   booking_date_n  - YYYY-MM-DD string (first non-null from priority list)
 *   booking_date    - alias for booking_date_n
 *   bond_amount_n   - Number | null
 *   bond_amount     - alias for bond_amount_n
 */
export function buildNormalizeStages() {
  const firstNonNull = (candidates) => ({
    $let: {
      vars: {
        filtered: {
          $filter: {
            input: candidates,
            as: 'd',
            cond: { $and: [{ $ne: ['$$d', null] }, { $ne: ['$$d', ''] }] },
          },
        },
      },
      in: {
        $cond: [
          { $gt: [{ $size: '$$filtered' }, 0] },
          { $arrayElemAt: ['$$filtered', 0] },
          null,
        ],
      },
    },
  });

  return [
    {
      $set: {
        // Booking date: priority matches dashboard.js order
        booking_date_n: firstNonNull([
          toYmdExpr('arrest_date'),
          toYmdExpr('booking_date'),
          toYmdExpr('observed_at'),
          toYmdExpr('booked_at'),
          toYmdExpr('event_date'),
          toYmdExpr('booking_date_iso'),
          toYmdExpr('normalized_at'),
          toYmdExpr('scraped_at'),
        ]),
        // Bond amount: numeric coercion with REFER TO MAGISTRATE fallback to null
        bond_amount_n: {
          $let: {
            vars: {
              bAmt: '$bond_amount',
              b: '$bond',
              bl: { $toString: { $ifNull: ['$bond_label', ''] } },
            },
            in: {
              $switch: {
                branches: [
                  { case: { $isNumber: '$$bAmt' }, then: '$$bAmt' },
                  { case: { $isNumber: '$$b' },    then: '$$b' },
                  {
                    case: { $regexMatch: { input: { $toString: '$$b' }, regex: /^\d+(\.\d+)?$/ } },
                    then: { $toDouble: '$$b' },
                  },
                  {
                    case: { $regexMatch: { input: '$$bl', regex: /REFER TO MAGISTRATE/i } },
                    then: null,
                  },
                ],
                default: null,
              },
            },
          },
        },
      },
    },
    // Expose canonical aliases so downstream always sees booking_date and bond_amount
    {
      $set: {
        booking_date: '$booking_date_n',
        bond_amount:  '$bond_amount_n',
      },
    },
  ];
}

/**
 * Build the county-lowercase $set stage for a given collection.
 * Ensures every doc has a lowercase trimmed county field.
 */
export function buildCountyStage(collName) {
  const fallback = COLLECTION_COUNTY_FALLBACK[collName] || 'unknown';
  return {
    $set: {
      county: {
        $toLower: {
          $trim: { input: { $ifNull: ['$county', fallback] } },
        },
      },
    },
  };
}

/**
 * Map a Cases-page window ID to a MongoDB filter using booking_date_n.
 * Applied AFTER the normalization $set stages.
 *
 * NOTE: We intentionally do NOT use time_bucket_v2 here. That field is set
 * once at ingestion time and never updated, so it reflects the bucket when the
 * record was FIRST written, not the current elapsed time. For a live "Last N
 * hours" query we need date arithmetic against booking_date_n.
 *
 *   '24h'    → booking_date_n >= today - 1 day
 *   '48h'    → booking_date_n >= today - 2 days
 *   '72h'    → booking_date_n >= today - 3 days
 *   '7d'     → booking_date_n >= today - 7 days
 *   '30d'    → booking_date_n >= today - 30 days
 *   '48-72h' → booking_date_n in [today-3d, today-2d) (exclusive slot)
 *
 * Returns null for unrecognised window IDs (caller should use date range instead).
 */
export function buildV2WindowFilter(windowId) {
  const now = new Date();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const ago = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return ymd(d); };

  switch (String(windowId).toLowerCase()) {
    case '24h':
      return { booking_date_n: { $gte: ago(1) } };
    case '48h':
      return { booking_date_n: { $gte: ago(2) } };
    case '72h':
      return { booking_date_n: { $gte: ago(3) } };
    case '7d':
      return { booking_date_n: { $gte: ago(7) } };
    case '30d':
      return { booking_date_n: { $gte: ago(30) } };
    case '48-72h':
    case '48–72h':
      return { booking_date_n: { $gte: ago(3), $lt: ago(2) } };
    default:
      return null;
  }
}

/**
 * Build a booking_date_n range filter for startDate/endDate (YYYY-MM-DD strings).
 * Applied AFTER the normalization $set stage.
 */
export function buildDateRangeFilter(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const filter = {};
  if (startDate) filter.$gte = String(startDate);
  if (endDate)   filter.$lte = String(endDate);
  return { booking_date_n: filter };
}

/**
 * Build a complete $unionWith aggregation pipeline across all v2_* collections.
 *
 * The pipeline:
 *   1. Runs on the base collection (v2_galveston_events) directly
 *   2. $unionWith each remaining collection
 *   3. Each branch: normalize → lowercase county → match filter
 *   4. Combined: sort + limit + project
 *
 * @param {object} postNormFilter - Match filter applied after normalization (may reference booking_date_n, bond_amount_n, county, time_bucket_v2, etc.)
 * @param {object|null} project - Optional $project stage
 * @param {number} limitNum - Number of docs to return
 * @param {object} opts
 * @param {string[]} opts.collections - Override collection list (default V2_CASE_COLLECTIONS)
 * @param {string} opts.sortField - Sort field after normalization (default 'booking_date_n')
 * @param {number} opts.sortDir - 1 (asc) or -1 (desc) default -1
 * @param {boolean} opts.excludeHarrisCivil - Whether to exclude Harris Civil rows (default true)
 */
export function buildV2UnionPipeline(postNormFilter = {}, project = null, limitNum = 25, opts = {}) {
  const {
    collections = V2_CASE_COLLECTIONS,
    sortField = 'booking_date_n',
    sortDir = -1,
    excludeHarrisCivil = true,
  } = opts;

  const normalizeStages = buildNormalizeStages();

  // Per-collection prep stages (normalize + county lowercase + optional Civil exclusion + filter)
  const perCollStages = (collName) => {
    const stages = [
      ...normalizeStages,
      buildCountyStage(collName),
    ];
    if (excludeHarrisCivil) {
      stages.push({ $match: { $nor: [{ county: 'harris', category: 'Civil' }] } });
    }
    if (postNormFilter && Object.keys(postNormFilter).length) {
      stages.push({ $match: postNormFilter });
    }
    return stages;
  };

  const [baseCollection, ...restCollections] = collections;

  const pipeline = [
    // Base collection stages
    ...perCollStages(baseCollection),
    // Union remaining collections
    ...restCollections.map((coll) => ({
      $unionWith: {
        coll,
        pipeline: perCollStages(coll),
      },
    })),
    // Global sort + limit + project
    { $sort: { [sortField]: sortDir, _id: -1 } },
    { $limit: limitNum },
    ...(project ? [{ $project: project }] : []),
  ];

  return { pipeline, baseCollection };
}

/**
 * Build a count-only pipeline across all v2_* collections.
 * Returns the MongoDB aggregation pipeline to count matching docs.
 */
export function buildV2CountPipeline(postNormFilter = {}, opts = {}) {
  const {
    collections = V2_CASE_COLLECTIONS,
    excludeHarrisCivil = true,
  } = opts;

  const normalizeStages = buildNormalizeStages();

  const perCollStages = (collName) => {
    const stages = [
      ...normalizeStages,
      buildCountyStage(collName),
    ];
    if (excludeHarrisCivil) {
      stages.push({ $match: { $nor: [{ county: 'harris', category: 'Civil' }] } });
    }
    if (postNormFilter && Object.keys(postNormFilter).length) {
      stages.push({ $match: postNormFilter });
    }
    return stages;
  };

  const [baseCollection, ...restCollections] = collections;

  const pipeline = [
    ...perCollStages(baseCollection),
    ...restCollections.map((coll) => ({
      $unionWith: { coll, pipeline: perCollStages(coll) },
    })),
    { $count: 'total' },
  ];

  return { pipeline, baseCollection };
}
