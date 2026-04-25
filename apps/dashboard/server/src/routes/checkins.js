import { Router } from 'express';
import mongoose from 'mongoose';
import CheckIn from '../models/CheckIn.js';
import CheckInPing from '../models/CheckInPing.js';
import Case, { CaseJefferson } from '../models/Case.js';
import User from '../models/User.js';
import { filterByDepartment } from './utils/authz.js';
import { assertPermission as ensurePermission } from './utils/authz.js';
import { getGpsQueue } from '../jobs/index.js';
import { refreshGpsSchedule } from '../services/checkinsQueueService.js';

const r = Router();
const MAX_DB_MS = 5000;
const DEFAULT_OFFICER_ROLES = (process.env.CHECKIN_OFFICER_ROLES || 'SuperUser,Admin,DepartmentLead,Employee')
  .split(',')
  .map((role) => role.trim())
  .filter(Boolean);
const OFFICER_ROLE_SET = new Set(DEFAULT_OFFICER_ROLES);
const CLIENT_OPTION_LIMIT = Math.min(
  Math.max(parseInt(process.env.CHECKIN_CLIENT_OPTION_LIMIT || '40', 10), 5),
  200
);

function withTimeout(promise, ms = MAX_DB_MS) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('operation timed out')), ms)),
  ]);
}

function ensureMongoConnected(res) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    res.status(503).json({ error: 'Database not connected' });
    return false;
  }
  return true;
}

function normalize(doc) {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() || doc._id,
    clientId: doc.clientId?.toString?.() || null,
    caseId: doc.caseId?.toString?.() || doc.caseId || null,
    person: doc.person || 'Unknown',
    clientName: doc.person || 'Unknown',
    caseNumber: doc.meta?.caseNumber || doc.caseNumber || null,
    county: doc.county || 'unknown',
    dueAt: doc.dueAt,
    timezone: doc.timezone || 'UTC',
    officerId: doc.officerId?.toString?.() || null,
    method: doc.method,
    status: doc.status,
    note: doc.note || '',
    contactCount: doc.contactCount || 0,
    lastContactAt: doc.lastContactAt || null,
    location: doc.location || null,
    remindersEnabled: typeof doc.remindersEnabled === 'boolean' ? doc.remindersEnabled : true,
    gpsEnabled: Boolean(doc.gpsEnabled),
    pingsPerDay: doc.pingsPerDay || 0,
    lastPingAt: doc.lastPingAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    attendance: doc.meta?.attendance || null,
  };
}

function mapCaseToClientOption(doc) {
  if (!doc) return null;
  const id = doc._id?.toString?.();
  if (!id) return null;
  return {
    id,
    name: doc.full_name || doc.person || 'Unknown',
    county: doc.county || null,
    caseNumber: doc.case_number || doc._upsert_key?.anchor || null,
  };
}

function mapUserToOfficerOption(doc) {
  if (!doc) return null;
  const id = doc._id?.toString?.();
  if (!id) return null;
  const name = doc.displayName?.trim?.() || doc.email || 'Unassigned';
  return {
    id,
    name,
    email: doc.email || null,
    roles: Array.isArray(doc.roles) ? doc.roles : [],
  };
}

function sanitizeLocation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const accuracy = raw.accuracy != null ? Number(raw.accuracy) : undefined;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const location = { lat, lng };
  if (!Number.isNaN(accuracy)) location.accuracy = accuracy;
  return location;
}

r.get('/options', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const scopedCaseFilter = filterByDepartment({}, req, ['county'], { includeUnassigned: true });

    const caseModels = [Case, CaseJefferson].filter(Boolean);
    const perModelLimit = Math.max(Math.ceil(CLIENT_OPTION_LIMIT / caseModels.length), 5);

    const casePromises = caseModels.map((Model) => {
      const query = Model.find(scopedCaseFilter)
        .select({ _id: 1, full_name: 1, county: 1, case_number: 1, person: 1, '_upsert_key.anchor': 1 })
        .sort({ updatedAt: -1, booking_date: -1 })
        .limit(perModelLimit)
        .lean();

      return withTimeout((query.maxTimeMS ? query.maxTimeMS(MAX_DB_MS) : query), MAX_DB_MS).catch((err) => {
        console.error('checkins options (cases) error', err?.message);
        return [];
      });
    });

    const officerQuery = User.find({
      status: 'active',
      roles: { $in: Array.from(OFFICER_ROLE_SET) },
    })
      .select({ _id: 1, displayName: 1, email: 1, roles: 1 })
      .sort({ displayName: 1, email: 1 })
      .limit(100)
      .lean();

    const [caseResults, officerDocs] = await Promise.all([
      Promise.all(casePromises),
      withTimeout((officerQuery.maxTimeMS ? officerQuery.maxTimeMS(MAX_DB_MS) : officerQuery), MAX_DB_MS).catch((err) => {
        console.error('checkins options (officers) error', err?.message);
        return [];
      }),
    ]);

    const caseDocs = Array.isArray(caseResults) ? caseResults.flat() : [];

    const clientOptions = caseDocs
      .map(mapCaseToClientOption)
      .filter(Boolean)
      .slice(0, CLIENT_OPTION_LIMIT);

    const officerOptions = officerDocs
      .map(mapUserToOfficerOption)
      .filter(Boolean);

    res.json({
      clients: clientOptions,
      officers: officerOptions,
      defaults: {
        timezone: req.user?.timezone || 'America/Chicago',
        pingsPerDay: 3,
      },
    });
  } catch (err) {
    console.error('GET /checkins/options error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function dateRangeForScope(scope = 'today') {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  if (scope === 'today') {
    return { start, end, includeDone: false };
  }
  if (scope === 'overdue') {
    return { start, end: start, includeDone: false, overdueOnly: true };
  }
  if (scope === 'upcoming') {
    const futureEnd = new Date(start);
    futureEnd.setDate(futureEnd.getDate() + 7);
    return { start: end, end: futureEnd, includeDone: false };
  }
  return { start: null, end: null, includeDone: true };
}

r.get('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const scope = String(req.query.scope || 'today').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);
    const officerFilter = {};
    const searchFilter = {};

    const officerId = typeof req.query.officer === 'string' ? req.query.officer.trim() : '';
    if (officerId && officerId !== 'all') {
      if (mongoose.Types.ObjectId.isValid(officerId)) {
        officerFilter.officerId = new mongoose.Types.ObjectId(officerId);
      } else {
        officerFilter['meta.officerName'] = { $regex: officerId, $options: 'i' };
      }
    }

    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      searchFilter.person = { $regex: search, $options: 'i' };
    }

    const { start, end, includeDone, overdueOnly } = dateRangeForScope(scope);
    const queryFilter = { ...officerFilter, ...searchFilter };

    const caseIdParam = typeof req.query.caseId === 'string' ? req.query.caseId.trim() : '';
    if (caseIdParam) {
      if (mongoose.Types.ObjectId.isValid(caseIdParam)) {
        queryFilter.caseId = new mongoose.Types.ObjectId(caseIdParam);
      } else {
        queryFilter['meta.caseNumber'] = caseIdParam;
      }
    }

    if (overdueOnly && start) {
      queryFilter.dueAt = { $lt: start };
      queryFilter.status = { $ne: 'done' };
    } else if (start && end) {
      queryFilter.dueAt = { $gte: start, $lt: end };
      if (!includeDone) queryFilter.status = { $ne: 'done' };
    }

    const scopedFilter = filterByDepartment(queryFilter, req, ['county'], { includeUnassigned: true });

    const cursor = CheckIn.find(scopedFilter)
      .sort({ dueAt: 1, createdAt: 1 })
      .limit(limit)
      .lean();

    const docs = await withTimeout((cursor.maxTimeMS ? cursor.maxTimeMS(MAX_DB_MS) : cursor), MAX_DB_MS).catch((err) => {
      console.error('checkins list error', err?.message);
      return [];
    });

    const items = docs.map(normalize);

    const buildCountFilter = (rangeScope, extra = {}) => {
      const range = dateRangeForScope(rangeScope);
      const filter = { ...officerFilter, ...searchFilter, ...extra };
      if (range.overdueOnly && range.start) {
        filter.dueAt = { $lt: range.start };
        filter.status = { $ne: 'done' };
      } else if (range.start && range.end) {
        filter.dueAt = { $gte: range.start, $lt: range.end };
        if (!range.includeDone) filter.status = { $ne: 'done' };
      }
      return filterByDepartment(filter, req, ['county'], { includeUnassigned: true });
    };

    const todayQuery = CheckIn.countDocuments(buildCountFilter('today'));
    const overdueQuery = CheckIn.countDocuments(buildCountFilter('overdue'));
    const completedQuery = CheckIn.countDocuments(
      filterByDepartment({ ...officerFilter, ...searchFilter, status: 'done' }, req, ['county'], { includeUnassigned: true })
    );
    const gpsEnabledQuery = CheckIn.countDocuments(
      filterByDepartment({ ...officerFilter, ...searchFilter, gpsEnabled: true }, req, ['county'], { includeUnassigned: true })
    );

    const [todayCount, overdueCount, completedCount, gpsEnabledCount] = await Promise.all([
      withTimeout((todayQuery.maxTimeMS ? todayQuery.maxTimeMS(MAX_DB_MS) : todayQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((overdueQuery.maxTimeMS ? overdueQuery.maxTimeMS(MAX_DB_MS) : overdueQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((completedQuery.maxTimeMS ? completedQuery.maxTimeMS(MAX_DB_MS) : completedQuery).exec(), MAX_DB_MS).catch(() => 0),
      withTimeout((gpsEnabledQuery.maxTimeMS ? gpsEnabledQuery.maxTimeMS(MAX_DB_MS) : gpsEnabledQuery).exec(), MAX_DB_MS).catch(() => 0),
    ]);

    res.json({
      scope,
      limit,
      items,
      stats: {
        totalToday: todayCount,
        overdue: overdueCount,
        completed: completedCount,
        gpsEnabled: gpsEnabledCount,
      },
    });
  } catch (err) {
    console.error('GET /checkins error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/status', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const status = String(req.body?.status || '').toLowerCase();
    const note = req.body?.note ? String(req.body.note) : undefined;

    if (!['pending', 'overdue', 'done'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const update = { status, updatedAt: new Date() };
    if (note !== undefined) update.note = note;
    if (status === 'done') update.completedAt = new Date();

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins status update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    res.json(normalize(doc));
  } catch (err) {
    console.error('PATCH /checkins/:id/status error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.patch('/:id/contact', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);
    const now = new Date();
    const inc = Number(req.body?.increment || 1) || 1;

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(
        req.params.id,
        {
          $inc: { contactCount: inc },
          $set: { lastContactAt: now },
        },
        { new: true }
      ).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins contact update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    res.json(normalize(doc));
  } catch (err) {
    console.error('PATCH /checkins/:id/contact error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/attendance', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const status = String(req.body?.status || '').toLowerCase();
    if (!['attended', 'missed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use attended or missed.' });
    }

    const recordedAt = req.body?.recordedAt ? new Date(req.body.recordedAt) : new Date();
    if (Number.isNaN(recordedAt.getTime())) {
      return res.status(400).json({ error: 'Invalid recordedAt timestamp' });
    }

    const location = sanitizeLocation(req.body?.location);
    const note = req.body?.note ? String(req.body.note).trim() : '';

    const doc = await withTimeout(CheckIn.findById(req.params.id), MAX_DB_MS).catch((err) => {
      console.error('checkins attendance fetch error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    doc.lastContactAt = recordedAt;
    doc.contactCount = (doc.contactCount || 0) + 1;
    if (location) doc.location = location;
    if (note) doc.note = note;

    const attendanceRecord = {
      status,
      recordedAt,
      recordedBy: req.user?.uid || req.user?.email || null,
      note: note || undefined,
      location: location || undefined,
    };

    doc.meta = {
      ...(doc.meta || {}),
      attendance: attendanceRecord,
    };

    if (status === 'attended') {
      doc.status = 'done';
      doc.completedAt = recordedAt;
    } else if (status === 'missed') {
      doc.status = 'overdue';
    }

    doc.updatedAt = new Date();

    const saved = await withTimeout(doc.save(), MAX_DB_MS).catch((err) => {
      console.error('checkins attendance save error', err?.message);
      return null;
    });

    if (!saved) return res.status(500).json({ error: 'Unable to record attendance' });

    res.json({ checkIn: normalize(saved.toObject()) });
  } catch (err) {
    console.error('POST /checkins/:id/attendance error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/:id/pings/manual', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id),
      MAX_DB_MS
    ).catch(() => null);

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const scheduledFor = new Date();
    const ping = await CheckInPing.create({
      checkInId: doc._id,
      clientId: doc.clientId || undefined,
      scheduledFor,
      triggeredByUid: req.user?.uid || null,
      status: 'queued',
      channel: 'manual',
      payload: { reason: req.body?.reason || 'manual-trigger' },
    });

    doc.lastPingAt = scheduledFor;
    await doc.save();

    const gpsQueue = getGpsQueue();
    if (gpsQueue) {
      await gpsQueue.add('manual', {
        pingId: ping._id.toString(),
        checkInId: doc._id.toString(),
        clientId: doc.clientId ? doc.clientId.toString() : null,
        scheduledFor: scheduledFor.toISOString(),
        reason: req.body?.reason || 'manual-trigger',
      }, { removeOnComplete: 100 });
    } else {
      console.warn('GPS queue unavailable — manual ping job not enqueued');
    }

    res.status(202).json({
      ping: {
        id: ping._id?.toString?.() || ping._id,
        status: ping.status,
        scheduledFor,
      },
    });
  } catch (err) {
    console.error('POST /checkins/:id/pings/manual error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default r;
r.get('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id).lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins detail error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const pingLogs = await withTimeout(
      CheckInPing.find({ checkInId: doc._id })
        .sort({ scheduledFor: -1 })
        .limit(20)
        .lean(),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins ping fetch error', err?.message);
      return [];
    });

    res.json({
      checkIn: normalize(doc),
      pings: pingLogs.map((ping) => ({
        id: ping._id?.toString?.() || ping._id,
        scheduledFor: ping.scheduledFor,
        status: ping.status,
        channel: ping.channel,
        responseAt: ping.responseAt || null,
        location: ping.location || null,
      })),
    });
  } catch (err) {
    console.error('GET /checkins/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.get('/:id/timeline', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:read', 'cases:read:department']);

    const doc = await withTimeout(
      CheckIn.findById(req.params.id).lean(),
      MAX_DB_MS
    ).catch(() => null);
    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    const pings = await withTimeout(
      CheckInPing.find({ checkInId: doc._id })
        .sort({ scheduledFor: 1 })
        .lean(),
      MAX_DB_MS
    ).catch(() => []);

    const timeline = [];
    timeline.push({ label: 'Scheduled', timestamp: doc.createdAt || doc.dueAt, meta: doc.timezone || 'UTC' });
    timeline.push({ label: 'Due', timestamp: doc.dueAt, meta: doc.method?.toUpperCase?.() });
    if (doc.lastContactAt) {
      timeline.push({ label: 'Last contact', timestamp: doc.lastContactAt, meta: `Attempts: ${doc.contactCount || 0}` });
    }
    const attendance = doc.meta?.attendance;
    if (attendance?.recordedAt) {
      timeline.push({
        label: attendance.status === 'attended' ? 'Attended' : 'Missed',
        timestamp: attendance.recordedAt,
        meta: attendance.note || attendance.recordedBy || undefined,
      });
    }
    if (doc.status === 'done') {
      timeline.push({ label: 'Completed', timestamp: doc.updatedAt || doc.dueAt, meta: doc.note || '' });
    }
    pings.forEach((ping) => {
      timeline.push({
        label: `Ping ${ping.status}`,
        timestamp: ping.scheduledFor,
        meta: ping.location ? `${ping.location.lat}, ${ping.location.lng}` : undefined,
      });
    });

    res.json({ timeline });
  } catch (err) {
    console.error('GET /checkins/:id/timeline error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.post('/', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const payload = req.body || {};
    if (!payload.person && !payload.clientId) {
      return res.status(400).json({ error: 'Client information is required' });
    }
    if (!payload.dueAt) {
      return res.status(400).json({ error: 'dueAt is required' });
    }

    const meta = {
      ...(payload.locationText ? { locationText: payload.locationText } : {}),
      ...(payload.caseNumber ? { caseNumber: payload.caseNumber } : {}),
      ...(payload.person || payload.personName ? { personName: payload.person || payload.personName } : {}),
    };

    const document = new CheckIn({
      clientId: payload.clientId && mongoose.Types.ObjectId.isValid(payload.clientId)
        ? new mongoose.Types.ObjectId(payload.clientId)
        : undefined,
      caseId: payload.caseId && mongoose.Types.ObjectId.isValid(payload.caseId)
        ? new mongoose.Types.ObjectId(payload.caseId)
        : undefined,
      person: payload.person || payload.personName || 'Unknown',
      county: payload.county || 'unknown',
      dueAt: new Date(payload.dueAt),
      timezone: payload.timezone || 'UTC',
      officerId: payload.officerId && mongoose.Types.ObjectId.isValid(payload.officerId)
        ? new mongoose.Types.ObjectId(payload.officerId)
        : undefined,
      method: payload.method || 'sms',
      note: payload.notes || payload.note || '',
      remindersEnabled: payload.remindersEnabled !== undefined ? Boolean(payload.remindersEnabled) : true,
      gpsEnabled: Boolean(payload.gpsEnabled),
      pingsPerDay: Math.min(Math.max(Number(payload.pingsPerDay) || 3, 1), 12),
      meta,
    });

    const saved = await document.save();

    try {
      await refreshGpsSchedule(saved._id);
    } catch (err) {
      console.error('checkins schedule refresh error', err?.message || err);
    }

    const refreshed = await CheckIn.findById(saved._id).lean().catch(() => null);
    res.status(201).json({ checkIn: normalize(refreshed || saved.toObject()) });
  } catch (err) {
    console.error('POST /checkins error', err);
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message || 'Forbidden' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

r.put('/:id', async (req, res) => {
  try {
    if (!ensureMongoConnected(res)) return;
    ensurePermission(req, ['cases:write', 'cases:write:department']);

    const payload = req.body || {};
    const update = {};
    if (payload.dueAt) update.dueAt = new Date(payload.dueAt);
    if (payload.timezone) update.timezone = payload.timezone;
    if (payload.method) update.method = payload.method;
    if (payload.notes !== undefined) update.note = payload.notes;
    if (payload.remindersEnabled !== undefined) update.remindersEnabled = Boolean(payload.remindersEnabled);
    if (payload.gpsEnabled !== undefined) update.gpsEnabled = Boolean(payload.gpsEnabled);
    if (payload.pingsPerDay !== undefined) update.pingsPerDay = Math.min(Math.max(Number(payload.pingsPerDay) || 3, 1), 12);
    if (payload.officerId) {
      update.officerId = mongoose.Types.ObjectId.isValid(payload.officerId)
        ? new mongoose.Types.ObjectId(payload.officerId)
        : undefined;
    }

    const doc = await withTimeout(
      CheckIn.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }),
      MAX_DB_MS
    ).catch((err) => {
      console.error('checkins update error', err?.message);
      return null;
    });

    if (!doc) return res.status(404).json({ error: 'Check-in not found' });

    try {
      await refreshGpsSchedule(doc._id);
    } catch (err) {
      console.error('checkins schedule refresh error', err?.message || err);
    }

    const refreshed = await CheckIn.findById(doc._id).lean().catch(() => doc.toObject());

    res.json({ checkIn: normalize(refreshed) });
  } catch (err) {
    console.error('PUT /checkins/:id error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
