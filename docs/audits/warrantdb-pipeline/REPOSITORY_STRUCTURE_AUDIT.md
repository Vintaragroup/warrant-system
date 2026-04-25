# WarrantDB Pipeline Repository Structure Audit

Date: 2026-04-23
Scope: discovery and audit only for the `warrantdb-pipeline` repository

## Purpose

This document provides a workspace-oriented overview of the repository structure, the role of each major top-level area, the main executable entry points, and files or directories that appear duplicated, transitional, or operationally noisy.

## Cleaned Folder Tree

This tree omits `.git`, `.venv`, `__pycache__`, and `.DS_Store`, while keeping the meaningful source, docs, scripts, and artifact layout.

```text
warrantdb-pipeline/
├── .github/
│   └── workflows/
├── api/
│   ├── __init__.py
│   └── main.py
├── configs/
│   ├── __init__.py
│   ├── brazoria.json
│   ├── fortbend.json
│   ├── galveston.json
│   ├── harris.json
│   └── jefferson_lastnames.txt
├── debug/
│   ├── field_inventory_.err
│   ├── field_inventory_.txt
│   ├── field_inventory_20250910T182119Z.txt
│   ├── galveston_p2c_*.png
│   ├── galveston_roster_*.png
│   ├── roster_dump.json
│   ├── sniff.json
│   ├── jefferson/
│   │   └── jefferson_snapshot_09_21/
│   └── testing/
├── debug_dumps/
│   ├── brazoria/
│   │   ├── detail/
│   │   ├── logs/
│   │   └── search/
│   └── fortbend/
├── docs/
│   ├── CRON_JOBS.md
│   ├── HARRIS_RUN_STEPS.md
│   ├── JEFFERSON_PDF_RECENT_BONDS.md
│   ├── REPOSITORY_STRUCTURE_AUDIT.md
│   ├── TDCJ_IVSS_RECENT.md
│   └── simple_commands/
├── dump_local/
│   └── warrantdb/
├── email_rosters/
├── enrichment/
│   ├── _init__.py
│   ├── enrich_pdl.py
│   ├── harris_hcso_dob.py
│   ├── public_records.py
│   └── tdcj_enrich.py
├── entity_resolution/
│   └── matcher.py
├── ingestion/
│   ├── __init__.py
│   ├── audited_scraper.py
│   ├── base_scraper.py
│   ├── brazoria_ingest.py
│   ├── brazoria_jail.py
│   ├── fortbend_ingest.py
│   ├── fortbend_jail.py
│   ├── galveston_p2c_fast.py
│   ├── harris_email_roster.py
│   ├── harris_inmate.py
│   └── jefferson_jail.py
├── logs/
│   ├── harris_e2e_summary_*.json
│   ├── ingest.*.log
│   ├── normalize.*.log
│   └── normalize_harris_*.log
├── mappings/
│   ├── brazoria/
│   │   └── brazoria_inquiry.yaml
│   ├── fortbend/
│   │   └── fortbend_inmates.yaml
│   ├── galveston/
│   │   └── galveston_p2c.yaml
│   ├── harris/
│   │   └── harris_court_bonds.yaml
│   └── jefferson/
│       └── jefferson_events.yaml
├── pipeline/
│   ├── __init__.py
│   └── mapping/
│       ├── __init__.py
│       ├── apply.py
│       └── transforms.py
├── rosters/
│   └── jefferson-county/
├── scripts/
│   ├── backfill_booking_datetime_from_strings.js
│   ├── backfill_booking_datetime_harris.py
│   ├── backfill_galveston_mugshots.py
│   ├── baseline_booking_metrics.py
│   ├── check_time_bucket_v2.js
│   ├── cloud_sync.sh
│   ├── compare_roster_county.py
│   ├── derive_jefferson_prefixes.py
│   ├── enrich_galveston_details.py
│   ├── enrich_harris_dob.py
│   ├── fetch_email_rosters.py
│   ├── field_inventory.js
│   ├── fix_anomalies_simple_harris.py
│   ├── harris_post_normalize.py
│   ├── health_simple_harris.py
│   ├── jefferson_pdf_recent_bonds.py
│   ├── migrate_galveston_data.py
│   ├── nightly_simple_harris.sh
│   ├── person_address_sync_harris.py
│   ├── rebucket_simple_harris.py
│   ├── rebucket_simple_harris_v2.py
│   ├── rebucket_time_bucket_v2.js
│   ├── report_simple_deltas.py
│   ├── run_harris_e2e.py
│   ├── run_ingestion.py
│   ├── run_pipeline.py
│   ├── run_rebucket.sh
│   ├── run_tdcj_enrichment.py
│   ├── run_twice_daily.sh
│   ├── scan_anomalies_simple_harris.py
│   ├── setup_indexes.py
│   ├── setup_indexes_events.py
│   ├── setup_indexes_extra.py
│   └── tdcj_ivss_recent_intakes.py
├── shared/
├── storage/
│   ├── __init__.py
│   ├── mongo_client.py
│   └── schemas.py
├── utils/
│   └── logging.py
├── .env
├── .env.example
├── .gitignore
├── Dockerfile.disabled
├── README.md
├── RUNBOOK.md
├── SCHEMA_CONTRACT.md
├── SCHEDULING.md
├── brazoria.jsonl
├── brazoria_dump.json
├── docker-compose.yml
├── harris_baseline.json
├── make_jeff_lastnames_from_simple.js
├── normalize_to_simple.py
├── render.yaml
├── requirements.txt
└── test_mongo.py
```

## Top-Level Directory Purpose

- `.github/`: Repository automation and CI workflow definitions.
- `api/`: FastAPI application exposing read-only and operational endpoints over Mongo-backed data.
- `configs/`: County-specific configuration files and lookup inputs used by ingestion and search logic.
- `debug/`: Manual investigation artifacts, screenshots, field inventories, snapshots, and local debug experiments.
- `debug_dumps/`: Larger structured debug exports split by county and workflow stage.
- `docs/`: Operator and developer documentation, including runbooks, cron guidance, and county-specific notes.
- `dump_local/`: Local database dump area, currently containing a `warrantdb` dump folder.
- `email_rosters/`: Runtime drop location for incoming Harris roster files; currently empty in the checked workspace.
- `enrichment/`: Secondary enrichment jobs, including PDL, HCSO DOB, public records, and TDCJ-related enrichment.
- `entity_resolution/`: Matching logic for correlating or merging person-level entities across inputs.
- `ingestion/`: Source-specific scrapers and importers for counties and roster-based feeds.
- `logs/`: Generated run logs and summaries from ingestion, normalization, and end-to-end jobs.
- `mappings/`: County-specific YAML mapping definitions for converting raw source documents into normalized `simple_*` records.
- `pipeline/`: Shared mapping engine code used by normalization and transformation workflows.
- `rosters/`: Stored roster material, currently used at least for Jefferson County assets.
- `scripts/`: Main operational CLI surface for ingestion, normalization, enrichment, audits, backfills, repairs, and scheduling wrappers.
- `shared/`: Present but currently empty; likely intended as a future shared-code area.
- `storage/`: MongoDB connection helpers and schema-related persistence utilities.
- `utils/`: Small common utilities, currently a logging helper.

## Major Component Overview

- `api/main.py`: Main service entry point. Hosts health checks, person lookup, Harris ingestion triggers, and normalized Harris summary and listing endpoints.
- `ingestion/`: Primary data acquisition layer. Contains the source scrapers and importer classes that populate MongoDB collections from county data sources and email rosters.
- `scripts/`: Operational command surface. This is the densest execution area in the repo and contains the pipeline orchestrator, maintenance jobs, one-off repair tools, and cron-friendly shell wrappers.
- `normalize_to_simple.py` plus `pipeline/mapping/`: Normalization subsystem that reads county mapping configs and writes standardized `simple_*` documents.
- `mappings/`: County-specific mapping rules. This is where normalization behavior is effectively configured.
- `storage/`: Database access layer used by ingestion, API, and scripts.
- `enrichment/`: Optional or secondary enrichment passes applied after basic ingestion.
- `docs/`: Human-facing operational knowledge base for running and debugging the pipeline.
- `debug/`, `debug_dumps/`, `logs/`, `dump_local/`: Artifact-heavy operational directories. Useful for investigation, but not central application code.

## Executable Entry Points

### Service and deployment entry points

- `api/main.py`: FastAPI app module for `uvicorn api.main:app`.
- `docker-compose.yml`: Local container stack entry surface.
- `render.yaml`: Deployment entry/config surface for Render.

### Primary orchestration entry points

- `normalize_to_simple.py`
- `scripts/run_ingestion.py`
- `scripts/run_pipeline.py`
- `scripts/run_twice_daily.sh`
- `scripts/cloud_sync.sh`
- `scripts/nightly_simple_harris.sh`
- `scripts/run_rebucket.sh`

### Direct Python CLI entry points

Files with explicit `if __name__ == "__main__":` guards detected during audit:

- `normalize_to_simple.py`
- `ingestion/brazoria_ingest.py`
- `ingestion/brazoria_jail.py`
- `ingestion/fortbend_ingest.py`
- `ingestion/galveston_p2c_fast.py`
- `enrichment/tdcj_enrich.py`
- `scripts/backfill_booking_datetime_harris.py`
- `scripts/backfill_galveston_mugshots.py`
- `scripts/baseline_booking_metrics.py`
- `scripts/compare_roster_county.py`
- `scripts/derive_jefferson_prefixes.py`
- `scripts/enrich_galveston_details.py`
- `scripts/enrich_harris_dob.py`
- `scripts/fetch_email_rosters.py`
- `scripts/fix_anomalies_simple_harris.py`
- `scripts/harris_post_normalize.py`
- `scripts/health_simple_harris.py`
- `scripts/jefferson_pdf_recent_bonds.py`
- `scripts/migrate_galveston_data.py`
- `scripts/person_address_sync_harris.py`
- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`
- `scripts/report_simple_deltas.py`
- `scripts/run_harris_e2e.py`
- `scripts/run_ingestion.py`
- `scripts/run_pipeline.py`
- `scripts/run_tdcj_enrichment.py`
- `scripts/scan_anomalies_simple_harris.py`
- `scripts/setup_indexes_extra.py`
- `scripts/tdcj_ivss_recent_intakes.py`

### Mongo shell and JavaScript entry points

- `make_jeff_lastnames_from_simple.js`
- `scripts/backfill_booking_datetime_from_strings.js`
- `scripts/check_time_bucket_v2.js`
- `scripts/field_inventory.js`
- `scripts/rebucket_time_bucket_v2.js`

### Side-effect module entry points

These do not define a `main()` guard, but they execute immediately when invoked as a module or script because the index creation logic is top-level:

- `scripts/setup_indexes.py`
- `scripts/setup_indexes_events.py`

### Manual smoke-test entry point

- `test_mongo.py`

## Duplicate or Potentially Redundant Areas

### Transitional or wrapper-style file pairs

- `ingestion/brazoria_ingest.py` and `ingestion/brazoria_jail.py` overlap by design. The newer `brazoria_jail.py` entry path delegates into the older ingest module.
- `ingestion/fortbend_ingest.py` and `ingestion/fortbend_jail.py` follow the same pattern. This looks like compatibility layering rather than accidental duplication.

### Overlapping Harris maintenance utilities

- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`
- `scripts/rebucket_time_bucket_v2.js`

These all operate in the same rebucketing/aging area. The repo appears to be in a transition toward `time_bucket_v2`, so this is a likely consolidation candidate.

- `scripts/backfill_booking_datetime_harris.py`
- `scripts/backfill_booking_datetime_from_strings.js`
- `scripts/harris_post_normalize.py`

These overlap around repairing `booking_datetime` and `time_bucket_v2` fields for Harris normalized data.

### Artifact-heavy or operationally noisy content

- `debug/`, `debug_dumps/`, and `logs/` contain many generated artifacts and historical outputs.
- Root-level snapshot files such as `brazoria.jsonl`, `brazoria_dump.json`, and `harris_baseline.json` look like retained data artifacts rather than active application sources.
- `Dockerfile.disabled` appears intentionally retired.
- `shared/` is empty in the current workspace state.
- `email_rosters/` is currently empty and functions as a runtime landing area rather than a source directory.

### In-file duplication worth auditing later

- `api/main.py` defines `POST /ingest/harris-now` twice. This is not a duplicate file, but it is a duplicate route definition and should be reviewed if the API is being cleaned up.

## Notes

- This document is discovery-only and does not imply that any redundant-looking files are safe to delete without call-site and operational validation.
- The entry-point list is based on explicit main guards, shell wrappers, JavaScript utilities, deployment files, and top-level operational modules observed in the workspace.