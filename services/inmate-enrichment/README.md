# Inmate Enrichment Module

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/Vintaragroup/inmate_enrichment?quickstart=1)

Production-ready enrichment pipeline for inmate records with manual and automatic triggers.

## Stack

- API: Express + TypeScript
- Queue: BullMQ (Redis)
- Worker: Node + TypeScript
- DB: MongoDB Atlas (or local via Docker)
- Frontend: minimal React (Vite)

## Architecture

```
 [Dashboard] --POST /api/enrichment/run--> [API] --enqueue--> [Redis/BullMQ] --consume--> [Worker]
                                                ^                                     |
                                                |                                     v
                                         Change Streams <---- MongoDB ----> Enrichment results
                                                ^
                                                |
                                         Scheduled Sweep (cron)
```

## Setup

1. Copy .env.sample to .env (Docker Compose uses .env.sample by default)

2. Start services (single command)

If your machine slept or Docker restarted, use this one-liner to bring everything back and wait for health:

```
npm run stack:up
```

If you changed server code or dependencies and want a fresh container build:

```
npm run stack:rebuild
```

API will listen on http://localhost:4000

### Quick recovery when the API stops responding

If the API was healthy and suddenly stops responding (e.g., after laptop sleep or a Docker Desktop hiccup):

1. Restart Docker Desktop (Troubleshoot → Restart). If the CLI says "Cannot connect to the Docker daemon", fully Quit Docker Desktop and relaunch.
2. Bring the stack back and wait for health:

```
npm run stack:up
```

3. If you need to fully reset containers:

```
npm run stack:down && npm run stack:up
```

Helpful commands:

```
# Show compose status
npm run stack:status

# Tail recent API/worker logs
npm run stack:logs

# Restart API/worker only
npm run stack:restart

# Verify health and connectivity
curl -s http://localhost:4000/health | jq
curl -s http://localhost:4000/api/providers/whitepages/test | jq
```

Common pitfall: REDIS_URL

- When running INSIDE Docker, the containers use `redis://redis:6379` (set by docker-compose.yml). Your `.env` can still have `redis://127.0.0.1:6379` for local runs; compose will override it for containers.
- When running the API LOCALLY (outside Docker), ensure a local Redis is listening on port 6379 (e.g., `brew services start redis`) or point `REDIS_URL` at the Docker-published port `127.0.0.1:6379`.

## Documentation

- API Endpoint Map: `docs/API_Endpoint_Map.md` — authoritative list of routes with sample requests
- Related Parties API: `docs/Related_Parties_API.md` — endpoints, contracts, and score/cooldown semantics
- Dashboard ↔ Enrichment Proxy Wiring: `docs/Dashboard_Proxy_Wiring.md` — production proxy on Render.com, Vite dev proxy, env vars, and code samples
- Dashboard Enrichment UI Contract: `docs/Dashboard_Enrichment_UI_Contract.md` — score/name semantics, views, deep-linking, and QA checklist
- Enrichment Progress & Recovery: `docs/Enrichment_Progress_and_Recovery.md` — what’s done, pending, and how to recover after regressions
- Incident Runbook: `docs/Incident_Runbook.md` — quick checks, provider tests, cooldown/cache notes, and rollback steps
- Full Results Expanders & Filters (UI): `docs/Full_Results_Expanders_and_Filters.md` — spec + reference React snippets to implement per-row expanders and interactive filters
- Wiring check (case 02865254): `docs/SPN_02865254_Wiring_Check.md` — step-by-step validation that UI shows HQ and low-quality results from the enrichment service
- Case UI Refinement Plan: `docs/Case_UI_Refinement_Plan.md` — per-tab polish tasks, acceptance criteria, and QA before production
- Production Prep Checklist: `docs/Production_Prep_Checklist.md` — env alignment, proxy allowlist, smoke tests, and UI validation
- Workspace Guide: `docs/Workspace_Guide.md` — open the multi-root workspace and run API + Dashboard tasks

Multi-root workspace (optional, recommended): open `Enrichment_Dashboard.code-workspace` to load this repo alongside the Bail Bonds Dashboard for seamless development.

Live docs from the server:

- OpenAPI JSON: http://localhost:4000/api/openapi.json
- Swagger UI: http://localhost:4000/api/docs

### Dashboard

After the stack is up, open the inline dashboard:

- Local: http://localhost:4000/api/dashboard
- In Codespaces: use the forwarded Port 4000, then append /api/dashboard

You can add a convenience script to open it automatically:

```
npm set-script open:dashboard "node -e \"require('open')('http://localhost:4000/api/dashboard')\""
npm run open:dashboard
```

### Smoke test

After the stack is up, run a quick smoke test:

```
npm run smoke
```

This checks /health and calls /api/enrichment/related_party_pull with a tiny payload.

### Match score semantics

- Providers (Pipl/PDL) return a match score in [0,1]. The API normalizes and clamps all related-party match values to numbers, or null when not present.
- UI convention: - Any finite number (including 0) is rendered as a percent (e.g., 0 → 0%, 0.78 → 78%). - Em dash “—” is used only when the party has not been scored yet (null).
- Practical meaning: - 0%: a pull ran, but no acceptable match was found for that party. - —: no pull or score recorded for that party yet.

### High-quality threshold configuration

Two environment variables control the default threshold for classifying "high-quality" related matches (expressed on a 0–1 scale):

- API (server): `HIGH_QUALITY_MATCH` — default `0.75` when unset. Used as the default `matchMin` for: - `POST /api/enrichment/related_party_pull` - `POST /api/enrichment/related_party_sweep`
  You can still override per-request by passing `matchMin` in the body.

- Dashboard (UI): `VITE_HIGH_QUALITY_MATCH` — default `0.75` when unset. Used client-side to separate "high-quality" vs "other" related parties in the Case Details views.

To keep behavior consistent, set both to the same value per environment (e.g., staging at 0.8, production at 0.75). When not set, both default to 0.75.

See also `docs/Dashboard_Proxy_Wiring.md` for production proxy setup and dev proxy configuration.

### Prevent repeated related-party enrichment (cooldown)

To avoid wasting provider tokens, the API enforces a short cooldown window for targeted related-party enrichments. When a party was just enriched in a targeted call, subsequent targeted attempts within the cooldown are skipped server-side.

- API (server): `PARTY_PULL_COOLDOWN_MINUTES` — default `30` when unset. - Applies to `POST /api/enrichment/related_party_pull`. - If the last audit for the targeted party was created within this window and marked as `targeted: true`, the endpoint returns a benign response without calling the provider, e.g.: - `{ ok:true, cooldownActive:true, skipped:1, cooldownMinutes:30, lastTargetedAt:"2025-10-21T16:04:00.000Z", nextEligibleAt:"2025-10-21T16:34:00.000Z" }` - The response always includes `cooldownMinutes`. When a cooldown skip occurs, it also includes `lastTargetedAt` and `nextEligibleAt` to help the UI show an ETA.

Client-facing summary fields:

- `GET /api/enrichment/subject_summary` → for each `relatedParties[]` entry the API now includes: - `lastTargetedAt` — timestamp of the most recent targeted enrich for this party - `cooldownEndsAt` — computed as `lastTargetedAt + PARTY_PULL_COOLDOWN_MINUTES`
- `GET /api/enrichment/related_parties` → mirrors the same two fields on each row.
- `GET /api/enrichment/related_party_audits` → `summary.lastTargetedAt` surfaces the latest targeted audit among returned rows.

The Dashboard UI also respects this cooldown by disabling the Enrich button and surfacing a “View results” action for parties with a recent targeted run.

### Targeted related-party enrichment and per-party history

You can enrich a single related party (instead of cycling through multiple) by passing a stable `partyId` or the exact `partyName` to the related-party pull endpoint. This is useful when the Dashboard offers an “Enrich this party” action for a specific person.

- Endpoint: `POST /api/enrichment/related_party_pull`
- Body: - `subjectId` (required) - `partyId` (optional) — preferred; a stable identifier returned by the API in related-parties lists - `partyName` (optional) — exact case-insensitive name match fallback when `partyId` is not known - `maxParties` (default 3), `requireUnique` (default true), `matchMin` (default `HIGH_QUALITY_MATCH` env)
- Behavior: when `partyId` or `partyName` is provided, the API restricts the candidate pool to that party and marks the audit entries as `targeted: true`.

To view the enrichment audit history (accepts/rejects, match scores, personsCount, query locality) for a subject or a single party, use:

- Endpoint: `GET /api/enrichment/related_party_audits?subjectId=...&partyId=...&limit=50`
- Returns a flattened list of audit rows with a small summary (total, accepted, rejected, acceptance rate).

## GitHub Codespaces

This repo includes a dev container for Codespaces in `.devcontainer/devcontainer.json`.

One‑click launch:

[Open in GitHub Codespaces](https://codespaces.new/Vintaragroup/inmate_enrichment?quickstart=1)

What it does:

- Uses Node 20 image
- Enables Docker-in-Docker to run `docker compose`
- Forwards port 4000 (API)
- Runs `npm run stack:up` after create/start to bring the stack online
- You can run `npm run smoke` to verify the API from inside the Codespace

Before you start a Codespace, set these repository or Codespace secrets (as needed):

- MONGO_URI (or rely on the local Docker mongo)
- MONGO_DB (default inmatesdb)
- SUBJECTS_COLLECTION (default inmates)
- PIPL_API_KEY (optional, for provider)
- WHITEPAGES_API_KEY (optional)
- PROVIDER_PIPL_ENABLED=true (optional)
- RAW_PAYLOAD_TTL_HOURS=72 (optional)

In a Codespace terminal:

- Bring up/recover the stack: `npm run stack:up`
- Rebuild containers and start: `npm run stack:rebuild`

## Seed demo data

Use Mongo shell or Compass to insert into `inmates` collection (db name from env, default `inmatesdb`).

Example:

```
use inmatesdb
db.inmates.insertOne({ spn: "A12345", first_name: "John", last_name: "Doe", city: "Houston", state: "TX", county: "Harris", scraped_at: new Date(), enrichment_flag: true, enrichment_status: "NEW" })
```

## Manual enrichment

POST to run:

```
curl -X POST http://localhost:4000/api/enrichment/run \
  -H 'Content-Type: application/json' \
  -d '{"subjectIds":["A12345"],"mode":"standard"}'
```

Poll status:

```
curl "http://localhost:4000/api/enrichment/status?jobId=<JOB_ID>"
```

## Provider enumeration for the Dashboard (Option B)

The API exposes a first-class provider listing so the Dashboard UI can source providers directly from the enrichment service (no Dashboard-side registry required):

- Endpoint: `GET /api/enrichment/providers`
- Docs: `http://localhost:4000/api/docs` → search for "List enrichment-owned providers"

See `docs/OPTION_B_UI_PROVIDER_WIRING.md` for:

- Dashboard proxy snippet (pass-through route)
- UI hook change to fetch providers from enrichment
- Auto-apply behavior when selecting Pipl (fills missing CRM fields and appends relations)

## Auto-enrich

Set `AUTO_ENRICH_ENABLED=true` in env and restart API to enable MongoDB change streams and scheduled sweeps.

When a new inmate is inserted within 72h that matches rules, a job is enqueued and processed.

## Testing

Add Node dev dependencies and run tests (optional):

```
npm i -D jest ts-jest @types/jest
npx ts-jest config:init
npm test
```
