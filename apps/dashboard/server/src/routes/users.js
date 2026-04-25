import express from 'express';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import User from '../models/User.js';
import { assertPermission, hasPermission } from './utils/authz.js';
import { sendInviteEmail } from '../lib/mailer.js';

const router = express.Router();

// Helper to ensure async route errors are passed to Express error middleware (Express 4 doesn't catch promise rejections)
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const ALLOWED_STATUSES = ['active', 'suspended', 'invited', 'pending_mfa', 'deleted'];
const DEPARTMENT_MANAGER_ASSIGNABLE_ROLES = ['DepartmentLead', 'Employee', 'Sales', 'BondClient'];

function uniqueStrings(values = []) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
}

function arraysEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  return aSorted.every((value, index) => value === bSorted[index]);
}

function sanitizeUserDoc(doc) {
  if (!doc) return null;
  return {
    uid: doc.uid,
    email: doc.email,
    displayName: doc.displayName,
    roles: doc.roles || [],
    departments: doc.departments || [],
    counties: doc.counties || [],
    status: doc.status,
    mfaEnforced: doc.mfaEnforced,
    lastLoginAt: doc.lastLoginAt,
    invitedAt: doc.invitedAt,
    invitedBy: doc.invitedBy,
    lastRoleChangeAt: doc.lastRoleChangeAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function lookupInviterId(req) {
  if (!req?.user?.uid) return null;
  try {
    const inviter = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    return inviter?._id || null;
  } catch (err) {
    console.warn('Unable to look up inviter user id', err?.message);
    return null;
  }
}

function buildScopedUserFilter(req) {
  if (hasPermission(req, 'users:manage')) {
    return null;
  }
  assertPermission(req, 'users:manage:department');
  const departments = uniqueStrings(req.user?.departments || []);
  const counties = uniqueStrings(req.user?.counties || []);
  if (!departments.length && !counties.length) {
    const err = new Error('Department access requires assignment');
    err.statusCode = 403;
    throw err;
  }
  const scopeClauses = [];
  if (departments.length) {
    scopeClauses.push({ departments: { $in: departments } });
  }
  if (counties.length) {
    scopeClauses.push({ counties: { $in: counties } });
  }
  return scopeClauses.length ? { $or: scopeClauses } : { _id: null };
}

function enforceRoleAssignmentPermissions(req, roles = []) {
  if (!roles.length) return;
  const isGlobalManager = hasPermission(req, 'users:manage');
  if (!isGlobalManager) {
    const forbidden = roles.filter((role) => !DEPARTMENT_MANAGER_ASSIGNABLE_ROLES.includes(role));
    if (forbidden.length) {
      const err = new Error(`Insufficient permission to assign roles: ${forbidden.join(', ')}`);
      err.statusCode = 403;
      throw err;
    }
  }
  const isSuperUser = Array.isArray(req.user?.roles) && req.user.roles.includes('SuperUser');
  if (roles.includes('SuperUser') && !isSuperUser) {
    const err = new Error('Only SuperUser accounts may assign the SuperUser role');
    err.statusCode = 403;
    throw err;
  }
}

function enforceScopeAssignment(req, departments = [], counties = []) {
  if (hasPermission(req, 'users:manage')) return;
  const allowedDepartments = new Set(uniqueStrings(req.user?.departments || []));
  const allowedCounties = new Set(uniqueStrings(req.user?.counties || []));
  if (departments.length && !departments.every((d) => allowedDepartments.has(d))) {
    const err = new Error('Cannot assign departments outside your scope');
    err.statusCode = 403;
    throw err;
  }
  if (counties.length && !counties.every((c) => allowedCounties.has(c))) {
    const err = new Error('Cannot assign counties outside your scope');
    err.statusCode = 403;
    throw err;
  }
}

async function ensureFirebaseUser({ email, displayName }) {
  let record;
  try {
    record = await firebaseAuth.getUserByEmail(email);
    if (displayName && record.displayName !== displayName) {
      await firebaseAuth.updateUser(record.uid, { displayName });
      record = await firebaseAuth.getUser(record.uid);
    }
    return { record, created: false };
  } catch (err) {
    if (err?.code !== 'auth/user-not-found') {
      throw err;
    }
  }
  record = await firebaseAuth.createUser({ email, displayName });
  return { record, created: true };
}

router.get('/', asyncHandler(async (req, res) => {
  if (!hasPermission(req, 'users:manage') && !hasPermission(req, 'users:manage:department')) {
    assertPermission(req, 'users:manage');
  }

  const conditions = [];
  const scopedFilter = buildScopedUserFilter(req);
  if (scopedFilter) conditions.push(scopedFilter);

  const { role, status, search } = req.query || {};
  if (role) {
    conditions.push({ roles: String(role) });
  }
  if (status) {
    conditions.push({ status: String(status) });
  }
  if (search) {
    const regex = new RegExp(String(search), 'i');
    conditions.push({ $or: [{ email: regex }, { displayName: regex }] });
  }

  const query = conditions.length ? { $and: conditions } : {};
  const users = await User.find(query).sort({ createdAt: -1 }).lean();
  res.json({ users: users.map(sanitizeUserDoc) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const emailRaw = payload.email;
  if (!emailRaw || typeof emailRaw !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  const email = emailRaw.trim().toLowerCase();
  const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : undefined;
  const roles = uniqueStrings(payload.roles || ['BondClient']);
  const departments = uniqueStrings(payload.departments || []);
  const counties = uniqueStrings(payload.counties || []);
  const status = typeof payload.status === 'string' && ALLOWED_STATUSES.includes(payload.status)
    ? payload.status
    : 'invited';

  enforceRoleAssignmentPermissions(req, roles);
  enforceScopeAssignment(req, departments, counties);

  const { record, created } = await ensureFirebaseUser({ email, displayName });
  const inviterId = await lookupInviterId(req);
  const existing = await User.findOne({ uid: record.uid }).lean();
  const now = new Date();
  const updates = {
    email,
    displayName: displayName || record.displayName || '',
    roles,
    departments,
    counties,
    status,
    invitedAt: existing?.invitedAt || now,
  };
  if (!existing?.invitedBy && inviterId) {
    updates.invitedBy = inviterId;
  }
  if (!existing || !arraysEqual(existing.roles || [], roles)) {
    updates.lastRoleChangeAt = now;
  }

  const doc = await User.findOneAndUpdate(
    { uid: record.uid },
    { $set: updates },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  let inviteLink = null;
  let emailed = false;
  try {
    inviteLink = await firebaseAuth.generatePasswordResetLink(email);
  } catch (err) {
    console.warn('Failed to generate invite link', err?.message);
  }

  if (inviteLink) {
    try {
      emailed = await sendInviteEmail({ to: email, inviteLink, displayName: updates.displayName });
    } catch (err) {
      console.warn('Failed to send invite email', err?.message);
    }
  }

  res.status(created ? 201 : 200).json({ user: sanitizeUserDoc(doc), inviteLink, emailed, message: emailed ? 'Invitation email sent' : 'Invitation link generated' });
}));

router.patch('/:uid', asyncHandler(async (req, res) => {
  const { uid } = req.params;
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }
  const payload = req.body || {};
  const existing = await User.findOne({ uid }).lean();
  if (!existing) {
    return res.status(404).json({ error: 'User not found' });
  }

  const scopedFilter = buildScopedUserFilter(req);
  if (scopedFilter) {
    const allowed = await User.exists({ uid, ...scopedFilter });
    if (!allowed) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }

  const updates = {};
  let shouldUpdateFirebase = false;
  let firebaseUpdate = {};

  if (payload.email) {
    const email = String(payload.email).trim().toLowerCase();
    updates.email = email;
    firebaseUpdate.email = email;
    shouldUpdateFirebase = true;
  }

  if (payload.displayName !== undefined) {
    const displayName = payload.displayName ? String(payload.displayName) : '';
    updates.displayName = displayName;
    firebaseUpdate.displayName = displayName;
    shouldUpdateFirebase = true;
  }

  if (payload.roles) {
    const roles = uniqueStrings(payload.roles);
    enforceRoleAssignmentPermissions(req, roles);
    updates.roles = roles;
    updates.lastRoleChangeAt = new Date();
  }

  if (payload.departments) {
    const departments = uniqueStrings(payload.departments);
    enforceScopeAssignment(req, departments, []);
    updates.departments = departments;
  }

  if (payload.counties) {
    const counties = uniqueStrings(payload.counties);
    enforceScopeAssignment(req, [], counties);
    updates.counties = counties;
  }

  if (payload.status) {
    const status = String(payload.status);
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }
    updates.status = status;
  }

  if (payload.mfaEnforced !== undefined) {
    updates.mfaEnforced = Boolean(payload.mfaEnforced);
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No supported fields to update' });
  }

  const doc = await User.findOneAndUpdate(
    { uid },
    { $set: updates },
    { new: true }
  );

  if (shouldUpdateFirebase) {
    try {
      await firebaseAuth.updateUser(uid, firebaseUpdate);
    } catch (err) {
      console.warn('Failed to update Firebase user', err?.message);
    }
  }

  res.json({ user: sanitizeUserDoc(doc) });
}));

router.post('/:uid/revoke', asyncHandler(async (req, res) => {
  const { uid } = req.params;
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  if (!hasPermission(req, 'users:manage') && !hasPermission(req, 'users:manage:department')) {
    assertPermission(req, 'users:manage');
  }
  const scopedFilter = buildScopedUserFilter(req);
  if (scopedFilter) {
    const allowed = await User.exists({ uid, ...scopedFilter });
    if (!allowed) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }

  await firebaseAuth.revokeRefreshTokens(uid);
  res.json({ ok: true });
}));

export default router;
