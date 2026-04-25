# Inmate Enrichment — Progress, Tasks, and Recovery Playbook

This living document captures the system architecture, what’s done, what’s pending, and how to recover quickly if something breaks (UI or API). It’s intended as the single source of truth during development and incident response.

## Overview

- Purpose: Build a production-grade enrichment service and dashboard with strict match semantics, related-party enrichment, service-owned provider keys, and cost controls.
- UI semantics:
  - Score display: show `0%` when a provider scored zero; show `—` when unscored/unknown.
  - High-quality threshold: default `75%` (configurable).
- Keys and access:
  - Provider API keys are server-side only and never exposed to the dashboard.
  - Dashboard calls the service proxy endpoints exclusively.

## Architecture

- Backend (service)
  - Node.js + Express, OpenAPI docs at `/api/openapi.json` and Swagger UI at `/api/docs`.
  - MongoDB (Mongoose) for subjects/enrichment state; Redis + BullMQ for job queueing.
  - Raw provider payloads stored with TTL for audit/inspection.
  - Port: configurable; default `4000`.
- Worker
  - BullMQ consumer for enrichment jobs and scheduled sweeps.
- Frontend (dashboard)
  - React + Vite (proxy-based hooks), Enrichment tab with sub-views: Menu, Details, and Full results.
  - Match semantics and highlighting use the HIGH_QUALITY_MATCH threshold.

## Environments and Ports

- Default service base: `http://localhost:4000`
- Docker compose publishes `api` as `4000:4000` (see `docker-compose.yml`).
- MongoDB replicaset `rs0` runs in compose; Redis exposed on `6379`.

## Key Configuration (server)

From `shared/src/config.ts` and env:

- Core
  - `PORT` (default `4000`)
  - `MONGO_URI`, `MONGO_DB` (default `inmatesdb`)
  - `REDIS_URL` (default `redis://localhost:6379`)
  - `SUBJECTS_COLLECTION` (default `inmates`)
- Providers
  - `PIPL_API_KEY`, `PROVIDER_PIPL_ENABLED`
  - `PDL_API_KEY`, `PROVIDER_PDL_ENABLED`
  - `WHITEPAGES_API_KEY`, `PROVIDER_WHITEPAGES_ENABLED`
  - `OPENAI_API_KEY`, `PROVIDER_OPENAI_ENABLED`
- Budgets/Rate limits
  - `PDL_MAX_PER_HOUR|DAY`, `PIPL_MAX_PER_HOUR|DAY`, `WP_MAX_PER_HOUR|DAY`
  - `PDL_UNIT_COST_USD`, `PIPL_UNIT_COST_USD`, `WP_UNIT_COST_USD`
- Behavior toggles
  - `RAW_PAYLOAD_TTL_HOURS` (default 72)
  - `AUTO_ENRICH_ENABLED`, `AUTO_ENRICH_SWEEP_CRON`
  - `BOND_THRESHOLD` (default 1000)
  - `PARTY_PULL_PREFER_STATEWIDE` (defaults to false)
  - `HIGH_QUALITY_MATCH` (defaults to `0.75` in server acceptance logic)
  - `PARTY_PULL_COOLDOWN_MINUTES` (default `30`)

## Core API Endpoints (selected)

- Health and docs
  - `GET /health` — service up
  - `GET /api/openapi.json`, `GET /api/docs` — API documentation
- Provider registry and tests
  - `GET /api/enrichment/providers` — list enabled providers/capabilities/actions
  - `GET /api/providers/pipl/test` — connectivity (no secrets); similar for `pdl`, `whitepages`
- Subject enrichment
  - `POST /api/enrichment/pipl_first_pull` — best match, facts, relationships (optionally `aggressive`)
  - `POST /api/enrichment/pdl_first_pull` — best match, facts, relationships (disabled if no key)
  - `GET /api/enrichment/subject_summary?subjectId=SPN` — compact subject + provider previews + related parties
  - `GET /api/providers/pipl/raw?subjectId=SPN` — raw payload for subject
  - `GET /api/enrichment/pipl_matches?subjectId=SPN` — normalized match rows (for UI tables)
- Related-party enrichment
  - `POST /api/enrichment/related_party_pull` — enrich parties (city/state or statewide; cooldown enforced)
  - `GET /api/enrichment/related_parties?subjectId=SPN` — list related parties
  - `GET /api/enrichment/related_party_audits?subjectId=SPN` — audits summary/rows
  - `POST /api/enrichment/related_party_validate_phones` — validate party phones via Whitepages
- Operational metrics
  - `GET /api/enrichment/coverage72h`, `GET /api/enrichment/coverage24h?minBond=1000`
  - `GET /api/enrichment/prospects_window?windowHours=&minBond=&limit=`
  - `GET /api/enrichment/queue_stats`
  - `GET /api/enrichment/provider_stats`, `GET /api/enrichment/provider_unresolved_breakdown`

## UI Semantics and Views (dashboard)

Files of interest:

- `src/pages/CaseDetail.jsx` — Enrichment tab with Menu, Details, Full results
- `src/config/enrichment.ts` — reads `VITE_HIGH_QUALITY_MATCH` (default 0.75)

Implemented:

- Name fallback: `getCandidateName` pulls from multiple fields to avoid false "Unknown".
- Score normalization: `getCandidateScore` maps mixed source scores to 0–1; `formatScoreDisplay` prints `0%` vs `—`.
- High-quality highlighting: rows with score ≥ threshold get emphasized; success window shows counts and best candidate.
- Views: Details (last run, requester, cache, selected IDs, inputs) and Full (sorted, chips: all/high-quality/with phone).
- URL sync: `?tab=enrichment&view=details|full` deep links; clearing view returns to menu.

Pending niceties:

- Full results expanders (per-row) with DOB/age, gender, emails, relations, metadata, and optional raw snippet.
- Interactive filters that alter the list and persist in URL.
- Additional badges/polish; optional "aggressive" path for first pull when exposed.

## Current Status — Task List

Done:

- Provider proxy wired; keys are server-owned; dashboard calls proxy only.
- Score semantics enforced across views (0% vs —), threshold highlighted (default 75%).
- Related-party enrichment endpoints and cooldown logic implemented server-side.
- Details and Full results views restored; success window and attached-records display reintroduced.
- Name fallback fixed to avoid "Unknown" when other name fields exist.

Pending (to complete):

1. Full results expanders with richer fields and raw-preview snippet.
2. Quick filters (All / High-quality / With phone) that mutate the list and persist in URL.
3. UX polish (badges, small affordances), and optional "aggressive" mode toggle when supported by proxy.
4. Verify attach flows end-to-end and add small tests (happy path + edge).

## Recent Regression Note

- A consolidation refactor of the Enrichment tab previously broke functionality; it was reverted to a stable single-section and then carefully re-expanded. Details and Full results are now back, with robust name/score handling. The remaining work is focused on Full results depth and filters.

## Recovery Playbook

When something breaks (UI or API), follow this order:

1) Fast health checks

- Service up: `GET http://localhost:4000/health` should return 200.
- Docs reachable: `GET http://localhost:4000/api/openapi.json` (JSON) and `GET http://localhost:4000/api/docs` (UI).
- Providers list: `GET http://localhost:4000/api/enrichment/providers` — confirm enabled providers.

2) Provider connectivity (no secrets)

- `GET /api/providers/pipl/test` → ok/disabled; likewise `whitepages`, `pdl`.
- If disabled unexpectedly, check `.env` for keys and toggles (see Configuration section) and restart.

3) Dashboard sanity

- Enrichment tab shows Details/Full buttons; run a manual lookup; counts and success window should appear if high-quality matches exist.
- Name fields should not read "Unknown"; Match column should show `0%` vs `—` correctly.

4) Rebuild/restart

- Rebuild shared + API (monorepo):
  - `npm run -w shared build`
  - `npm run -w api build`
- If using Docker compose (recommended):
  - `docker compose up -d --build api worker` (or use project’s `docker-compose.dev.yml` for dashboard)

5) Logs & storage

- API logs (Express + morgan) will show route access and errors.
- Mongo/Redis containers running? Check compose status.
- Raw payloads are stored in `raw_provider_payloads` with TTL; fetch latest subject raw via:
  - `GET /api/providers/pipl/raw?subjectId=SPN`

6) Cooldowns & caching

- Related-party cooldown: default 30 minutes. Targeted pulls may be skipped if within cooldown; the API returns `cooldownActive` details.
- Raw payload cache TTL: default 72 hours — only affects storage retention, not provider responses.

7) Endpoint spot checks (optional)

- Prospects window:
  - `GET /api/enrichment/prospects_window?windowHours=48&minBond=500&limit=10`
- Coverage (72h/24h):
  - `GET /api/enrichment/coverage72h`
  - `GET /api/enrichment/coverage24h?minBond=1000`
- Queue stats and provider stats:
  - `GET /api/enrichment/queue_stats`
  - `GET /api/enrichment/provider_stats`

## Acceptance Criteria — UI Contract

- Strict score display semantics: `0%` vs `—` everywhere.
- High-quality threshold (default 75%) drives highlighting and the success window wording.
- Keys never leave the server; dashboard only uses proxy endpoints.
- Deep links: `?tab=enrichment&view=details|full` work; back button returns to Menu.
- Sorting by score desc; dedupe and cooldown behavior enforced by server.

## Appendix — File Pointers

- Service:
  - `api/src/index.ts` — Express setup, routes mounted at `/api`, swagger
  - `api/src/server.ts` — all enrichment routes and provider interactions
  - `shared/src/config.ts` — environment configuration and defaults
- Dashboard:
  - `src/pages/CaseDetail.jsx` — Enrichment UI (Menu, Details, Full)
  - `src/config/enrichment.ts` — HIGH_QUALITY_MATCH exported from Vite env

---

Maintainers: update this document whenever routes, thresholds, or flows change. Keep the Pending list fresh and move items to Done as they land.
