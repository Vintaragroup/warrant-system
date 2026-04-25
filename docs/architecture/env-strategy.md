# Environment Variable Strategy

**Date:** 2026-04-24
**Status:** Decided
**Affects:** All three services; `infra/docker/docker-compose.yml`; root `.env.example`

---

## Problem Statement

Three independent services each evolved their own environment variable naming conventions. In a monorepo with a shared root `.env`, the following problems arise:

1. **`MONGO_DB=warrantdb` in all three templates** — on a shared cluster, all three services would write to the same database
2. **`PORT` means different things per service** — a single `PORT=` value in root `.env` applies to all three, breaking two of them
3. **`REDIS_URL` is shared** — if one value is set, the enrichment worker and dashboard worker both connect to the same Redis, risking BullMQ queue collisions
4. **4 Mongo URI aliases in dashboard** (`MONGODB_URI`, `MONGO_URL`, `ATLAS_URI`, `DATABASE_URL`) — none documented; any of these silently override `MONGO_URI`
5. **`ENRICHMENT_PROXY_SECRET` exists in docs but nowhere in code or templates** — the dashboard proxy to the enrichment API is unauthenticated

---

## Decision 1 — Prefixed Env Var Naming for Shared Root `.env`

Variables that differ per service must use a **service prefix** in the root `.env.example`. Each service's compose env block translates the prefixed var to the unprefixed var the service expects.

Prefixes:

- `IE_` — inmate-enrichment
- `DASHBOARD_` — bail-bonds-dashboard
- `PIPELINE_` — warrantdb-pipeline

The consolidated compose (`infra/docker/docker-compose.yml`) already follows this pattern for inmate-enrichment variables. This decision extends the pattern to the dashboard and pipeline.

### Required root `.env.example` structure

```dotenv
# ─── Shared cluster ───────────────────────────────────────────────────────────
# One Mongo URI serves all three services; each uses a different database name.
MONGO_URI=mongodb://localhost:27017

# ─── inmate-enrichment ────────────────────────────────────────────────────────
IE_MONGO_DB=inmate_enrichment
IE_SUBJECTS_COLLECTION=subjects
IE_REDIS_URL=redis://localhost:6379
IE_PDL_API_KEY=
IE_PIPL_API_KEY=
IE_WHITEPAGES_API_KEY=
IE_OPENAI_API_KEY=
IE_BOND_THRESHOLD=
IE_ENRICHMENT_WINDOW_HOURS=
IE_AUTO_ENRICH_ENABLED=false
IE_HCSO_SCRAPE_ENABLED=false
IE_HCSO_SCRAPE_MODE=http
ENRICHMENT_PROXY_SECRET=

# ─── bail-bonds-dashboard ─────────────────────────────────────────────────────
DASHBOARD_MONGO_DB=warrantdb
DASHBOARD_REDIS_URL=redis://localhost:6381
DASHBOARD_WEB_ORIGIN=http://localhost:5173
DASHBOARD_ENRICHMENT_API_URL=http://localhost:4000
VITE_API_URL=http://localhost:8080
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
FIREBASE_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
STRIPE_SECRET_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
SESSION_SECRET=

# ─── warrantdb-pipeline ───────────────────────────────────────────────────────
PIPELINE_MONGO_DB=warrantdb_pipeline
IMAP_HOST=
IMAP_PORT=993
IMAP_USERNAME=
IMAP_PASSWORD=
HARRIS_EMAIL_ROSTER_DIR=
```

### Rule: `PORT` must never appear in root `.env`

`PORT` is injected by each service's compose `environment` block. It is a platform-provided variable on Render. It must not appear in a shared `.env` file. Each service receives its correct port value from compose only.

---

## Decision 2 — Dashboard Mongo URI Aliases Must Be Documented

The dashboard's `server/src/index.js` checks four aliases for the Mongo URI:

```
MONGODB_URI → MONGO_URL → ATLAS_URI → DATABASE_URL → MONGO_URI
```

None of these are in the `server/.env.example`. This means a developer can accidentally set `ATLAS_URI` in a shared `.env` and override the dashboard's Mongo connection without realizing it.

**Decision:** Add all four aliases as comments in `apps/dashboard/server/.env.example` with a note that `MONGO_URI` is the canonical value and the others are legacy aliases. Do not remove the aliases from code — they exist for Atlas compatibility.

```dotenv
# Mongo connection — use MONGO_URI. The following are legacy aliases accepted by the server:
# MONGODB_URI, MONGO_URL, ATLAS_URI, DATABASE_URL
MONGO_URI=
```

### Affected file

- `apps/dashboard/server/.env.example`

---

## Decision 3 — `ENRICHMENT_PROXY_SECRET` Authentication

### Mechanism

A shared secret header (`x-enrichment-secret`) is used between the dashboard proxy and the enrichment API.

- The dashboard server sends the header on every proxy request to the enrichment API
- The enrichment API validates the header on every non-health endpoint
- Both sides read `ENRICHMENT_PROXY_SECRET` from their respective environment
- If `ENRICHMENT_PROXY_SECRET` is not set (local dev without the var), the enrichment API does not register the middleware — it runs unauthenticated. This is acceptable for local development.

### When it is required

The secret **must** be set before either service is deployed to a public-facing Render URL. Without it, anyone who discovers the enrichment API URL can trigger enrichment jobs, consuming paid provider API credits.

In local dev using the consolidated Docker Compose, the enrichment API is internal-only (no host port exposure). The secret is optional but recommended.

### Implementation locations

**Enrichment API (`services/inmate-enrichment/api/src/server.ts`)**

Add before all route mounts:

```typescript
const proxySecret = process.env.ENRICHMENT_PROXY_SECRET;
if (proxySecret) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (req.headers["x-enrichment-secret"] !== proxySecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });
}
```

**Dashboard proxy route (`apps/dashboard/server/src/routes/enrichmentProxy.js`)**

Add to the proxy request handler:

```javascript
const secret = process.env.ENRICHMENT_PROXY_SECRET;
if (secret) {
  proxyReq.setHeader("x-enrichment-secret", secret);
}
```

### Affected files

| File                                                  | Change                                |
| ----------------------------------------------------- | ------------------------------------- |
| `services/inmate-enrichment/api/src/server.ts`        | Add conditional secret middleware     |
| `apps/dashboard/server/src/routes/enrichmentProxy.js` | Add outgoing header on proxy requests |
| `services/inmate-enrichment/.env.sample`              | Add `ENRICHMENT_PROXY_SECRET=`        |
| `apps/dashboard/server/.env.example`                  | Add `ENRICHMENT_PROXY_SECRET=`        |
| Root `.env.example`                                   | Already included above                |

---

## Decision 4 — Fix Broken Pipeline Render Start Command

### The bug

`render.yaml` in the pipeline uses `uvicorn api.app:app` as the web service start command. The actual application module is `api/main.py` (Python module path: `api.main`). There is no `api/app.py`. Every Render deployment of the pipeline API fails at startup with a module-not-found error.

The monorepo's `infra/render/pipeline.render.yaml` copied the same broken command.

### Fix

Change the `startCommand` in both files:

```yaml
# Before:
startCommand: uvicorn api.app:app --host 0.0.0.0 --port $PORT

# After:
startCommand: uvicorn api.main:app --host 0.0.0.0 --port $PORT
```

### Affected files

| File                                      | Change                         |
| ----------------------------------------- | ------------------------------ |
| `services/warrantdb-pipeline/render.yaml` | `api.app:app` → `api.main:app` |
| `infra/render/pipeline.render.yaml`       | `api.app:app` → `api.main:app` |

Both files must be updated together. If only one is changed, the monorepo copy and the source diverge, which creates confusion about which one Render reads.

---

## Decision 5 — BullMQ Queue Namespace (Deferred)

Both the enrichment service and dashboard use BullMQ. If a shared Redis URL is ever used, BullMQ queue names must be prefixed to prevent cross-service worker pickup.

**Current status:** Deferred. The consolidated compose uses separate Redis instances per service. Queue collisions are not possible in the current default deployment.

**When to implement:** Before any configuration where `REDIS_URL` for both services resolves to the same Redis instance. Queue prefixes: `ie:` for enrichment, `dashboard:` for the dashboard.

---

## Implementation Order

1. Create root `.env.example` with prefixed variable structure
2. Update `apps/dashboard/server/.env.example` with Mongo alias documentation
3. Fix `render.yaml` start command in both pipeline files (zero-risk, implement immediately)
4. Implement `ENRICHMENT_PROXY_SECRET` middleware — before any external Render deployment
5. Validate root `.env.example` covers all required variables by cross-referencing `packages/shared-config/README.md`

---

## Risks If Deferred

| Risk                                                                                                         | Severity                                                         |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `ENRICHMENT_PROXY_SECRET` not set before Render deploy — enrichment API accepts unauthenticated job requests | High — direct financial risk via unbounded provider API calls    |
| Root `.env.example` absent — developers set `PORT` globally, breaking two services                           | Medium                                                           |
| `REDIS_URL` collision — enrichment worker processes dashboard BullMQ jobs                                    | Medium (blocked in Docker; risk appears in non-Docker local dev) |
| Pipeline Render API permanently fails on start                                                               | High — Render API is non-functional until this is fixed          |
| Dashboard Mongo URI aliases undocumented — `ATLAS_URI` silently overrides `MONGO_URI`                        | Low (dev-time confusion, not a production failure)               |
