# Bail Bonds Dashboard Boot Audit

Date: 2026-04-24
Goal: simulate startup from the codebase and determine whether the project can actually boot successfully

## Verdict

The codebase can boot locally in its two-terminal dev mode, but its Docker Compose dev path is not reliable as written.

Practical verdict:

- local manual dev boot is plausible if dependencies are installed and Mongo is configured
- the root Compose dev command is likely broken because it does not select an application profile
- result: manual local boot likely works, default Compose boot likely does not

## 1. What Command Starts The System?

Primary local development boot:

1. `npm run server:dev`
2. `npm run dev`

Source:

- root `package.json`
  - `"server:dev": "npm --prefix server run dev"`
  - `"dev": "vite"`

Documented Quick Start also uses two terminals:

1. `cd server && npm run dev`
2. `npm run dev`

Alternate containerized boot commands:

- `npm run compose:dev:up`
- `npm run compose:staging:up`

## 2. What Runs First?

### Local two-terminal dev boot

Step-by-step:

1. Backend starts first with `server/src/index.js`
2. `server/src/config/loadEnv.js` loads env from:
   - repo root `.env`
   - `server/.env`
3. Express app initializes routes, middleware, Swagger, and auth/proxy endpoints
4. If `MONGO_URI` exists, `server/src/db.js` connects to Mongo
5. If Mongo connects, the server initializes indexes and queue workers
6. If `REDIS_URL` exists, `server/src/jobs/index.js` starts BullMQ workers
7. Frontend starts separately through Vite from the repo root
8. Browser calls `/api` through the Vite proxy during local dev

### Compose dev boot

Step-by-step:

1. Root script runs `docker compose -f docker-compose.dev.yml up --build`
2. Compose evaluates service profiles
3. Infrastructure services without profiles start:
   - `mongo`
   - `redis`
4. App services require either `hotreload` or `static` profile
5. If no profile is selected, API and web services likely do not start at all

## 3. What Dependencies Are Required At Runtime?

Frontend runtime:

- Node/npm for Vite dev
- root frontend dependencies
- Firebase public config for auth-related UI flows

Backend runtime:

- Node >= 18.17
- server dependencies
- MongoDB for full API behavior
- Redis for queue workers and queue-backed background jobs

Feature/runtime dependencies:

- `MONGO_URI`
- `MONGO_DB`
- `PORT`
- `WEB_ORIGIN`
- `REDIS_URL`
- `ENRICHMENT_API_URL` for enrichment proxy behavior
- Firebase admin credentials for server-side auth/admin features
- SMTP/Twilio/Stripe env only for those feature areas

Compose-specific runtime files:

- `./.secrets/asap-bail-books-firebase-adminsdk-fbsvc-71506047b4.json`
- `./public/env.js` for the static web service mount path

## 4. Where Would It Likely Fail?

### Failure point 1

File:

- root `package.json`

Reason:

- `compose:dev:up` runs `docker compose -f docker-compose.dev.yml up --build`
- `docker-compose.dev.yml` puts all app services behind profiles (`hotreload` or `static`)
- no profile is selected by the root script

Likely outcome:

- Compose starts only Mongo/Redis infrastructure and not the API/web app

Suggested fix:

1. Change the script to include a profile, for example:
   - `docker compose -f docker-compose.dev.yml --profile hotreload up --build`
2. Or remove profiles if the repo wants a single default dev path

### Failure point 2

File:

- `docker-compose.dev.yml`

Reason:

- the Compose file declares a required secret file:
  - `./.secrets/asap-bail-books-firebase-adminsdk-fbsvc-71506047b4.json`
- if that file is missing locally, Compose app-service startup fails

Likely outcome:

- API containers fail to start in Compose

Suggested fix:

1. Make the secret optional in local dev
2. Or document a stub local-secret requirement and provide a safer default path

### Failure point 3

File:

- `docker-compose.dev.yml`

Reason:

- static web service mounts `./public/env.js` into nginx
- if that file does not exist, static profile startup can fail or behave inconsistently depending on host setup

Likely outcome:

- static web container fails during startup or runs without expected runtime env

Suggested fix:

1. Make the mount optional
2. Or commit a safe default `public/env.js` generated from the example

### Failure point 4

File:

- `server/src/index.js`

Reason:

- if `MONGO_URI` is absent, the server still starts but without DB connection
- many real API routes then return degraded or failing behavior

Likely outcome:

- process boots, but the useful system does not fully work

Suggested fix:

1. Treat `MONGO_URI` as required for normal dev boot and fail fast when the repo expects a real backend
2. Or clearly document that this is a degraded boot mode

## Bootability Summary

- Primary local boot: `npm run server:dev` plus `npm run dev`
- What runs first: backend env load, Express initialization, optional Mongo connection, optional queue startup, then Vite dev server
- Runtime dependencies: Node, Mongo, Redis for queues, Firebase secret for Compose-based server boot, frontend env config
- Most likely boot failure: root Compose dev script does not select any app-service profile

## Bottom Line

This project can likely boot in manual local dev mode, but its default containerized dev command is not reliable as written.

The cleanest fix is to make `compose:dev:up` explicitly choose the `hotreload` profile and to soften the local secret/runtime-file assumptions.