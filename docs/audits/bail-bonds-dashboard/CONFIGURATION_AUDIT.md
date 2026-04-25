# Bail Bonds Dashboard Configuration Audit

Date: 2026-04-24
Scope: frontend build/runtime config, backend env loading, Compose, runtime browser injection, docs, and hardcoded operational constants

## Primary Conclusion

Configuration in this repo is fragmented.

- There is no single configuration owner.
- Frontend config is split across root `.env`, `public/env.js`, Vite runtime/build env, and code defaults.
- Backend config is split across `server/.env`, repo-root `.env`, Compose, and direct defaults in many server files.

This is the most fragmented of the two Node repos.

## Configuration Sources

### Backend env loader

- `server/src/config/loadEnv.js`
  - loads two files in order: repo-root `.env`, then `server/.env`
  - this is the closest thing to a backend config entrypoint

### Backend runtime config consumers

- `server/src/index.js`
- `server/src/middleware/auth.js`
- `server/src/routes/*.js`
- `server/src/lib/*.js`
- `server/src/jobs/*.js`

These files read env directly and each owns part of the runtime behavior.

### Frontend build-time env

- `.env.example`
  - defines Vite-facing `VITE_*` variables
  - also includes some backend-related values like `MONGO_URI`, `MONGO_DB`, and `WEB_ORIGIN`

### Frontend runtime env injection

- `public/env.example.js`
- `public/env.js`
- `src/lib/api.js`
- `src/lib/firebaseClient.ts`

The frontend prefers runtime `window.__ENV__` when present, otherwise build-time `import.meta.env`.

### Container and deploy config

- `docker-compose.dev.yml`
- `docker-compose.staging.yml`
- `docker-compose.override.yml`
- `render.yaml`
- `vite.config.js`

These files also act as configuration owners because they set defaults, mounts, targets, and secret paths.

### Documentation as secondary config guidance

- `README.md`
- `server/README.md`
- `docs/DATA_FLOW.md`
- `docs/deployment-containerization.md`
- other auth and deployment docs

These documents contain real operational config instructions and example values, so they function as part of the config system.

### Hardcoded constants in code

- `server/src/index.js`
- `server/src/routes/cases.js`
- `server/src/routes/dashboard.js`
- `server/src/routes/reports.js`
- `server/src/routes/enrichmentProxy.js`
- `server/src/middleware/auth.js`
- `server/src/services/checkinsQueueService.js`
- `src/lib/api.js`
- `src/components/auth/MFAEnrollment.tsx`

## Where Configuration Is Duplicated

### Frontend API base resolution is duplicated across channels

Same concept appears in multiple places:

- root `.env.example` via `VITE_API_URL`
- `public/env.example.js` via `window.__ENV__.VITE_API_URL`
- `src/lib/api.js` resolution logic
- docs that instruct Compose/runtime overrides

### Firebase frontend config is duplicated across build-time and runtime

Same values appear in:

- root `.env.example`
- `public/env.example.js`
- `src/lib/firebaseClient.ts`
- docs

### Backend database naming is duplicated with aliases

The backend accepts:

- `MONGO_URI`
- `MONGODB_URI`
- `MONGO_URL`
- `ATLAS_URI`
- `DATABASE_URL`

And DB name aliases:

- `MONGO_DB`
- `MONGODB_DB`
- `MONGO_DB_NAME`

That is compatibility-friendly but fragmented.

### Enrichment provider config is duplicated across template, code, and docs

- `server/.env.example`
- `server/src/lib/enrichment/providers/*.js`
- `server/src/lib/enrichment/registry.js`
- docs

### Compose duplicates server defaults

`docker-compose.dev.yml` and staging docs re-state:

- `PORT`
- `NODE_ENV`
- `WEB_ORIGIN`
- `REDIS_URL`
- `ENRICHMENT_API_URL`
- SMTP settings
- `APP_NAME`
- Firebase secret path

## Hardcoded Values That Should Be Configurable

### High-priority

- `src/components/auth/MFAEnrollment.tsx`
  - hardcoded MFA secret `JBSWY3DPEHPK3PXP`
  - this should never be a static client-side constant in real behavior

### Medium-priority operational defaults

- `server/src/index.js`
  - fallback enrichment OpenAPI URL `http://localhost:4000/api/openapi.json`
  - request log sampling defaults
  - default DB name `warrantdb`

- `server/src/routes/reports.js`
  - default enrichment timeout `8000`

- `server/src/routes/enrichmentProxy.js`
  - default target `http://localhost:4000`
  - default timeout `10000`

- `server/src/routes/dashboard.js` and `server/src/routes/cases.js`
  - cache TTL and DB timeout defaults

- `server/src/middleware/auth.js`
  - default session cookie name `__asap_session`
  - default session max age

- `server/src/routes/checkins.js`
  - hardcoded default officer roles
  - hardcoded option limits

- `server/src/services/checkinsQueueService.js`
  - default GPS interval `5`

- `src/lib/api.js`
  - frontend fallback `/api`

Most of these are reasonable defaults, but together they show that policy is scattered in code instead of owned by a single config module.

## Inconsistencies Across Files

### Multiple env systems for the frontend

The frontend uses:

- `import.meta.env`
- `window.__ENV__`
- Compose-only variables like `VITE_PROXY_API_TARGET`

That is flexible, but it is not centralized.

### Backend env precedence is not obvious from the templates alone

- `server/src/config/loadEnv.js` loads root `.env` first, then `server/.env`
- operators reading only one template file may not realize which file wins

### Variable alias sprawl

- many names exist for one Mongo connection concept
- both `ENRICHMENT_PROVIDERS` and `ENRICHMENT_PROVIDER` are accepted
- both `EMAIL_FROM` and `SMTP_FROM` are accepted

### Root `.env.example` mixes frontend and backend concepts

It includes:

- frontend `VITE_*` keys
- backend `MONGO_URI`, `MONGO_DB`, `WEB_ORIGIN`

That makes the root template a mixed-scope config file.

### Docs and runtime sources overlap heavily

Deployment docs, compose files, and runtime source all define overlapping defaults for API origins, Firebase, and secret paths.

## Overall Assessment

This repo is fragmented.

- There is no single config module for the whole app.
- Backend config has one loader, but not one owner.
- Frontend config is split between build-time and runtime systems.
- Docs and Compose materially participate in configuration.

## Recommendation

1. Introduce a single backend config module that reads env once and exports typed settings.
2. Separate frontend and backend templates cleanly so the root `.env.example` does not mix scopes.
3. Standardize on one Mongo URI name and one DB name variable.
4. Remove the hardcoded MFA secret immediately.
5. Keep runtime `window.__ENV__` only if it is truly needed; otherwise prefer one frontend config path.