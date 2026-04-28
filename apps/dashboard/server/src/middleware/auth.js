import { firebaseAuth } from '../lib/firebaseAdmin.js';
import User from '../models/User.js';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || '__asap_session';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 14);
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return null;
}

async function verifyFirebaseSession(req) {
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!sessionCookie) return null;
  try {
    return await firebaseAuth.verifySessionCookie(sessionCookie, true);
  } catch (err) {
    console.warn('⚠️  Failed to verify Firebase session cookie:', err.message);
    return null;
  }
}

async function verifyIdToken(idToken) {
  try {
    return await firebaseAuth.verifyIdToken(idToken, true);
  } catch (err) {
    console.warn('⚠️  Failed to verify Firebase ID token:', err.message);
    return null;
  }
}

function serializeUser(userDoc, decoded) {
  if (!userDoc) return null;
  return {
    uid: userDoc.uid,
    email: userDoc.email || decoded?.email || null,
    roles: userDoc.roles || [],
    departments: userDoc.departments || [],
    counties: userDoc.counties || [],
    status: userDoc.status,
    mfaEnforced: userDoc.mfaEnforced,
    lastLoginAt: userDoc.lastLoginAt,
  };
}

async function upsertUserProfile(decoded) {
  if (!decoded?.uid) return null;
  const existing = await User.findOne({ uid: decoded.uid }).lean();
  const updates = {
    email: decoded.email?.toLowerCase() || undefined,
    emailVerified: decoded.email_verified || false,
    lastLoginAt: new Date(),
    displayName: decoded.name || undefined,
  };
  // Promote invited users to active on successful login; new profiles default to active.
  if (!existing) {
    updates.status = 'active';
  } else if (existing.status === 'invited') {
    updates.status = 'active';
  }
  const options = { new: true, upsert: true, setDefaultsOnInsert: true };
  return User.findOneAndUpdate({ uid: decoded.uid }, { $set: updates }, options).lean();
}

export async function requireAuth(req, res, next) {
  // DEV_BYPASS_AUTH — inject a synthetic admin user for integration testing.
  // MUST NOT be set in production (NODE_ENV=production blocks it entirely).
  if (
    String(process.env.DEV_BYPASS_AUTH || '').toLowerCase() === 'true' &&
    String(process.env.NODE_ENV || '').toLowerCase() !== 'production'
  ) {
    req.user = {
      uid: 'dev-bypass-admin',
      email: 'dev-bypass@localhost',
      roles: ['Admin'],
      departments: [],
      counties: [],
      status: 'active',
      mfaEnforced: false,
    };
    req.firebase = { decoded: { uid: 'dev-bypass-admin' } };
    return next();
  }

  console.log('[AUTH] ============ requireAuth middleware called ==============');
  try {
    console.log('[AUTH] attempting verifyFirebaseSession');
    let decoded = await verifyFirebaseSession(req);
    console.log('[AUTH] verifyFirebaseSession result:', !!decoded);
    if (!decoded) {
      const bearer = extractBearerToken(req);
      console.log('[AUTH] no session cookie, bearer token present:', !!bearer);
      if (!bearer) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      console.log('[AUTH] attempting verifyIdToken');
      decoded = await verifyIdToken(bearer);
      console.log('[AUTH] verifyIdToken result:', !!decoded);
      if (!decoded) {
        return res.status(401).json({ message: 'Invalid token' });
      }
    }

    console.log('[AUTH] attempting upsertUserProfile');
    const profile = await upsertUserProfile(decoded);
    console.log('[AUTH] upsertUserProfile result:', !!profile);
    if (!profile) {
      return res.status(403).json({ message: 'Access denied' });
    }

    req.user = serializeUser(profile, decoded);
    req.firebase = { decoded };
    console.log('[AUTH] auth success, calling next()');
    return next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ message: 'Authentication error' });
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    let decoded = await verifyFirebaseSession(req);
    if (!decoded) {
      const bearer = extractBearerToken(req);
      if (bearer) {
        decoded = await verifyIdToken(bearer);
      }
    }
    if (decoded) {
      const profile = await upsertUserProfile(decoded);
      req.user = serializeUser(profile, decoded);
      req.firebase = { decoded };
    }
  } catch (err) {
    console.warn('optionalAuth error:', err.message);
  }
  next();
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  });
}

export async function setSessionCookie(res, idToken) {
  const expiresIn = SESSION_MAX_AGE_MS;
  const sessionCookie = await firebaseAuth.createSessionCookie(idToken, { expiresIn });
  res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
    maxAge: expiresIn,
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  });
}

export { SESSION_COOKIE_NAME };
