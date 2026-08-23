import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

const WEB_ORIGIN = (process.env.WEB_ORIGIN || 'http://localhost:5173').split(',')[0].trim();
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_OAUTH_CALLBACK_URL
  || `${(process.env.API_PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '')}/api/auth/google/callback`;

passport.use(new LocalStrategy(
  { usernameField: 'email', passwordField: 'password' },
  async (email, password, done) => {
    try {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
      if (!user || !user.passwordHash) {
        return done(null, false, { message: 'Invalid email or password' });
      }
      if (user.status !== 'active' && user.status !== 'pending_mfa') {
        return done(null, false, { message: 'Account is not active' });
      }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        return done(null, false, { message: 'Invalid email or password' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        let user = await User.findOne({ googleId: profile.id });
        if (!user && email) {
          // Link an existing invited/active account created by an admin before first Google sign-in.
          user = await User.findOne({ email });
        }
        if (!user) {
          return done(null, false, { message: 'No account found for this Google account. Ask an administrator for an invite.' });
        }
        if (user.status !== 'active' && user.status !== 'invited') {
          return done(null, false, { message: 'Account is not active' });
        }
        if (!user.googleId) user.googleId = profile.id;
        if (!user.email && email) user.email = email;
        user.emailVerified = true;
        if (user.status === 'invited') user.status = 'active';
        user.displayName = user.displayName || profile.displayName || '';
        user.lastLoginAt = new Date();
        await user.save();
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
} else {
  console.warn('⚠️  GOOGLE_OAUTH_CLIENT_ID/SECRET not set — Google sign-in is disabled');
}

passport.serializeUser((user, done) => {
  done(null, { id: user._id.toString(), sessionVersion: user.sessionVersion || 0 });
});

passport.deserializeUser(async (payload, done) => {
  try {
    const user = await User.findById(payload.id);
    if (!user) return done(null, false);
    if ((user.sessionVersion || 0) !== (payload.sessionVersion || 0)) {
      // Sessions minted before the last revoke/role-change are rejected.
      return done(null, false);
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
});

export { WEB_ORIGIN };
export default passport;
