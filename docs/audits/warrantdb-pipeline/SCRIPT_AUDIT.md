# WarrantDB Pipeline Script Audit

Date: 2026-04-24
Scope: scripts related to scraping, data ingestion, scheduling, and batch jobs

## Observations

- This repo has the largest executable surface of the three audited workspaces.
- A documented production core exists, but it sits beside many one-off maintenance, migration, and investigative scripts.
- A few scripts are clearly stale or superseded by newer versions, while many others are valid manual utilities that are simply not part of the scheduled path.

## Reasoning

- I treated a script as active when it was referenced by `README.md`, `RUNBOOK.md`, `SCHEDULING.md`, or by another active entrypoint.
- I treated ingestion modules as active when they are dispatch targets of `scripts/run_ingestion.py`.
- I treated a script as a deletion candidate only when it was duplicated, stale, historically one-off, or incomplete relative to the current pipeline.

## All Relevant Scripts And Purpose

### Core active pipeline scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/run_pipeline.py` | orchestrates ingest, normalize, and report steps using env-driven source and step selection | primary scheduled command in `SCHEDULING.md` and `RUNBOOK.md` | Active |
| `scripts/run_ingestion.py` | dispatches to source-specific scrapers by `--source` | called directly in `RUNBOOK.md` and from `scripts/run_pipeline.py` | Active |
| `normalize_to_simple.py` | normalizes raw collections into `simple_*` collections | documented in `README.md` and `RUNBOOK.md` | Active |
| `scripts/report_simple_deltas.py` | reports deltas after normalization | called by `scripts/run_pipeline.py` | Active |

### Active ingestion and scraping entry modules

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `ingestion/harris_inmate.py` | Harris inmate scraper | dispatched by `scripts/run_ingestion.py` | Active |
| `ingestion/harris_email_roster.py` | Harris email-roster importer | dispatched by `scripts/run_ingestion.py`; documented in README/runbook | Active |
| `ingestion/galveston_p2c_fast.py` | Galveston scraper | dispatched by `scripts/run_ingestion.py` | Active |
| `ingestion/jefferson_jail.py` | Jefferson scraper | dispatched by `scripts/run_ingestion.py` | Active |
| `ingestion/brazoria_jail.py` | Brazoria scraper | dispatched by `scripts/run_ingestion.py` | Active |
| `ingestion/fortbend_jail.py` | Fort Bend scraper | dispatched by `scripts/run_ingestion.py` | Active |
| `scripts/fetch_email_rosters.py` | IMAP fetcher for Harris roster attachments | documented in README and RUNBOOK | Active |

### Active scheduling and operations scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/run_twice_daily.sh` | wrapper that sets pipeline env and runs `python -m scripts.run_pipeline` | explicit batch wrapper for twice-daily operation | Active utility |
| `scripts/cloud_sync.sh` | wrapper that loads env, fetches email rosters, and runs Harris roster ingestion | documented in `RUNBOOK.md` | Active utility |
| `scripts/nightly_simple_harris.sh` | nightly Harris anomaly scan and fix wrapper | active maintenance wrapper for Harris | Active utility |
| `scripts/setup_indexes.py` | one-time index creation | documented in `SCHEDULING.md` | Active utility |
| `scripts/setup_indexes_extra.py` | extra indexes for simple collections and HCSO enrichment | documented in `SCHEDULING.md` and README | Active utility |
| `scripts/setup_indexes_events.py` | event dedupe indexes | documented in `SCHEDULING.md` | Active utility |
| `api/main.py` | FastAPI API entrypoint | documented in README; actual API runtime | Active |

### Active Harris and maintenance job scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/harris_post_normalize.py` | Harris post-normalize booking timestamp and `time_bucket_v2` repair | documented in `RUNBOOK.md` | Active |
| `scripts/enrich_harris_dob.py` | HCSO-driven DOB enrichment for Harris records | documented in README and scheduling docs | Active |
| `scripts/scan_anomalies_simple_harris.py` | scans Harris anomalies | called by `scripts/nightly_simple_harris.sh` | Active utility |
| `scripts/fix_anomalies_simple_harris.py` | fixes Harris anomaly classes | called by `scripts/nightly_simple_harris.sh` | Active utility |
| `scripts/rebucket_simple_harris_v2.py` | newer Harris rebucketing script using current `time_bucket_v2` approach | current v2-style maintenance path | Active utility |
| `scripts/backfill_booking_datetime_harris.py` | one-off or repeatable Harris booking datetime backfill | part of current Harris maintenance path | Active utility |
| `scripts/check_time_bucket_v2.js` | Mongo shell verification for `time_bucket_v2` | documented in `RUNBOOK.md` | Active utility |
| `scripts/rebucket_time_bucket_v2.js` | Mongo shell rebucketing helper | documented in `RUNBOOK.md` | Active utility |
| `scripts/backfill_booking_datetime_from_strings.js` | Mongo shell datetime backfill helper | documented in `RUNBOOK.md` | Active utility |

### Active specialized utilities

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/run_harris_e2e.py` | full Harris end-to-end orchestration wrapper | explicitly orchestrates current Harris steps | Active utility |
| `scripts/run_tdcj_enrichment.py` | targeted enrichment run for records missing DOB via TDCJ flow | current specialized enrichment utility | Active utility |
| `scripts/health_simple_harris.py` | health check and optional webhook for simple Harris | current operational health utility | Active utility |
| `make_jeff_lastnames_from_simple.js` | derives Jefferson surname list from existing data | current specialized support utility | Manual utility |
| `test_mongo.py` | quick Mongo connection sanity test | current developer utility | Manual utility |

### Manual or limited-use utilities

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/baseline_booking_metrics.py` | baseline metrics export | no active schedule reference | Manual utility |
| `scripts/compare_roster_county.py` | roster-to-county comparison report | no active schedule reference | Manual utility |
| `scripts/jefferson_pdf_recent_bonds.py` | Jefferson PDF recent-bonds extraction | standalone use only | Manual utility |
| `scripts/person_address_sync_harris.py` | syncs Harris addresses into persons model | standalone utility | Manual utility |
| `scripts/derive_jefferson_prefixes.py` | derives Jefferson prefix env values | standalone tuning utility | Manual utility |
| `scripts/backfill_galveston_mugshots.py` | mugshot backfill utility | specialized Galveston maintenance | Manual utility |
| `scripts/field_inventory.js` | field inventory diagnostic | standalone Mongo diagnostic | Manual utility |
| `scripts/run_rebucket.sh` | thin wrapper around rebucketing helper | convenience wrapper, not primary doc path | Manual utility |

## Duplicate Scripts Doing Similar Work

### Strong duplicate signal

- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`

The v2 script is the stronger current candidate because the surrounding maintenance surface and runbook have already moved toward `booking_datetime` and `time_bucket_v2` semantics.

### Overlapping Harris rebucketing/repair cluster

- `scripts/rebucket_simple_harris_v2.py`
- `scripts/rebucket_time_bucket_v2.js`
- `scripts/backfill_booking_datetime_harris.py`
- `scripts/backfill_booking_datetime_from_strings.js`

These are not duplicates, but they operate in the same repair domain and should be reviewed together when simplifying the Harris maintenance surface.

## Scripts No Longer Referenced Anywhere

### Strong unreferenced or weakly referenced candidates

- `scripts/baseline_booking_metrics.py`
- `scripts/compare_roster_county.py`
- `scripts/jefferson_pdf_recent_bonds.py`
- `scripts/person_address_sync_harris.py`
- `scripts/derive_jefferson_prefixes.py`
- `scripts/field_inventory.js`
- `make_jeff_lastnames_from_simple.js`
- `test_mongo.py`

These look like operator or developer utilities rather than active scheduled pipeline components.

### Historical migration candidate

- `scripts/migrate_galveston_data.py`

This is a migration script aimed at moving old Galveston records from one collection shape to another. It looks historical rather than part of the current pipeline.

## Scripts That Are Partially Implemented Or Broken

### Broken or stale

- `scripts/run_pipeline.py`
  - currently sets `NORMALIZER_MODULE = "scripts.normalize_to_simple"`
  - the actual normalizer is the repo-root `normalize_to_simple.py`
  - this makes the normalize step stale or broken unless a missing module alias exists elsewhere

- `scripts/rebucket_simple_harris.py`
  - looks superseded by `scripts/rebucket_simple_harris_v2.py`
  - keep only if there is a known rollback need for the earlier implementation

### Likely stale or historical

- `scripts/migrate_galveston_data.py`
  - one-off migration script for moving Galveston records into a different collection shape
  - not part of the documented current pipeline

### Partially implemented or low-confidence maintenance surface

- `scripts/enrich_galveston_details.py`
  - executable, but not referenced by README, RUNBOOK, or scheduling docs
  - appears to rely on specific debug data shape and is not integrated into the current pipeline

## Clean List Of Active Scripts

### Primary active scripts

- `scripts/run_pipeline.py`
- `scripts/run_ingestion.py`
- `normalize_to_simple.py`
- `scripts/report_simple_deltas.py`
- `api/main.py`

### Active ingestion and scheduling scripts

- `scripts/fetch_email_rosters.py`
- `scripts/run_twice_daily.sh`
- `scripts/cloud_sync.sh`
- `scripts/nightly_simple_harris.sh`
- `scripts/setup_indexes.py`
- `scripts/setup_indexes_extra.py`
- `scripts/setup_indexes_events.py`
- `scripts/harris_post_normalize.py`
- `scripts/enrich_harris_dob.py`
- `scripts/scan_anomalies_simple_harris.py`
- `scripts/fix_anomalies_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`
- `scripts/backfill_booking_datetime_harris.py`
- `scripts/check_time_bucket_v2.js`
- `scripts/rebucket_time_bucket_v2.js`
- `scripts/backfill_booking_datetime_from_strings.js`
- `scripts/run_harris_e2e.py`
- `scripts/run_tdcj_enrichment.py`
- `ingestion/harris_inmate.py`
- `ingestion/harris_email_roster.py`
- `ingestion/galveston_p2c_fast.py`
- `ingestion/jefferson_jail.py`
- `ingestion/brazoria_jail.py`
- `ingestion/fortbend_jail.py`

## Candidates For Deletion

### Highest-confidence deletion or archive candidates

- `scripts/rebucket_simple_harris.py`
- `scripts/migrate_galveston_data.py`

### Review-for-archive candidates

- `scripts/enrich_galveston_details.py`
- `scripts/baseline_booking_metrics.py`
- `scripts/compare_roster_county.py`
- `scripts/jefferson_pdf_recent_bonds.py`
- `scripts/person_address_sync_harris.py`
- `scripts/derive_jefferson_prefixes.py`
- `scripts/field_inventory.js`
- `make_jeff_lastnames_from_simple.js`
- `test_mongo.py`

### Keep, but fix first

- `scripts/run_pipeline.py`

This is the primary orchestrator and should not be deleted, but its normalizer module path needs correction.

## Bottom Line

- The active pipeline is well-defined: `run_pipeline.py`, `run_ingestion.py`, `normalize_to_simple.py`, `report_simple_deltas.py`, and the source-specific ingestion modules.
- The main cleanup opportunity is in older Harris maintenance variants and historical Galveston migration/detail scripts.
- The most important functional defect in this script layer is the stale normalizer module reference inside `scripts/run_pipeline.py`.