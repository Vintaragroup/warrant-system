import express from 'express';
import { firebaseAuth } from '../lib/firebaseAdmin.js';
import User from '../models/User.js';
import AuthAudit from '../models/AuthAudit.js';
import AccessRequest from '../models/AccessRequest.js';
import { requireAuth, optionalAuth, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const router = express.Router();

const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 14);

async function recordAuthEvent(event, payload = {}) {
  try {
    await AuthAudit.create({
      event,
      uid: payload.uid,
      email: payload.email,
      ip: payload.ip,
      userAgent: payload.userAgent,
      metadata: payload.metadata,
    });
  } catch (err) {
    console.warn('Failed to persist auth audit event', err);
  }
  try {
    console.info(`[auth] ${event}`, { ...payload, ts: new Date().toISOString() });
  } catch { /* noop */ }
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    roles: user.roles,
    departments: user.departments,
    counties: user.counties,
    status: user.status,
    mfaEnforced: user.mfaEnforced,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function sanitizeAccessRequest(request) {
  if (!request) return null;
  return {
    id: request.id,
    email: request.email,
    displayName: request.displayName,
    message: request.message,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

router.post('/session', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken) {
    return res.status(400).json({ message: 'idToken is required' });
  }

  try {
    const decoded = await firebaseAuth.verifyIdToken(idToken, true);
    const existing = await User.findOne({ uid: decoded.uid }).lean();
    const updates = {
      email: decoded.email?.toLowerCase() || undefined,
      emailVerified: decoded.email_verified || false,
      displayName: decoded.name || undefined,
      lastLoginAt: new Date(),
    };
    // If this is a first-time login or the user was invited, mark as active now.
    if (!existing || existing.status === 'invited') {
      updates.status = 'active';
    }
    const options = { new: true, upsert: true, setDefaultsOnInsert: true };
    const userDoc = await User.findOneAndUpdate({ uid: decoded.uid }, { $set: updates }, options);

    await setSessionCookie(res, idToken);
    await recordAuthEvent('session_created', {
      uid: decoded.uid,
      email: decoded.email,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.json({
      ok: true,
      user: sanitizeUser(userDoc),
      sessionExpiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
    });
  } catch (err) {
    console.error('Failed to create session:', err);
    await recordAuthEvent('session_failed', {
      reason: err.message,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.status(401).json({ message: 'Invalid ID token' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  recordAuthEvent('logout', {
    uid: req.user?.uid,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  return res.json({ ok: true });
});

router.get('/me', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  return res.json({ ok: true, user: req.user });
});

router.post('/session/revoke', requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    await firebaseAuth.revokeRefreshTokens(uid);
    clearSessionCookie(res);
    await recordAuthEvent('session_revoked', {
      uid,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to revoke sessions:', err);
    return res.status(500).json({ message: 'Failed to revoke sessions' });
  }
});

router.post('/access-request', async (req, res) => {
  const { email, displayName, message } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'email is invalid' });
  }

  const existingUser = await User.findOne({ email: normalizedEmail }).lean();
  if (existingUser) {
    return res.status(409).json({ error: 'An account already exists for this email address.' });
  }

  const payload = {
    email: normalizedEmail,
    displayName: typeof displayName === 'string' ? displayName.trim() : '',
    message: typeof message === 'string' ? message.trim() : '',
  };

  const doc = await AccessRequest.create(payload);

  try {
    await recordAuthEvent('access_requested', {
      email: normalizedEmail,
      metadata: { displayName: payload.displayName },
    });
  } catch (err) {
    console.warn('Failed to log access request event', err?.message);
  }

  res.status(202).json({ ok: true, request: sanitizeAccessRequest(doc.toObject()) });
});

export default router;
