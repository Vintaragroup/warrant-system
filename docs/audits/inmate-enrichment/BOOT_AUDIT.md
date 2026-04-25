# Inmate Enrichment Boot Audit

Date: 2026-04-24
Goal: simulate startup from the codebase and determine whether the project can actually boot successfully

## Verdict

The codebase can likely boot its containers, but the documented primary startup command is not reliable as written.

Practical verdict:

- Docker services likely build and start if environment values are present
- the documented `npm run stack:up` path is likely to fail during readiness checks
- result: partial boot is likely, clean successful boot from the primary command is not

## 1. What Command Starts The System?

Primary documented startup command:

- `npm run stack:up`

Source:

- `package.json` → `"stack:up": "node tools/ensure_stack.js"`

Alternate startup command:

- `npm run stack:rebuild`

This calls the same helper with `--rebuild`.

## 2. What Runs First?

Step-by-step boot simulation:

1. Root script starts `tools/ensure_stack.js`
2. `tools/ensure_stack.js` checks whether Docker is available
3. It runs `docker compose up -d mongo mongo-setup redis`
4. If `--rebuild` is present, it rebuilds `api` and `worker`
5. It runs `docker compose up -d api worker`
6. Docker builds and starts:
   - `api` from `api/Dockerfile`
   - `worker` from `worker/Dockerfile`
   - `mongo`, `mongo-setup`, `redis` from images/inline commands
7. API container runs `node api/dist/index.js`
8. Worker container runs `node worker/dist/index.js`
9. API boot sequence:
   - `api/src/index.ts` calls `connectMongo()`
   - creates Express app
   - mounts `/api` routes
   - exposes `/health`
10. Worker boot sequence:
   - `worker/src/index.ts` calls `connectMongo()`
   - connects to Redis
   - starts BullMQ worker and queue events
11. Finally, `tools/ensure_stack.js` waits for:
   - Redis on `127.0.0.1:6379`
   - API health on `127.0.0.1:4000/health`

## 3. What Dependencies Are Required At Runtime?

Infrastructure:

- Docker Desktop / Docker daemon
- MongoDB
- Mongo replica-set initialization via `mongo-setup`
- Redis

Application runtime:

- Node 20 in the API and worker containers
- npm workspace install/build success

Environment/config required for meaningful boot:

- `MONGO_URI`
- `MONGO_DB`
- `PORT`
- `SUBJECTS_COLLECTION`
- `REDIS_URL` is supplied by Compose for containers

Optional but feature-dependent:

- `PDL_API_KEY`
- `WHITEPAGES_API_KEY`
- `OPENAI_API_KEY`
- `PIPL_API_KEY`
- `HCSO_*`
- `AUTO_ENRICH_*`

## 4. Where Would It Likely Fail?

### Failure point 1

File:

- `tools/ensure_stack.js`

Reason:

- waits for Redis on `127.0.0.1:6379`
- `docker-compose.yml` does not publish Redis to the host at all
- Redis is internal-only in Compose

Likely outcome:

- `npm run stack:up` exits with timeout even if Redis is healthy inside Docker

Suggested fix:

1. Change the readiness check to test Redis inside the Compose network, for example with `docker compose exec redis redis-cli ping`
2. Or publish Redis to the host if host-based readiness is intentional

### Failure point 2

File:

- `docker-compose.yml`

Reason:

- API publishes `4000:4000`, but the actual listen port comes from `PORT`
- if `PORT` is changed away from `4000`, the container can start on the wrong internal port relative to the published mapping

Likely outcome:

- API container runs but host port access fails

Suggested fix:

1. Hard-pin `PORT=4000` in Compose
2. Or parameterize the published port mapping to follow `PORT`

### Failure point 3

File:

- `api/src/index.ts`

Reason:

- API calls `connectMongo()` before starting Express
- if Mongo or replica-set initialization is not ready, API process exits before listening

Likely outcome:

- API never becomes healthy
- worker may also fail similarly because it also calls `connectMongo()` during startup

Suggested fix:

1. Add retry/backoff around Mongo connection on startup
2. Or use stronger Compose health/dependency coordination for Mongo readiness

## Bootability Summary

- Primary command: `npm run stack:up`
- What runs first: Docker bootstrap helper, then Mongo/Redis, then API/worker
- Runtime dependencies: Docker, Mongo replica-set, Redis, Node workspace build success, env configuration
- Most likely boot failure: Redis readiness check in `tools/ensure_stack.js`

## Bottom Line

This project is close to bootable, but the documented primary startup command is likely to fail because the readiness check does not match the Compose networking model.

If `tools/ensure_stack.js` is fixed, the stack is much more likely to boot successfully.