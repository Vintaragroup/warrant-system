import session from 'express-session';
import connectRedis from 'connect-redis';
import { getRedisConnection } from './redis.js';

const RedisStore = connectRedis(session);

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || '__asap_session';
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 14);

if (!process.env.SESSION_SECRET && isProduction) {
  throw new Error('SESSION_SECRET must be set in production');
}

export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-session-secret',
  store: new RedisStore({ client: getRedisConnection(), prefix: 'sess:' }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  },
});

export { SESSION_COOKIE_NAME };
