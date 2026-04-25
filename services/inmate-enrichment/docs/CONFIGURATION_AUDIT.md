# Inmate Enrichment Configuration Audit

Date: 2026-04-24
Scope: runtime config modules, environment templates, Docker Compose, tool scripts, and docs that act as configuration guidance

## Primary Conclusion

Configuration in this repo is partially centralized, but not fully.

- The main runtime owner is `shared/src/config.ts`.
- Docker Compose, tool scripts, and docs duplicate parts of that configuration.
- The repo is workable, but configuration is not single-source-of-truth.

## Configuration Sources

### Central runtime config

- `shared/src/config.ts`
  - primary config authority for API and worker runtime
  - owns Mongo, Redis, provider toggles, rate limits, retries, queue settings, HCSO settings, bond threshold, and enrichment behavior

### Environment template

- `.env.sample`
  - main operator-facing template
  - covers core DB, Redis, provider keys, auto-enrichment, HCSO, and some toggles
  - does not cover the full config surface exposed by `shared/src/config.ts`

### Container and orchestration config

- `docker-compose.yml`
  - duplicates a large subset of runtime env names for `api` and `worker`
  - hardcodes internal Redis URL as `redis://redis:6379`
  - hardcodes API port mapping `4000:4000`

### API-local hardcoded config

- `api/src/server.ts`
  - defines `HIGH_QUALITY_MATCH` default locally
  - defines `PARTY_PULL_COOLDOWN_MINUTES` default locally
  - these are not owned by `shared/src/config.ts`

### Tool-script config

- `tools/*.js`
  - many scripts read env directly instead of going through `shared/src/config.ts`
  - examples: `tools/enqueue_micro_batch.js`, `tools/enrich_related_parties_pipl.js`, `tools/upsert_name_relations.js`

### Docs-as-config guidance

- `docs/Production_Prep_Checklist.md`
- `docs/Incident_Runbook.md`
- `docs/Dashboard_Proxy_Wiring.md`
- `docs/OPTION_B_UI_PROVIDER_WIRING.md`
- `docs/Full_Results_Expanders_and_Filters.md`

These are not runtime config files, but they define operational expectations and env names, so they function as secondary config sources.

## Where Configuration Is Duplicated

### Env duplicated between `shared/src/config.ts` and `docker-compose.yml`

Repeated in both places:

- `MONGO_URI`
- `MONGO_DB`
- `SUBJECTS_COLLECTION`
- `REDIS_URL`
- `PORT`
- `ENRICHMENT_WINDOW_HOURS`
- `IDEMPOTENCY_WINDOW_SECONDS`
- provider keys and enable toggles
- `AUTO_ENRICH_ENABLED`
- `AUTO_ENRICH_SWEEP_CRON`
- `RAW_PAYLOAD_TTL_HOURS`
- `QUEUE_CONCURRENCY`
- `BOND_THRESHOLD`
- `HCSO_SCRAPE_ENABLED`
- `HCSO_BASE_URL`
- `HCSO_SCRAPE_MODE`

### Threshold and behavior config duplicated across code and docs

- `HIGH_QUALITY_MATCH`
  - used in `api/src/server.ts`
  - referenced in docs
  - not owned by `shared/src/config.ts`

- `PARTY_PULL_COOLDOWN_MINUTES`
  - used in `api/src/server.ts`
  - referenced in docs
  - not represented in `.env.sample`

### Mongo naming duplicated with aliases

- `MONGO_DB`
- `MONGO_DB_NAME`

Multiple tools accept both names, which creates avoidable ambiguity.

### Proxy/integration naming duplicated in docs

- `ENRICHMENT_API_BASE` in `docs/Dashboard_Proxy_Wiring.md`
- `ENRICHMENT_BASE_URL` in `docs/OPTION_B_UI_PROVIDER_WIRING.md`

Those appear to represent the same concept but use different names.

## Hardcoded Values That Should Be Configurable

These are currently hardcoded in code or Compose and are candidates for centralization:

- `api/src/server.ts`
  - default `HIGH_QUALITY_MATCH=0.75`
  - default `PARTY_PULL_COOLDOWN_MINUTES=30`

- `docker-compose.yml`
  - internal Redis URL `redis://redis:6379`
  - API port binding `4000:4000`

- `shared/src/config.ts`
  - default Mongo URI/database fallback values
  - default Redis URL
  - default HCSO base URL
  - provider rate-limit defaults
  - provider retry/backoff defaults

Some of these defaults are reasonable, but they are still operational policy and should be documented consistently if not fully externalized.

## Inconsistencies Across Files

### HCSO mode support mismatch

- `shared/src/config.ts` defaults `HCSO_SCRAPE_MODE` to `browser`
- `.env.sample` says browser mode is not implemented and recommends `http`

That is a real inconsistency.

### Incomplete template coverage

`shared/src/config.ts` exposes values not present in `.env.sample`, including:

- provider rate limits
- provider retry/backoff knobs
- provider unit-cost knobs
- `PARTY_PULL_PREFER_STATEWIDE`

### Split ownership of behavior config

- most runtime config lives in `shared/src/config.ts`
- `HIGH_QUALITY_MATCH` and `PARTY_PULL_COOLDOWN_MINUTES` live in `api/src/server.ts`

That means config is only mostly centralized, not fully centralized.

### Tool scripts bypass the central config module

Many `tools/*.js` files read env directly and define their own defaults instead of importing the shared config module.

## Overall Assessment

This repo is moderately centralized.

- Good: the main runtime API/worker settings mostly flow through one module: `shared/src/config.ts`
- Weak: Compose, tools, and docs duplicate or redefine significant parts of the same config surface
- Result: not chaotic, but still fragmented enough to create drift

## Recommendation

1. Move `HIGH_QUALITY_MATCH` and `PARTY_PULL_COOLDOWN_MINUTES` into `shared/src/config.ts`.
2. Expand `.env.sample` to match the full runtime surface.
3. Standardize on `MONGO_DB` and retire `MONGO_DB_NAME` unless backward compatibility is required.
4. Unify the docs naming for enrichment proxy base URL.
5. Make tool scripts consume the shared config module where practical.