import express from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import passport, { WEB_ORIGIN } from '../lib/passport.js';
import User from '../models/User.js';
import AuthAudit from '../models/AuthAudit.js';
import AccessRequest from '../models/AccessRequest.js';
import { sendPasswordSetEmail } from '../lib/mailer.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = express.Router();

const RESET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

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

router.post('/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      await recordAuthEvent('session_failed', {
        email: req.body?.email,
        reason: info?.message,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.status(401).json({ message: info?.message || 'Invalid email or password' });
    }
    req.login(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      user.lastLoginAt = new Date();
      await user.save();
      await recordAuthEvent('session_created', {
        uid: user.uid,
        email: user.email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      return res.json({ ok: true, user: sanitizeUser(user) });
    });
  })(req, res, next);
});

router.get('/google', (req, res, next) => {
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: `${WEB_ORIGIN}/auth/login` }, async (err, user) => {
    if (err || !user) {
      return res.redirect(`${WEB_ORIGIN}/auth/login`);
    }
    req.login(user, async (loginErr) => {
      if (loginErr) return next(loginErr);
      await recordAuthEvent('session_created', {
        uid: user.uid,
        email: user.email,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        metadata: { provider: 'google' },
      });
      return res.redirect(`${WEB_ORIGIN}/auth/auth-success`);
    });
  })(req, res, next);
});

router.post('/logout', (req, res) => {
  const uid = req.user?.uid;
  req.logout(() => {
    req.session?.destroy(() => {
      res.clearCookie(process.env.SESSION_COOKIE_NAME || '__asap_session');
      recordAuthEvent('logout', { uid, ip: req.ip, userAgent: req.get('user-agent') });
      return res.json({ ok: true });
    });
  });
});

router.get('/me', optionalAuth, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  return res.json({ ok: true, user: req.user });
});

router.post('/session/revoke', requireAuth, async (req, res) => {
  try {
    await User.updateOne({ uid: req.user.uid }, { $inc: { sessionVersion: 1 } });
    await recordAuthEvent('session_revoked', {
      uid: req.user.uid,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Failed to revoke sessions:', err);
    return res.status(500).json({ message: 'Failed to revoke sessions' });
  }
});

// Shared by both "forgot password" and "accept invite" flows — both are the
// same action from the user's perspective: follow an emailed link, set a password.
router.post('/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ message: 'email is required' });
  }
  const user = await User.findOne({ email });
  // Always respond 202 regardless of whether the account exists, to avoid
  // leaking which emails have accounts.
  if (user && user.status !== 'deleted') {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = crypto.createHash('sha256').update(token).digest('hex');
    user.passwordResetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save();
    const link = `${WEB_ORIGIN}/auth/forgot-password?token=${token}`;
    await sendPasswordSetEmail({ to: email, link, displayName: user.displayName, mode: 'reset' });
    await recordAuthEvent('password_reset_requested', { uid: user.uid, email });
  }
  return res.status(202).json({ ok: true });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) {
    return res.status(400).json({ message: 'token and password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' });
  }
  const hashedToken = crypto.createHash('sha256').update(String(token)).digest('hex');
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetTokenExpiresAt: { $gt: new Date() },
  }).select('+passwordResetToken +passwordResetTokenExpiresAt');
  if (!user) {
    return res.status(400).json({ message: 'This link is invalid or has expired' });
  }
  user.passwordHash = await bcrypt.hash(String(password), 12);
  user.passwordResetToken = undefined;
  user.passwordResetTokenExpiresAt = undefined;
  user.sessionVersion = (user.sessionVersion || 0) + 1; // invalidate any existing sessions
  if (user.status === 'invited') user.status = 'active';
  await user.save();
  await recordAuthEvent('password_reset_completed', { uid: user.uid, email: user.email });
  return res.json({ ok: true });
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
