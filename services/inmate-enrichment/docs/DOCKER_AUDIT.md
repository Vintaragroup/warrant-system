# Inmate Enrichment Docker And Deployment Audit

Date: 2026-04-24
Scope: `api/Dockerfile`, `worker/Dockerfile`, `docker-compose.yml`, startup helper scripts, and runtime entrypoint files

## 1. What Service(s) Are Being Built?

Services built from source:

- `api`
  - built from [api/Dockerfile](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/api/Dockerfile)
- `worker`
  - built from [worker/Dockerfile](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/worker/Dockerfile)

Services pulled as images only:

- `mongo`
  - `mongo:6`
- `redis`
  - `redis:7`
- `mongo-setup`
  - `mongo:6`

No web container is built. The React/Vite web app exists in the repo but is only optionally served statically by the API if `web/dist` exists.

## 2. What Is The Container Actually Running?

### API container

- Docker CMD: `node api/dist/index.js`
- Actual application entrypoint: [api/src/index.ts](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/api/src/index.ts)
- Behavior:
  - connects to Mongo
  - mounts Express routes under `/api`
  - serves Swagger/OpenAPI
  - optionally serves built web assets from `web/dist`
  - exposes `/health`

### Worker container

- Docker CMD: `node worker/dist/index.js`
- Actual application entrypoint: [worker/src/index.ts](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/worker/src/index.ts)
- Behavior:
  - connects to Mongo and Redis
  - starts BullMQ worker and queue events
  - runs enrichment jobs

### Mongo setup container

- Entry command initializes Mongo replica set using `mongosh`
- This is required because the API uses Mongo change streams

## 3. Are There Mismatches Between Code Entry Point And Docker CMD?

### Main container entrypoints

No major mismatch:

- `api/Dockerfile` points to the built output of `api/src/index.ts`
- `worker/Dockerfile` points to the built output of `worker/src/index.ts`

### Compose/runtime mismatch

There is one operational mismatch in the stack helper:

- [tools/ensure_stack.js](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/tools/ensure_stack.js) waits for Redis on `127.0.0.1:6379`
- [docker-compose.yml](/Users/ryanmorrow/Documents/Projects2025/Data_General/Inmate_enrichment/docker-compose.yml) does not publish Redis to the host at all

That means the health helper is waiting on a host port that the Compose file never exposes. This can make `npm run stack:up` fail even when the internal Docker stack is fine.

### Port binding mismatch risk

- Compose publishes `4000:4000`
- the API listens on `config.port`, which comes from `PORT`

If `PORT` is changed away from `4000`, Compose will still expose host `4000` to container `4000`, and the deployment will break unless Compose is updated too.

## 4. Any Inefficiencies Or Broken Steps?

### Broken or fragile steps

1. `tools/ensure_stack.js` assumes Redis is reachable on host `127.0.0.1:6379`, but Compose keeps Redis internal-only.
2. API static web serving depends on `web/dist`, but no Docker stage builds `web/`, so the API container will not serve the embedded dashboard unless that build artifact is produced elsewhere.

### Inefficiencies

1. Both Dockerfiles use `COPY . .` before dependency install/build.
   - this destroys layer caching on almost any source change
2. No `.dockerignore` file was found in the repo.
   - full repo context, docs, tests, uploads, and other non-runtime files are sent into the Docker build context
3. Both images install dependencies and build from the full monorepo in a single stage.
   - this is simple, but larger and slower than a multi-stage build with cached dependency layers

## Missing Dependencies In Docker

No obvious missing runtime package dependency was found for the current API and worker images.

The bigger issue is missing build hygiene rather than missing npm modules.

## Anything That Would Break Deployment?

Yes.

### Confirmed breakage risk

1. `npm run stack:up`
   - likely fails or hangs on Redis readiness because Redis is not published to the host

### High-probability breakage risk

2. If `PORT` changes from `4000`
   - Compose port mapping becomes wrong

3. If users expect the API container to serve the repo’s web UI
   - the API image does not build `web/dist`, so the static serve path will usually be empty

## Corrected Docker Strategy

Recommended direction:

1. Keep separate `api` and `worker` images.
2. Stop using host-based Redis health checks in `tools/ensure_stack.js`.
   - check container health or use `docker compose exec redis redis-cli ping`
3. Add a root `.dockerignore`.
4. Restructure both Dockerfiles to cache dependency installation before copying the full source tree.
5. If the dashboard is intended to be served from this repo in Docker, add a dedicated `web` service or a build step that produces `web/dist` before the API image is finalized.

Minimal corrected strategy:

- `api` image
  - copy lockfiles/package manifests first
  - install deps
  - copy source
  - build `shared` and `api`
  - run `node api/dist/index.js`
- `worker` image
  - same pattern
  - build `shared` and `worker`
  - run `node worker/dist/index.js`
- `docker-compose.yml`
  - either publish Redis if the stack helper needs host checks, or fix the helper to use container-local checks

## Bottom Line

- Container entrypoints match the code.
- The main deployment defect is the broken Redis host-health assumption in `tools/ensure_stack.js`.
- The main Docker weaknesses are no `.dockerignore`, poor layer caching, and no explicit web-container strategy.