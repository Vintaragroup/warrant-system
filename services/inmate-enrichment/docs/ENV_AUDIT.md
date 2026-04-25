# Inmate Enrichment Environment Variable Audit

Date: 2026-04-24
Scope: `.env.sample`, runtime code in `shared`, `api`, `worker`, `tools`, and environment variables referenced in docs implementation sketches

## Summary

- Main template file: `.env.sample`
- Main runtime owner: `shared/src/config.ts`
- Most core runtime variables are documented, but several tuning and tool-only variables are missing from `.env.sample`
- No live hardcoded secret was found in code during this audit

## Master ENV Variable Table

### Core runtime and provider variables

| Variable | Seen in | Likely required? | In `.env.sample`? | Notes |
|---|---|---:|---:|---|
| `MONGO_URI` | `shared/src/config.ts`, many `tools/*.js` | Yes | Yes | Core DB connection |
| `MONGO_DB` | `shared/src/config.ts`, many `tools/*.js` | Yes | Yes | Primary DB name |
| `MONGO_DB_NAME` | `shared/src/config.ts`, many `tools/*.js` | Optional alias | No | Alias for `MONGO_DB`; naming inconsistency |
| `REDIS_URL` | `shared/src/config.ts` | Yes for queue-backed runtime | Yes | Core queue connection |
| `PORT` | `shared/src/config.ts`, API tools/docs | Yes for API runtime | Yes | API bind port |
| `NODE_ENV` | `shared/src/config.ts` | Optional | Yes | Defaults to `development` |
| `SUBJECTS_COLLECTION` | `shared/src/config.ts`, many tools | Optional | Yes | Defaults vary by code path |
| `ENRICHMENT_WINDOW_HOURS` | `shared/src/config.ts` | Optional | Yes | Runtime window control |
| `IDEMPOTENCY_WINDOW_SECONDS` | `shared/src/config.ts` | Optional | Yes | Duplicate-job suppression |
| `BOND_THRESHOLD` | `shared/src/config.ts` | Optional | Yes | Gate for enrichment actions |
| `AUTO_ENRICH_ENABLED` | `shared/src/config.ts` | Optional | Yes | Change-stream/sweep behavior |
| `AUTO_ENRICH_SWEEP_CRON` | `shared/src/config.ts` | Optional | Yes | Sweep schedule |
| `RAW_PAYLOAD_TTL_HOURS` | `shared/src/config.ts` | Optional | Yes | Payload retention |
| `QUEUE_CONCURRENCY` | `shared/src/config.ts` | Optional | Yes | Worker concurrency |
| `PDL_API_KEY` | `shared/src/config.ts`, tools | Required if PDL enabled | Yes | Provider key |
| `PIPL_API_KEY` | `shared/src/config.ts`, tools | Required if Pipl enabled | Yes | Provider key |
| `WHITEPAGES_API_KEY` | `shared/src/config.ts` | Required if Whitepages enabled | Yes | Provider key |
| `OPENAI_API_KEY` | `shared/src/config.ts` | Required if OpenAI enabled | Yes | Provider key |
| `PROVIDER_PDL_ENABLED` | `shared/src/config.ts` | Optional | Yes | Override for provider auto-detect |
| `PROVIDER_PIPL_ENABLED` | `shared/src/config.ts` | Optional | Yes | Override for provider auto-detect |
| `PROVIDER_WHITEPAGES_ENABLED` | `shared/src/config.ts` | Optional | Yes | Override for provider auto-detect |
| `PROVIDER_OPENAI_ENABLED` | `shared/src/config.ts` | Optional | Yes | Override for provider auto-detect |
| `PDL_MAX_RPS` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PDL_MAX_PER_HOUR` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PDL_MAX_PER_DAY` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PIPL_MAX_RPS` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PIPL_MAX_PER_HOUR` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PIPL_MAX_PER_DAY` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `WP_MAX_RPS` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `WP_MAX_PER_HOUR` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `WP_MAX_PER_DAY` | `shared/src/config.ts` | Optional | No | Rate limit tuning |
| `PROVIDER_MAX_RETRIES` | `shared/src/config.ts` | Optional | No | Provider retry tuning |
| `PROVIDER_INITIAL_BACKOFF_MS` | `shared/src/config.ts` | Optional | No | Provider retry tuning |
| `PROVIDER_BACKOFF_FACTOR` | `shared/src/config.ts` | Optional | No | Provider retry tuning |
| `PROVIDER_JITTER_MS` | `shared/src/config.ts` | Optional | No | Provider retry tuning |
| `PDL_UNIT_COST_USD` | `shared/src/config.ts` | Optional | No | Cost accounting |
| `PIPL_UNIT_COST_USD` | `shared/src/config.ts` | Optional | No | Cost accounting |
| `WP_UNIT_COST_USD` | `shared/src/config.ts` | Optional | No | Cost accounting |
| `PARTY_PULL_PREFER_STATEWIDE` | `shared/src/config.ts` | Optional | No | Related-party behavior toggle |
| `HIGH_QUALITY_MATCH` | `api/src/server.ts`, tools, docs | Optional | Yes | Acceptance threshold |
| `PARTY_PULL_COOLDOWN_MINUTES` | `api/src/server.ts`, docs | Optional | No | Cooldown tuning |
| `LOG_LEVEL` | `shared/src/logger.ts` | Optional | No | Logging level |

### HCSO and tool-only variables

| Variable | Seen in | Likely required? | In `.env.sample`? | Notes |
|---|---|---:|---:|---|
| `HCSO_SCRAPE_ENABLED` | `shared/src/config.ts` | Optional | Yes | HCSO feature gate |
| `HCSO_BASE_URL` | `shared/src/config.ts` | Optional | Yes | HCSO host fallback |
| `HCSO_SCRAPE_MODE` | `shared/src/config.ts` | Optional | Yes | Docs say `http`; code default is `browser` |
| `API_BASE` | `tools/enqueue_micro_batch.js` | Optional | No | Tool-only API target |
| `API_TOKEN` | `tools/enqueue_micro_batch.js` | Optional | No | Tool-only auth token |
| `SUBJECT_ID` | `tools/upsert_name_relations.js` | Optional | No | Tool-only subject selector |
| `REPORT_WINDOW_HOURS` | `tools/report_dob_backfill.js` | Optional | No | Tool-only reporting horizon |

### Docs-only integration variables referenced in the repo

| Variable | Seen in | Likely required? | In `.env.sample`? | Notes |
|---|---|---:|---:|---|
| `ENRICHMENT_API_BASE` | `docs/Dashboard_Proxy_Wiring.md` | Optional | No | Docs-only proxy example |
| `ENRICHMENT_PROXY_SECRET` | `docs/Dashboard_Proxy_Wiring.md` | Optional | No | Docs-only shared-secret example |
| `ENRICHMENT_BASE_URL` | `docs/OPTION_B_UI_PROVIDER_WIRING.md` | Optional | No | Same concept as `ENRICHMENT_API_BASE`, inconsistent name |
| `VITE_HIGH_QUALITY_MATCH` | `docs/Full_Results_Expanders_and_Filters.md` | Optional | No | UI-side env mentioned only in docs |

## Required Variables

Operationally required for the main API/worker stack:

- `MONGO_URI`
- `MONGO_DB` or `MONGO_DB_NAME`
- `REDIS_URL`

Conditionally required:

- `PDL_API_KEY` when `PROVIDER_PDL_ENABLED=true`
- `PIPL_API_KEY` when `PROVIDER_PIPL_ENABLED=true`
- `WHITEPAGES_API_KEY` when `PROVIDER_WHITEPAGES_ENABLED=true`
- `OPENAI_API_KEY` when `PROVIDER_OPENAI_ENABLED=true`

## Missing From `.env.sample`

The clearest omissions are:

- `MONGO_DB_NAME`
- `PDL_MAX_RPS`, `PDL_MAX_PER_HOUR`, `PDL_MAX_PER_DAY`
- `PIPL_MAX_RPS`, `PIPL_MAX_PER_HOUR`, `PIPL_MAX_PER_DAY`
- `WP_MAX_RPS`, `WP_MAX_PER_HOUR`, `WP_MAX_PER_DAY`
- `PROVIDER_MAX_RETRIES`, `PROVIDER_INITIAL_BACKOFF_MS`, `PROVIDER_BACKOFF_FACTOR`, `PROVIDER_JITTER_MS`
- `PDL_UNIT_COST_USD`, `PIPL_UNIT_COST_USD`, `WP_UNIT_COST_USD`
- `PARTY_PULL_PREFER_STATEWIDE`
- `PARTY_PULL_COOLDOWN_MINUTES`
- `LOG_LEVEL`
- tool-only values such as `API_BASE`, `API_TOKEN`, `SUBJECT_ID`, `REPORT_WINDOW_HOURS`

## Inconsistent Naming

- `MONGO_DB` vs `MONGO_DB_NAME`
- `ENRICHMENT_API_BASE` vs `ENRICHMENT_BASE_URL` in docs
- `HCSO_SCRAPE_MODE` default behavior is inconsistent with docs, which say `http-only in this repo`

## Optional vs Required

Clearly optional:

- provider toggles and cost/rate-limit knobs
- `HIGH_QUALITY_MATCH`
- `PARTY_PULL_COOLDOWN_MINUTES`
- `HCSO_*` scrape tuning variables
- tool-specific variables such as `API_BASE`, `API_TOKEN`, `REPORT_WINDOW_HOURS`

Clearly required for the main service:

- `MONGO_URI`
- `MONGO_DB` or `MONGO_DB_NAME`
- `REDIS_URL`

## Hardcoded Secrets Or Values

No live hardcoded credential was found in runtime code during this audit.

Hardcoded non-secret defaults and placeholders worth noting:

- localhost defaults for Mongo, Redis, and API URLs in runtime code and tool scripts
- default HCSO base URL `https://www.harriscountyso.org`
- placeholder Atlas URI in `.env.sample`

## Issues And Risks

1. `.env.sample` does not cover several real runtime tuning variables, so operators will not know they exist.
2. `MONGO_DB` and `MONGO_DB_NAME` create avoidable ambiguity.
3. The docs use two different enrichment proxy variable names for the same idea.
4. `HCSO_SCRAPE_MODE` has a code/doc mismatch: code defaults to `browser`, docs say browser mode is not implemented.

## Recommendation

1. Expand `.env.sample` to include all real runtime knobs from `shared/src/config.ts` and `api/src/server.ts`.
2. Standardize on `MONGO_DB` and deprecate `MONGO_DB_NAME` unless backward compatibility is required.
3. Pick one enrichment proxy variable name in docs.
4. Align `HCSO_SCRAPE_MODE` docs and code to the actually supported mode.