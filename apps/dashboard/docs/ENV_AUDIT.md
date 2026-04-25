# Bail Bonds Dashboard Environment Variable Audit

Date: 2026-04-24
Scope: root `.env.example`, `server/.env.example`, `public/env.example.js`, frontend runtime/build env access, backend env access, compose/docs references, and smoke-test scripts

## Summary

- Template files exist for frontend, server, and runtime browser injection
- Core env coverage is decent, but many operational knobs and alias names are not represented in the examples
- One real code-level hardcoded secret-like value was found in the frontend MFA enrollment component

## Master ENV Variable Table

### Frontend and browser runtime variables

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `VITE_API_URL` | `src/lib/api.js`, docs, `public/env.example.js`, root `.env.example` | Usually yes | Yes | Main frontend API base |
| `VITE_PROXY_API_TARGET` | compose/docs | Optional in compose dev | No | Compose/proxy-only variable |
| `VITE_FIREBASE_API_KEY` | `src/lib/firebaseClient.ts`, auth docs, smoke scripts, `public/env.example.js`, root `.env.example` | Yes for auth-enabled UI | Yes | Required frontend Firebase setting |
| `VITE_FIREBASE_AUTH_DOMAIN` | `src/lib/firebaseClient.ts`, docs, `public/env.example.js`, root `.env.example` | Yes for auth-enabled UI | Yes | Required frontend Firebase setting |
| `VITE_FIREBASE_PROJECT_ID` | `src/lib/firebaseClient.ts`, docs, `public/env.example.js`, root `.env.example` | Yes for auth-enabled UI | Yes | Required frontend Firebase setting |
| `VITE_FIREBASE_APP_ID` | `src/lib/firebaseClient.ts`, docs, `public/env.example.js`, root `.env.example` | Yes for auth-enabled UI | Yes | Required frontend Firebase setting |
| `VITE_FIREBASE_MEASUREMENT_ID` | `src/lib/firebaseClient.ts`, `public/env.example.js`, root `.env.example` | Optional | Yes | Analytics-related |
| `VITE_ENABLE_AUTH_PREVIEW` | `src/App.jsx`, root `.env.example` | Optional | Yes | UI preview toggle |
| `VITE_STRIPE_PUBLISHABLE_KEY` | root `.env.example` | Required for Stripe UI | Yes | Build-time publishable key |
| `DEV_ERROR_OVERLAY` | `index.html`, README, `public/env.example.js` | Optional | Yes | Runtime browser debug toggle |

### Server core, DB, and routing variables

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `MONGO_URI` | `server/src/index.js`, scripts, docs, `server/.env.example`, root `.env.example` | Yes | Yes | Preferred DB URI |
| `MONGODB_URI` | `server/src/index.js`, validation scripts | Optional alias | No | Alias for `MONGO_URI` |
| `MONGO_URL` | `server/src/index.js`, scripts | Optional alias | No | Alias for `MONGO_URI` |
| `ATLAS_URI` | `server/src/index.js`, validation scripts | Optional alias | No | Alias for `MONGO_URI` |
| `DATABASE_URL` | `server/src/index.js` | Optional alias | No | Alias for `MONGO_URI` |
| `MONGO_DB` | `server/src/index.js`, scripts, `server/.env.example`, root `.env.example` | Yes | Yes | Preferred DB name |
| `MONGODB_DB` | `server/src/index.js`, validation scripts | Optional alias | No | Alias for `MONGO_DB` |
| `MONGO_DB_NAME` | diagnostics script | Optional alias | No | Alias for `MONGO_DB` |
| `PORT` | `server/src/index.js`, `server/.env.example` | Yes | Yes | Server port |
| `NODE_ENV` | `server/src/index.js`, auth middleware, models | Optional but important | No | Affects defaults/behavior |
| `WEB_ORIGIN` | `server/src/index.js`, Twilio/mailer fallback, docs, templates | Usually yes | Yes | CORS/UI origin |
| `API_ORIGIN` | `server/src/lib/messaging/twilio.js` | Optional | No | Twilio callback origin fallback |
| `ENRICHMENT_API_URL` | proxy routes, reports route, docs, `server/.env.example` | Optional if enrichment proxy disabled | Yes | External enrichment base |
| `ENRICHMENT_OPENAPI_URL` | `server/src/index.js` | Optional | No | Override for proxied OpenAPI |
| `ENRICHMENT_PROXY_TIMEOUT_MS` | proxy route, `server/.env.example` | Optional | Yes | Proxy timeout |
| `REPORTS_ENRICHMENT_TIMEOUT_MS` | `server/src/routes/reports.js` | Optional | No | Reports-specific timeout |

### Auth, session, and Firebase Admin variables

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `SESSION_SECRET` | `server/.env.example` | Likely required for session flow | Yes | Template present |
| `SESSION_COOKIE_NAME` | `server/src/middleware/auth.js` | Optional | No | Defaults to `__asap_session` |
| `SESSION_MAX_AGE_MS` | auth middleware/routes | Optional | No | Session lifetime |
| `FIREBASE_PROJECT_ID` | Firebase Admin, docs, template | Required if backend auth enabled | Yes | Admin SDK config |
| `GOOGLE_APPLICATION_CREDENTIALS` | Firebase Admin, docs, template | Required if backend auth enabled | Yes | Path to service account JSON |
| `FIREBASE_WEB_API_KEY` | smoke scripts | Optional | No | Smoke-test convenience alias |

### Integrations, queues, and operational tuning

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `REDIS_URL` | queue factory, queue index, redis lib, template | Required if queue workers enabled | Yes | BullMQ connection |
| `DISABLE_QUEUE_WORKERS` | `server/src/jobs/index.js` | Optional | No | Worker kill switch |
| `QUEUE_HEARTBEAT_MS` | template | Optional | Yes | Queue tuning |
| `MESSAGING_QUEUE_CONCURRENCY` | messaging jobs, template | Optional | Yes | Queue tuning |
| `CHECKINS_QUEUE_CONCURRENCY` | checkins job | Optional | No | Queue tuning |
| `CHECKINS_GPS_INTERVAL_MINUTES` | checkins services/template | Optional | Yes | Auto ping interval |
| `CHECKIN_OFFICER_ROLES` | checkins route | Optional | No | Role allowlist |
| `CHECKIN_CLIENT_OPTION_LIMIT` | checkins route | Optional | No | UI/API cap |
| `LOG_SAMPLE_RATE` | `server/src/index.js` | Optional | No | Request log sampling |
| `DISABLE_TIME_BUCKET_V2` | `server/src/index.js` | Optional | No | Feature flag |
| `DASHBOARD_TZ` | dashboard route, docs, template | Optional | Yes | Time window timezone |
| `DASH_CACHE_MS` | dashboard route | Optional | No | Dashboard cache TTL |
| `MAX_DB_MS` | dashboard/cases routes | Optional | No | Shared DB timeout |
| `DASH_MAX_DB_MS` | dashboard route | Optional | No | Dashboard DB timeout |
| `CASES_MAX_DB_MS` | cases route | Optional | No | Cases DB timeout |
| `CASES_CACHE_MS` | cases route | Optional | No | Cases cache TTL |
| `DIAG_COLLECTIONS` | diagnostics script | Optional | No | Script-only collection list |
| `AVAILABLE_COUNTIES` | metadata route | Optional | No | Metadata configuration |
| `AVAILABLE_DEPARTMENTS` | metadata route | Optional | No | Metadata configuration |

### Provider and messaging variables

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `WHITEPAGES_API_KEY` | provider lib, template | Required if Whitepages enabled | Yes | Provider key |
| `WHITEPAGES_TIMEOUT_MS` | provider lib | Optional | Commented in template | Tuning |
| `WHITEPAGES_CACHE_TTL_MINUTES` | provider lib | Optional | Commented in template | Tuning |
| `WHITEPAGES_ERROR_CACHE_TTL_MINUTES` | provider lib | Optional | Commented in template | Tuning |
| `WHITEPAGES_TTL_MINUTES` | provider lib alias | Optional | No | Legacy/alias naming |
| `PIPL_API_KEY` | provider lib, template | Required if Pipl enabled | Yes | Provider key |
| `PIPL_TIMEOUT_MS` | provider lib | Optional | Commented in template | Tuning |
| `PIPL_CACHE_TTL_MINUTES` | provider lib | Optional | Commented in template | Tuning |
| `PIPL_ERROR_CACHE_TTL_MINUTES` | provider lib | Optional | Commented in template | Tuning |
| `ENRICHMENT_PROVIDERS` | provider registry, template | Optional | Yes | Comma-separated provider list |
| `ENRICHMENT_PROVIDER` | provider registry alias | Optional | No | Singular alias |
| `ENRICHMENT_CACHE_TTL_MINUTES` | cases route, template | Optional | Yes | Enrichment cache TTL |
| `ENRICHMENT_ERROR_CACHE_TTL_MINUTES` | cases route, template | Optional | Yes | Enrichment error TTL |
| `TWILIO_ACCOUNT_SID` | Twilio lib, template | Required if messaging enabled | Yes | Messaging credential |
| `TWILIO_AUTH_TOKEN` | Twilio lib, template | Required if messaging enabled | Yes | Messaging credential |
| `TWILIO_MESSAGING_SERVICE_SID` | Twilio lib, template | Required if messaging enabled | Yes | Messaging credential |
| `TWILIO_STATUS_CALLBACK_URL` | Twilio lib, template comment | Optional | Yes | Override |
| `TWILIO_WEBHOOK_AUTH_TOKEN` | Twilio lib, template comment | Optional | Yes | Override |
| `SMTP_HOST` | mailer/template | Optional | Yes | Invite mail |
| `SMTP_PORT` | mailer/template | Optional | Yes | Invite mail |
| `SMTP_SECURE` | mailer/template | Optional | Yes | Invite mail |
| `SMTP_USER` | mailer/template | Optional | Yes | Invite mail |
| `SMTP_PASS` | mailer/template | Optional | Yes | Invite mail |
| `EMAIL_FROM` | mailer/template | Optional | Yes | Preferred from-address |
| `SMTP_FROM` | mailer alias | Optional | No | Alias for `EMAIL_FROM` |
| `APP_NAME` | mailer/template | Optional | Yes | Branding |
| `STRIPE_SECRET_KEY` | Stripe server lib, docs, template | Required if payments enabled | Yes | Server secret |
| `STRIPE_WEBHOOK_SECRET` | payments route/template | Required for webhook verification | Yes | Server secret |

### Smoke-test and script variables

| Variable | Seen in | Likely required? | In template? | Notes |
|---|---|---:|---:|---|
| `API_BASE` | smoke scripts, validation scripts | Optional | No | Script-only base URL |
| `BASE_URL` | smoke dashboard script | Optional | No | Script-only dashboard URL |
| `AUTH_BEARER` | smoke dashboard script | Optional | No | Script auth token |
| `AUTH_COOKIE` | smoke dashboard script | Optional | No | Script session cookie |
| `AUTH_SIGNIN` | smoke dashboard script | Optional | No | Script auth toggle |
| `AUTH_EMAIL` | smoke dashboard script | Optional | No | Script login email |
| `AUTH_PASSWORD` | smoke dashboard script | Optional | No | Script login password |

## Required Variables

Clearly required for the main backend:

- `MONGO_URI`
- `MONGO_DB`
- `PORT`

Required when the corresponding feature is used:

- Firebase admin: `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS`
- frontend auth UI: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`
- payments: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `VITE_STRIPE_PUBLISHABLE_KEY`
- messaging: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`
- enrichment proxy/providers: `ENRICHMENT_API_URL`, provider keys as needed
- queues: `REDIS_URL` unless workers are disabled

## Missing From `.env.example` Files

Common omissions from root/server examples:

- `NODE_ENV`
- `LOG_SAMPLE_RATE`
- `SESSION_COOKIE_NAME`
- `SESSION_MAX_AGE_MS`
- `API_ORIGIN`
- Mongo aliases: `MONGODB_URI`, `MONGO_URL`, `ATLAS_URI`, `DATABASE_URL`, `MONGODB_DB`, `MONGO_DB_NAME`
- `ENRICHMENT_OPENAPI_URL`
- `REPORTS_ENRICHMENT_TIMEOUT_MS`
- `DISABLE_QUEUE_WORKERS`
- `CHECKINS_QUEUE_CONCURRENCY`
- `CHECKIN_OFFICER_ROLES`
- `CHECKIN_CLIENT_OPTION_LIMIT`
- `DISABLE_TIME_BUCKET_V2`
- `DASH_CACHE_MS`, `MAX_DB_MS`, `DASH_MAX_DB_MS`, `CASES_MAX_DB_MS`, `CASES_CACHE_MS`
- `AVAILABLE_COUNTIES`, `AVAILABLE_DEPARTMENTS`
- script-only variables such as `API_BASE`, `BASE_URL`, `AUTH_*`, `DIAG_COLLECTIONS`, `FIREBASE_WEB_API_KEY`

Missing from root/browser-facing templates:

- `VITE_PROXY_API_TARGET`

## Inconsistent Naming

- `MONGO_URI`, `MONGODB_URI`, `MONGO_URL`, `ATLAS_URI`, `DATABASE_URL`
- `MONGO_DB`, `MONGODB_DB`, `MONGO_DB_NAME`
- `ENRICHMENT_PROVIDERS` vs `ENRICHMENT_PROVIDER`
- `EMAIL_FROM` vs `SMTP_FROM`
- `API_BASE`, `BASE_URL`, `VITE_API_URL`, `ENRICHMENT_API_URL` represent different but easily confusable endpoint concepts

## Optional vs Required

Clearly optional:

- cache, timeout, queue-concurrency, log-sampling, and metadata-list variables
- `DEV_ERROR_OVERLAY`
- `CHECKINS_GPS_INTERVAL_MINUTES`
- `AVAILABLE_COUNTIES` and `AVAILABLE_DEPARTMENTS`
- smoke-test `AUTH_*` and `API_BASE` values

Clearly required for core features:

- DB connection variables
- Firebase frontend/backend variables when auth is enabled
- Stripe variables when payments are enabled
- Twilio variables when messaging is enabled

## Hardcoded Secrets Or Values

Real code-level issue:

- `src/components/auth/MFAEnrollment.tsx` contains a hardcoded MFA secret: `JBSWY3DPEHPK3PXP`

Other hardcoded values worth reviewing:

- localhost fallback URLs in API, proxy, smoke scripts, and UI runtime helpers
- default session cookie name `__asap_session`
- real user email references in docs/scripts such as `ryan@vintaragroup.com`
- docs with example secret-like placeholders such as `sk_test_xxx` and `AIzaSy...` examples

## Issues And Risks

1. The hardcoded MFA secret is the most serious finding. Even if this UI is only demonstrative, it normalizes shipping a shared secret in client code.
2. Environment templates do not cover many operational variables, so deploy behavior can differ from what operators expect.
3. Multiple alias names for the same Mongo and enrichment concepts increase misconfiguration risk.
4. The repo uses three env channels for the frontend: build-time `import.meta.env`, runtime `window.__ENV__`, and compose-only proxy vars. That is powerful but easy to misconfigure.

## Recommendation

1. Remove the hardcoded MFA secret and source MFA enrollment material dynamically from the backend or a mock-only dev fixture.
2. Expand `.env.example` and `server/.env.example` to include the real operational knobs or at least an “advanced optional vars” section.
3. Standardize Mongo and enrichment naming so one preferred variable exists for each concept.
4. Keep `public/env.example.js` synchronized with any runtime-only browser env keys.