# WarrantDB Pipeline Environment Variable Audit

Date: 2026-04-24
Scope: `.env.example`, Python code using `os.getenv`/`os.environ`, deployment manifests, shell scripts, and operational docs

## Summary

- Main template file: `.env.example`
- Main runtime owner: `storage/mongo_client.py`
- Core Mongo and roster variables are covered, but many county-specific, scheduler, debug, and maintenance variables are not represented in `.env.example`
- No live hardcoded credential was found in runtime code during this audit, but the docs contain real personal email addresses and environment examples that should be sanitized

## Master ENV Variable Table

### Core service and database variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `MONGO_URI` | `storage/mongo_client.py`, many scripts, docs, deploy files | Yes | Yes | Primary DB connection |
| `MONGO_DB` | `storage/mongo_client.py`, many scripts, docs, deploy files | Yes | Yes | Primary DB name |
| `API_PORT` | `.env.example` | Optional/inconsistent | Yes | Template includes it, but runtime startup uses Uvicorn/`$PORT`, not `API_PORT` |
| `PORT` | `render.yaml` | Platform-provided | No | Used by Render web start command |
| `LOG_LEVEL` | `api/main.py`, `utils/logging.py` | Optional | No | Logging level |
| `HARRIS_BASE_FILES_URL` | `api/main.py`, `render.yaml` | Optional/deploy-specific | No | API debug surface/deploy var |
| `HARRIS_DATASETS_PAGE` | `api/main.py`, `render.yaml` | Optional/deploy-specific | No | API debug surface/deploy var |

### HCSO and Harris enrichment variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `HCSO_SPN_URL_FMT` | HCSO enrichment code/docs | Required for HCSO DOB enrichment | Commented | Template documents it as optional-commented but operationally required for that flow |
| `HCSO_NAME_URL_FMT` | HCSO enrichment code/docs | Required for HCSO DOB enrichment | Commented | Same as above |
| `HCSO_USER_AGENT` | HCSO enrichment code/docs | Optional | Commented | Override for default UA |
| `HCSO_THROTTLE_SEC` | HCSO enrichment code/docs | Optional | Commented | Throttle |
| `HCSO_TIMEOUT_SEC` | HCSO enrichment code/docs | Optional | Commented | Timeout |
| `HCSO_BETWEEN_PEOPLE_SEC` | HCSO enrichment code/docs | Optional | Commented | Small pause between people |
| `HARRIS_EMAIL_ROSTER_DIR` | `.env.example`, importer docs/code | Required for roster support flow | Yes | Input/output directory |
| `HARRIS_ROSTER_FORCE_REPROCESS` | `.env.example` comments | Optional | Commented | Importer override |
| `HARRIS_ROSTER_DEBUG` | `.env.example` comments | Optional | Commented | Importer debug |
| `HARRIS_E2E_STEPS` | `scripts/run_harris_e2e.py` | Optional | No | E2E orchestration |
| `HARRIS_BATCH_SIZE` | `scripts/run_harris_e2e.py` | Optional | No | E2E tuning |
| `HARRIS_BULK_SIZE` | `scripts/run_harris_e2e.py` | Optional | No | E2E tuning |
| `HARRIS_PROGRESS_EVERY` | `scripts/run_harris_e2e.py` | Optional | No | E2E tuning |
| `HARRIS_LOG_LEVEL` | `scripts/run_harris_e2e.py` | Optional | No | E2E logging |
| `HARRIS_LOG_FILE` | `scripts/run_harris_e2e.py` | Optional | No | E2E logging |
| `HARRIS_E2E_CONTINUE_ON_ERROR` | `scripts/run_harris_e2e.py` | Optional | No | E2E behavior |
| `HARRIS_E2E_RETRY` | `scripts/run_harris_e2e.py` | Optional | No | E2E behavior |
| `HARRIS_E2E_RETRY_DELAY` | `scripts/run_harris_e2e.py` | Optional | No | E2E behavior |
| `HARRIS_E2E_WRITE_SUMMARY` | `scripts/run_harris_e2e.py` | Optional | No | E2E behavior |
| `HARRIS_E2E_SUMMARY` | `scripts/run_harris_e2e.py` | Optional | No | E2E output path |

### IMAP, Dropbox, and roster-fetch variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `IMAP_HOST` | `.env.example`, fetcher docs/code | Required for IMAP fetch flow | Yes | Email host |
| `IMAP_PORT` | `.env.example`, fetcher docs/code | Required for IMAP fetch flow | Yes | Email port |
| `IMAP_SSL` | `.env.example`, fetcher code | Optional | Yes | SSL toggle |
| `IMAP_USERNAME` | `.env.example`, docs/code | Required for IMAP fetch flow | Yes | Email username |
| `IMAP_PASSWORD` | `.env.example`, docs/code | Required for IMAP fetch flow | Yes | Email password/app password |
| `IMAP_FOLDER` | `.env.example` | Optional | Yes | Mailbox folder |
| `IMAP_UNSEEN_ONLY` | `.env.example` | Optional | Yes | Fetch filter |
| `IMAP_SINCE_DAYS` | `.env.example` | Optional | Yes | Fetch horizon |
| `ROSTER_EMAIL_FROM` | `.env.example` comments, docs | Optional | Commented | Sender filter |
| `ROSTER_ORIGINAL_FROM` | docs | Optional | No | Forwarded-email original sender filter |
| `ROSTER_SUBJECT_INCLUDE` | `.env.example` comments, docs | Optional | Commented | Subject include filter |
| `ROSTER_SUBJECT_EXCLUDE` | `.env.example` comments | Optional | Commented | Subject exclude filter |
| `ROSTER_SAVE_BY_DATE` | `.env.example` comments, docs | Optional | Commented | Date subfolders |
| `ROSTER_MAX_MESSAGES` | `.env.example` comments | Optional | Commented | Fetch limit |
| `ROSTER_ALLOWED_EXT` | `.env.example` comments | Optional | Commented | Allowed attachment extensions |
| `MARK_SEEN` | `.env.example` comments | Optional | Commented | Mark messages seen |
| `DROPBOX_ACCESS_TOKEN` | `.env.example` comments, docs/code | Optional | Commented | Dropbox archival |
| `DROPBOX_BASE_FOLDER` | `.env.example` comments, docs/code | Optional | Commented | Dropbox target folder |

### Pipeline orchestration and reporting variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `PIPELINE_SOURCES` | `scripts/run_pipeline.py`, scheduling docs | Optional | No | Source selection |
| `PIPELINE_STEPS` | `scripts/run_pipeline.py`, scheduling docs | Optional | No | Step selection |
| `REPORT_COUNTIES` | `scripts/report_simple_deltas.py`, E2E script | Optional | No | Report filter |
| `DEBUG_MAP` | `normalize_to_simple.py`, transforms | Optional | No | Mapping debug |
| `DEBUG_DERIVE` | transforms | Optional | No | Derivation debug |
| `HEALTH_WEBHOOK_URL` | `scripts/health_simple_harris.py` | Optional | No | Health notification webhook |

### County scraper variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `FORTBEND_COLL` | `ingestion/fortbend_ingest.py` | Optional | No | Target collection |
| `FORTBEND_LETTER_DELAY_SEC` | `ingestion/fortbend_ingest.py` | Optional | No | Scrape pacing |
| `FORTBEND_BASE_URL` | `ingestion/fortbend_jail.py` | Optional | No | Base URL override |
| `FORTBEND_DUMP_DIR` | `ingestion/fortbend_jail.py` | Optional | No | Debug dump path |
| `FORTBEND_MAX_DEBUG` | `ingestion/fortbend_jail.py` | Optional | No | Debug cap |
| `FORTBEND_LETTERS` | `ingestion/fortbend_jail.py` | Optional | No | Search range |
| `FORTBEND_FIRST_LETTERS` | `ingestion/fortbend_jail.py` | Optional | No | Search range |
| `FORTBEND_APPEND_WILDCARD` | `ingestion/fortbend_jail.py` | Optional | No | Search behavior |
| `FORTBEND_SINCE_DAYS` | `ingestion/fortbend_jail.py` | Optional | No | Search horizon |
| `FORTBEND_TICK_EVERY` | `ingestion/fortbend_jail.py` | Optional | No | Progress logging |
| `FORTBEND_INCLUDE_DETAILS` | `ingestion/fortbend_jail.py` | Optional | No | Detail fetch toggle |
| `BRAZORIA_COLL` | `ingestion/brazoria_ingest.py` | Optional | No | Target collection |
| `BRAZORIA_LETTER_DELAY_SEC` | `ingestion/brazoria_ingest.py` | Optional | No | Scrape pacing |
| `BRAZORIA_BASE_URL` | `ingestion/brazoria_jail.py` | Optional | No | Base URL override |
| `BRAZORIA_DUMP_DIR` | `ingestion/brazoria_jail.py` | Optional | No | Debug dump path |
| `BRAZORIA_MAX_DEBUG` | `ingestion/brazoria_jail.py` | Optional | No | Debug cap |
| `BRAZORIA_LETTERS` | `ingestion/brazoria_jail.py` | Optional | No | Search range |
| `BRAZORIA_FIRST_LETTERS` | `ingestion/brazoria_jail.py` | Optional | No | Search range |
| `BRAZORIA_APPEND_WILDCARD` | `ingestion/brazoria_jail.py` | Optional | No | Search behavior |
| `BRAZORIA_SINCE_DAYS` | `ingestion/brazoria_jail.py` | Optional | No | Search horizon |
| `BRAZORIA_TICK_EVERY` | `ingestion/brazoria_jail.py` | Optional | No | Progress logging |
| `BRAZORIA_INCLUDE_DETAILS` | `ingestion/brazoria_jail.py` | Optional | No | Detail fetch toggle |

### Jefferson, TDCJ, and maintenance variables

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `JEFF_SURNAME_FILE` | `ingestion/jefferson_jail.py` | Optional | No | Surname source file |
| `JEFF_ROW_DELAY_SEC` | `ingestion/jefferson_jail.py`, scheduling docs | Optional | No | Request pacing |
| `JEFF_REQ_TIMEOUT` | `ingestion/jefferson_jail.py`, scheduling docs | Optional | No | Request timeout |
| `JEFF_MAX_RESULTS_PER_PREFIX` | `ingestion/jefferson_jail.py` | Optional | No | Search cap |
| `JEFF_SNAPSHOT` | `ingestion/jefferson_jail.py` | Optional | No | Snapshot toggle |
| `JEFF_SNAPSHOT_DIR` | `ingestion/jefferson_jail.py` | Optional | No | Snapshot output |
| `JEFF_SNAPSHOT_OVERWRITE` | `ingestion/jefferson_jail.py` | Optional | No | Snapshot overwrite |
| `JEFF_MAX_SNAPSHOTS_PER_KIND` | `ingestion/jefferson_jail.py` | Optional | No | Snapshot cap |
| `JEFF_MAX_SNAPSHOTS_TOTAL` | `ingestion/jefferson_jail.py` | Optional | No | Snapshot cap |
| `JEFF_SEARCH_DELAY_SEC` | `ingestion/jefferson_jail.py`, scheduling docs | Optional | No | Search pacing |
| `JEFF_FORCE_RUN` | `ingestion/jefferson_jail.py` | Optional | No | Override |
| `JEFF_NEW_ID_WINDOW` | `ingestion/jefferson_jail.py` | Optional | No | Discovery logic |
| `JEFF_NEW_ID_MISS_LIMIT` | `ingestion/jefferson_jail.py` | Optional | No | Discovery logic |
| `JEFF_LETTERS` | `ingestion/jefferson_jail.py` | Optional | No | Search range |
| `JEFF_FIRST_LETTERS` | `ingestion/jefferson_jail.py` | Optional | No | Search range |
| `JEFF_DETAIL_CONCURRENCY` | `ingestion/jefferson_jail.py` | Optional | No | Parallelism |
| `TDCJ_HEADFUL` | `enrichment/tdcj_enrich.py` | Optional | No | Browser mode toggle |
| `TDCJ_THROTTLE_MS` | `enrichment/tdcj_enrich.py` | Optional | No | Scrape pacing |
| `TDCJ_BETWEEN_PEOPLE_SEC` | `enrichment/tdcj_enrich.py` | Optional | No | Person pacing |
| `TDCJ_LIMIT` | `enrichment/tdcj_enrich.py`, `scripts/run_tdcj_enrichment.py` | Optional | No | Batch size |
| `TDCJ_NAME_PREFIX` | `enrichment/tdcj_enrich.py` | Optional | No | Search filter |
| `TDCJ_SLEEP` | `scripts/run_tdcj_enrichment.py` | Optional | No | Sleep between lookups |
| `SCRAPER_VERIFY_SSL` | `scripts/backfill_galveston_mugshots.py` | Optional | No | SSL behavior |
| `MUGSHOT_SAVE` | `scripts/backfill_galveston_mugshots.py` | Optional | No | Save mode |
| `CONCURRENCY` | mugshot/detail scripts | Optional | No | Shared concurrency knob |
| `SKIP_MUGSHOTS` | `scripts/backfill_galveston_mugshots.py` | Optional | No | Skip behavior |
| `DB_NAME` | `scripts/run_rebucket.sh`, mongosh scripts | Optional | No | Mongo shell DB name, inconsistent with `MONGO_DB` |
| `COLL` | mongosh scripts | Optional | No | Mongo shell collection selector |
| `MAX_DAYS` | rebucket scripts/docs | Optional | No | Maintenance horizon |
| `DRY_RUN` | maintenance scripts/docs | Optional | No | Safe preview mode |

### Optional provider-key placeholders in template

| Variable | Seen in | Likely required? | In `.env.example`? | Notes |
|---|---|---:|---:|---|
| `TLOXP_API_KEY` | `.env.example` only | Optional | Commented | Template placeholder only |
| `TRACERS_API_KEY` | `.env.example` only | Optional | Commented | Template placeholder only |
| `PDL_API_KEY` | `enrichment/enrich_pdl.py` | Required for PDL enrichment | No | Used in code but absent from template |

## Required Variables

Clearly required for the main repo runtime:

- `MONGO_URI`
- `MONGO_DB`

Conditionally required:

- IMAP credentials for email roster fetching
- `HCSO_SPN_URL_FMT` and `HCSO_NAME_URL_FMT` for HCSO DOB enrichment
- `PDL_API_KEY` for PDL enrichment

## Missing From `.env.example`

The highest-signal omissions are:

- `LOG_LEVEL`
- `PDL_API_KEY`
- `HARRIS_BASE_FILES_URL`, `HARRIS_DATASETS_PAGE`
- `PIPELINE_SOURCES`, `PIPELINE_STEPS`, `REPORT_COUNTIES`
- all `FORTBEND_*` tuning variables
- all `BRAZORIA_*` tuning variables
- all `JEFF_*` tuning variables
- all `TDCJ_*` tuning variables
- `DEBUG_MAP`, `DEBUG_DERIVE`
- `HEALTH_WEBHOOK_URL`
- `SCRAPER_VERIFY_SSL`, `MUGSHOT_SAVE`, `CONCURRENCY`, `SKIP_MUGSHOTS`
- `DB_NAME`, `COLL`, `MAX_DAYS`, `DRY_RUN`
- `ROSTER_ORIGINAL_FROM`

## Inconsistent Naming

- `.env.example` uses `API_PORT`, but deployment/runtime startup relies on `PORT`
- main Python code uses `MONGO_DB`, while mongosh maintenance paths use `DB_NAME`
- collection selection uses both `MONGO_DB` and separate `COLL`/`DB_NAME` style variables in shell/JS maintenance tools

## Optional vs Required

Clearly optional:

- county-specific pacing/debug variables
- scheduler selection variables such as `PIPELINE_SOURCES` and `PIPELINE_STEPS`
- HCSO, TDCJ, Jefferson, and mugshot tuning knobs
- Dropbox archival settings
- maintenance-script toggles such as `DRY_RUN`, `MAX_DAYS`, and `COLL`

Clearly required for basic operation:

- `MONGO_URI`
- `MONGO_DB`

## Hardcoded Secrets Or Values

No live hardcoded runtime credential was found in code during this audit.

Hardcoded or sensitive values worth flagging:

- `RUNBOOK.md` includes real personal email examples such as `ryan@vintaragroup.com` and `asaphtown@gmail.com`
- docs and examples include operational sender/value examples like `alerts@harris.tx.us` and Dropbox paths under `$HOME/Dropbox/ASAP_bail/harris_county`
- several county base URLs and user agents are hardcoded defaults; these are not secrets, but they are operational assumptions

## Issues And Risks

1. `.env.example` significantly under-documents the real operational surface of the repo.
2. `API_PORT` in the template is misleading because actual deployment startup uses `PORT` or explicit CLI flags.
3. `DB_NAME` vs `MONGO_DB` creates avoidable confusion across Python and mongosh tooling.
4. The runbook contains real personal email addresses in command examples and should be sanitized.

## Recommendation

1. Expand `.env.example` with an advanced section for county-specific, scheduler, and maintenance variables.
2. Replace `API_PORT` with `PORT`, or remove it if the service never reads it directly.
3. Standardize on `MONGO_DB` across Python and maintenance tooling where possible.
4. Sanitize personal email addresses and operator-specific paths in the docs.