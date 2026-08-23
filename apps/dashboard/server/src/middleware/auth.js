function serializeUser(userDoc) {
  if (!userDoc) return null;
  return {
    uid: userDoc.uid,
    email: userDoc.email || null,
    displayName: userDoc.displayName || '',
    roles: userDoc.roles || [],
    departments: userDoc.departments || [],
    counties: userDoc.counties || [],
    status: userDoc.status,
    mfaEnforced: userDoc.mfaEnforced,
    lastLoginAt: userDoc.lastLoginAt,
  };
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
    return next();
  }

  if (!req.isAuthenticated?.() || !req.user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  req.user = serializeUser(req.user);
  return next();
}

export async function optionalAuth(req, _res, next) {
  if (req.isAuthenticated?.() && req.user) {
    req.user = serializeUser(req.user);
  }
  next();
}

export { serializeUser };
