# Bail-Bonds-Dashboard Entry Point Audit

Date: 2026-04-24
Scope: executable entry points, package scripts, Docker startup paths, queue and scheduling paths, and conflicting or likely-stale execution surfaces in `Bail-Bonds-Dashboard`

## Primary Conclusion

This project does not have a single all-in-one runtime file that boots the full system by itself.

The canonical development startup path documented in `README.md` is:

1. Backend: `cd server && npm run dev`
2. Frontend: `npm run dev`

That means the effective primary execution path is split across two runtime entries:

- Backend primary runtime file: `server/src/index.js`
- Frontend primary runtime file: `src/main.jsx`

If one file must be named as the single most important entry point, it is `server/src/index.js`, because:

- it starts the API server
- it wires authentication, routes, OpenAPI, DB bootstrapping, and Redis-backed workers
- the frontend depends on it for `/api/*`
- both local dev and Docker API paths ultimately land there

## All Identified Entry Points

### Root package scripts

Defined in `package.json`:

- `dev`
- `dev:https`
- `build`
- `lint`
- `preview`
- `server:dev`
- `server:start`
- `server:firebase:create-user`
- `validate:windows`
- `smoke:dashboard`
- `smoke:trends`
- `test`
- `test:watch`
- `compose:dev:up`
- `compose:dev:down`
- `compose:staging:up`
- `compose:staging:down`

### Frontend runtime entry points

- `index.html`
- `src/main.jsx`

The frontend is started primarily by:

- `npm run dev`
- `npm run dev:https`
- `npm run build`
- `npm run preview`

### Backend runtime entry points

- `server/src/index.js`

Backend package scripts from `server/package.json`:

- `dev`
- `start`
- `smoke:health`
- `smoke:dashboard`
- `smoke:trends`
- `test:windows`
- `validate:windows`
- `lint:api`
- `lint:api:bundle`
- `firebase:create-user`

### Root directly executable scripts

Under `scripts/`:

- `scripts/analyze_har.mjs`
- `scripts/sanitize_har.mjs`
- `scripts/eval_windows.py`
- `scripts/atlas_categorical_field_audit.py`
- `scripts/atlas_fieldmap_diff.py`
- `scripts/atlas_simple_audit.py`
- `scripts/atlas_source_audit.py`
- `scripts/seed-county-data.js`
- `scripts/seed-test-data.js`

### Backend directly executable scripts

Under `server/scripts/`:

- `server/scripts/backfill_bonds.js`
- `server/scripts/create-firebase-user.mjs`
- `server/scripts/db_diagnostics.js`
- `server/scripts/list-firebase-users.mjs`
- `server/scripts/sample_warrantdb.py`
- `server/scripts/seed-county-data.js`
- `server/scripts/smoke-dashboard.mjs`
- `server/scripts/smoke-health.mjs`
- `server/scripts/smoke-trends.mjs`
- `server/scripts/test-windows.mjs`
- `server/scripts/validate-firebase-secret.mjs`
- `server/scripts/validate-openapi.js`
- `server/scripts/validate-windows.mjs`
- `server/scripts/verify_backfill_run.js`

### Tests as execution surfaces

- `vitest.config.ts`
- `vitest.setup.ts`
- `server/tests/cases.crm_enrichment.test.js`
- `server/tests/payments.refund.test.js`
- `server/tests/payments.routes.test.js`

### Docker and container entry points

#### Development and staging compose files

- `docker-compose.dev.yml`
- `docker-compose.override.yml`
- `docker-compose.staging.yml`

#### Container commands and runtime entrypoints

- `Dockerfile.web`
  - runtime command: `nginx -g daemon off;`
- `server/Dockerfile`
  - runtime command: `node src/index.js`
- `docker-compose.dev.yml`
  - `api` command: `node src/index.js`
  - `api-dev` command: `npm run dev`
  - `web-dev` command: `npm run dev -- --host --port 5173`
- `docker-compose.staging.yml`
  - `api` builds `server/Dockerfile`
  - `web` builds `Dockerfile.web`

### Workspace task entry points

From `.vscode/tasks.json`:

- `Build web app`
- `Build server`
- `Restart API dev (docker compose)`
- `Run API dev (compose)`

## Schedulers, Queues, and Automatic Execution Paths

### Queue bootstrap inside the API process

- `server/src/index.js`
  - calls `initQueues()` after Mongo initialization

- `server/src/jobs/index.js`
  - starts the messaging worker
  - starts the GPS worker
  - can be disabled via `DISABLE_QUEUE_WORKERS=true`

This means queue workers are not in a separate process by default; they are bootstrapped inside the API server.

### Delayed scheduling for check-ins

- `server/src/services/checkinsQueueService.js`
  - computes GPS schedule windows
  - enqueues delayed `gps-auto` jobs to Redis/BullMQ

- `server/src/jobs/checkins.js`
  - creates the GPS worker that consumes those jobs

### Messaging queue path

- `server/src/services/messaging.js`
  - enqueues outbound message jobs
- `server/src/jobs/messaging.js`
  - worker path for queued message handling

### Cron jobs

No explicit OS cron file or repo-level cron configuration was found in the workspace.

The project does have scheduled/delayed execution, but it is application-managed through Redis/BullMQ, not through a standalone cron file.

## 1. Which Entry Point Is the PRIMARY One?

The canonical development path is the two-process startup described in `README.md`:

1. `cd server && npm run dev`
2. `npm run dev`

If a single primary file must be named, it is `server/src/index.js`.

Why:

- it is the backend API bootstrap
- it initializes DB connectivity and queue workers
- it exposes the routes the frontend actually uses
- Docker API startup and local backend startup both resolve to it

The frontend primary file remains `src/main.jsx`, but it is not sufficient by itself to run the full system.

## 2. Which Ones Are Outdated or Unused?

### Clearly archival or legacy

- `backups/`

The repo’s own docs classify this as archive-only. It contains historical component and server snapshots and should be treated as non-primary execution content.

### Strong likely duplicate/unused script

- `scripts/seed-county-data.js`
- `server/scripts/seed-county-data.js`

These are effectively identical based on file contents. The backend-local version is the more natural active location because the server package is where Mongo-backed runtime scripts already live.

The root copy is the stronger candidate for being stale or redundant.

### Likely unused structural area

- `server/server/`

This nested subtree appears redundant and was not surfaced by package scripts, Docker paths, task definitions, or the main startup docs. Based on the available references, it looks more like retained artifact structure than an active execution surface.

### Duplicate workspace tasks that look stale

- `.vscode/tasks.json` contains repeated `Build web app` entries
- `.vscode/tasks.json` contains repeated `Restart API dev (docker compose)` entries

These are not code entry points, but they are stale execution definitions in workspace tooling.

## 3. Are There Conflicting Execution Paths?

Yes.

### Conflict A: split local dev vs Docker dev

There are two competing primary development paths:

- Local split dev:
  - `cd server && npm run dev`
  - `npm run dev`

- Docker dev:
  - `npm run compose:dev:up`
  - or direct `docker compose -f docker-compose.dev.yml up ...`

These paths can conflict around:

- port usage
- env loading
- Mongo and Redis targets
- whether queue workers run inside local Node or inside containers

### Conflict B: API static profile vs API dev profile

`docker-compose.dev.yml` defines both:

- `api`
  - runs `node src/index.js`
- `api-dev`
  - runs `npm run dev`

Those are parallel execution paths for the same backend service, intended for different profiles, but still operationally conflicting if both are treated as equivalent.

### Conflict C: frontend local Vite vs Compose web-dev vs Compose static web

There are three frontend startup styles:

- local `npm run dev`
- compose `web-dev` with Vite dev server
- compose `web` static build served by Nginx

These are legitimate environments, but they differ in hot reload, proxy behavior, and runtime env loading.

### Conflict D: queue workers embedded in API process

Queue workers are bootstrapped from `server/src/index.js` via `initQueues()` rather than started as a separate worker service.

That means there is an implicit coupling between:

- API startup
- message job processing
- GPS scheduling job processing

This is not necessarily wrong, but it is a mixed execution model that can surprise operators expecting isolated workers.

## Bottom Line

- Primary runtime file: `server/src/index.js`
- Primary frontend file: `src/main.jsx`
- Canonical local dev path: `cd server && npm run dev` plus `npm run dev`
- Primary Docker path: `npm run compose:dev:up`
- No standalone cron file detected
- Automatic scheduling exists through BullMQ queue workers and delayed GPS jobs
- Strongest stale/redundant signals: `backups/`, duplicated `seed-county-data.js`, repeated workspace tasks, and likely-unused `server/server/`

## Recommendation

If this repo is cleaned up later, the highest-value entry-point cleanup targets are:

1. Remove or clearly archive one of the two `seed-county-data.js` copies
2. Deduplicate `.vscode/tasks.json`
3. Decide whether local split dev or Compose dev is the preferred primary path and document it more strictly
4. Confirm whether `server/server/` is still needed