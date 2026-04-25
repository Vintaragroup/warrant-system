# WarrantDB Pipeline Entry Point Audit

Date: 2026-04-24
Scope: executable entry points, package-less script surfaces, scheduler paths, Docker and deployment startup paths, and conflicting or likely-stale execution surfaces in `warrantdb-pipeline`

## Primary Conclusion

The primary operational entry point for this repository is:

- `python -m scripts.run_pipeline`

Why this is primary:

- `SCHEDULING.md` treats it as the main twice-daily production command.
- The repo describes itself primarily as a production-focused pipeline, not just an API.
- The documented cron, systemd, and Render scheduler examples all center on `scripts.run_pipeline`.
- `scripts/run_twice_daily.sh` is only a wrapper around `python -m scripts.run_pipeline`.

The main secondary service entry point is:

- `uvicorn api.main:app --reload --port 8080`

That path starts the read-only FastAPI service, but the repo’s pipeline orchestration still appears to be the primary system behavior.

## All Identified Entry Points

### Primary pipeline orchestration

- `scripts/run_pipeline.py`
- wrapper shell entry: `scripts/run_twice_daily.sh`

### API service entry points

- `api/main.py`
- documented command in `README.md`: `uvicorn api.main:app --reload --port 8080`

### Direct Python entry points

Files with explicit direct execution patterns or documented CLI usage:

- `normalize_to_simple.py`
- `test_mongo.py`
- `ingestion/brazoria_ingest.py`
- `ingestion/brazoria_jail.py`
- `ingestion/fortbend_ingest.py`
- `ingestion/fortbend_jail.py`
- `ingestion/galveston_p2c_fast.py`
- `enrichment/tdcj_enrich.py`
- `scripts/run_ingestion.py`
- `scripts/run_pipeline.py`
- `scripts/run_harris_e2e.py`
- `scripts/report_simple_deltas.py`
- `scripts/fetch_email_rosters.py`
- `scripts/enrich_harris_dob.py`
- `scripts/enrich_galveston_details.py`
- `scripts/harris_post_normalize.py`
- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`
- `scripts/backfill_booking_datetime_harris.py`
- `scripts/backfill_galveston_mugshots.py`
- `scripts/scan_anomalies_simple_harris.py`
- `scripts/fix_anomalies_simple_harris.py`
- `scripts/health_simple_harris.py`
- `scripts/person_address_sync_harris.py`
- `scripts/baseline_booking_metrics.py`
- `scripts/compare_roster_county.py`
- `scripts/derive_jefferson_prefixes.py`
- `scripts/jefferson_pdf_recent_bonds.py`
- `scripts/migrate_galveston_data.py`
- `scripts/run_tdcj_enrichment.py`
- `scripts/tdcj_ivss_recent_intakes.py`
- `scripts/setup_indexes_extra.py`

### Direct shell entry points

- `scripts/run_twice_daily.sh`
- `scripts/cloud_sync.sh`
- `scripts/nightly_simple_harris.sh`
- `scripts/run_rebucket.sh`

### Mongo shell and JavaScript entry points

- `make_jeff_lastnames_from_simple.js`
- `scripts/check_time_bucket_v2.js`
- `scripts/rebucket_time_bucket_v2.js`
- `scripts/backfill_booking_datetime_from_strings.js`
- `scripts/field_inventory.js`

### Side-effect module entry points

These execute on direct invocation even without a `main()` guard because the work happens at module top level:

- `scripts/setup_indexes.py`
- `scripts/setup_indexes_events.py`

### Documentation-driven operational commands

Documented repo entry commands include:

- `python3 -m scripts.run_ingestion --source harris_inmate`
- `python3 normalize_to_simple.py --county harris --debug`
- `python3 -m scripts.fetch_email_rosters`
- `python3 -m scripts.enrich_harris_dob --limit 250 --window 30d`
- `mongosh "$MONGO_URI/warrantdb" scripts/check_time_bucket_v2.js`
- `mongosh "$MONGO_URI/warrantdb" scripts/rebucket_time_bucket_v2.js`

## Schedulers, Cron Jobs, and Automatic Execution Paths

### Crontab

Documented in `SCHEDULING.md` and `RUNBOOK.md`:

- Twice-daily main pipeline:
  - `python -m scripts.run_pipeline`
- Nightly Harris DOB enrichment:
  - `python -m scripts.enrich_harris_dob --limit 200 --window 24h`
- Hourly email roster fetch/import flow:
  - `python3 -m scripts.fetch_email_rosters`
  - `python3 -m scripts.run_ingestion --source harris_email_roster`
- Wrapper alternative for roster sync:
  - `bash scripts/cloud_sync.sh`

### systemd timer

Documented in `SCHEDULING.md`:

- `ExecStart=/bin/bash -lc 'source .venv/bin/activate && python -m scripts.run_pipeline ...'`
- `OnCalendar=05:05,17:05`

### Render scheduled execution

Documented in `SCHEDULING.md`:

- `render run python -m scripts.run_pipeline`
- `render run python -m scripts.enrich_harris_dob --limit 200 --window 24h`

### Render service start commands

In `render.yaml`:

- Web API service start command:
  - `uvicorn api.app:app --host 0.0.0.0 --port $PORT`
- Worker service start command:
  - `sleep infinity`

## Docker and Container Entry Paths

### Docker Compose

- `docker-compose.yml`
  - defines `api` and `mongo`
  - `api` uses `build: .`

### Observed issue

- The repo has `Dockerfile.disabled`, not `Dockerfile`
- `docker-compose.yml` does not specify an alternate Dockerfile name

That makes the compose API build path look stale or currently broken unless a missing root `Dockerfile` exists outside the checked workspace state.

## 1. Which Entry Point Is the PRIMARY One?

Primary entry point:

- `python -m scripts.run_pipeline`

Why:

- It is the main command used in `SCHEDULING.md` for cron, systemd, and Render Cron Jobs.
- It reflects the repo’s declared purpose: ingestion, normalization, and reporting pipeline execution.
- `scripts/run_twice_daily.sh` exists only to wrap it.

Secondary but important entry point:

- `uvicorn api.main:app --reload --port 8080`

That is the primary API-service entry, but not the main pipeline orchestration path.

## 2. Which Ones Are Outdated or Unused?

### Strong stale or broken references

- `render.yaml` → `uvicorn api.app:app --host 0.0.0.0 --port $PORT`

Observed issue:

- actual API file is `api/main.py`
- no `api/app.py` was present in the audited workspace

This Render API start command looks outdated.

- `scripts/run_pipeline.py` uses `NORMALIZER_MODULE = "scripts.normalize_to_simple"`

Observed issue:

- the actual normalizer is the repo-root file `normalize_to_simple.py`
- `scripts/normalize_to_simple.py` was not present

This makes the normalize step inside `scripts/run_pipeline.py` look stale or incorrect.

### Likely stale documentation reference

- `SCHEDULING.md` states: `scripts/normalize_to_simple.py` upserts into `simple_*`

Observed issue:

- the file present in the repo is `normalize_to_simple.py` at the root, not under `scripts/`

### Likely stale Docker path

- `docker-compose.yml` uses `build: .`

Observed issue:

- root Dockerfile appears to be `Dockerfile.disabled`, not an active `Dockerfile`

This compose build path looks outdated unless the missing Dockerfile is expected to be restored elsewhere.

### Likely superseded maintenance overlaps

- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`
- `scripts/rebucket_time_bucket_v2.js`

These all work in the same rebucketing area. The v2 JavaScript and v2-specific Python utilities suggest at least one older path may now be secondary.

- `scripts/backfill_booking_datetime_harris.py`
- `scripts/backfill_booking_datetime_from_strings.js`
- `scripts/harris_post_normalize.py`

These overlap around repair and recomputation of booking-time fields and likely include older and newer variants.

## 3. Are There Conflicting Execution Paths?

Yes.

### Conflict A: pipeline normalizer reference is inconsistent

- `scripts/run_pipeline.py` tries to run `python -m scripts.normalize_to_simple`
- `RUNBOOK.md` and `scripts/run_harris_e2e.py` use the repo-root file `normalize_to_simple.py`

This is a concrete execution-path conflict.

### Conflict B: API startup reference is inconsistent

- `README.md` uses `uvicorn api.main:app`
- `render.yaml` uses `uvicorn api.app:app`

Those cannot both be correct with the current file layout.

### Conflict C: direct manual flow vs wrapper flow

For the main pipeline there are overlapping ways to run the same behavior:

- direct `python -m scripts.run_pipeline`
- wrapper `bash scripts/run_twice_daily.sh`

For roster import there are overlapping ways to run the same flow:

- direct `python3 -m scripts.fetch_email_rosters` then `python3 -m scripts.run_ingestion --source harris_email_roster`
- wrapper `bash scripts/cloud_sync.sh`

These are not wrong, but they are parallel execution paths that need consistent operator guidance.

### Conflict D: API service vs pipeline repo identity

The repo supports both:

- API mode via `uvicorn api.main:app`
- batch pipeline mode via `python -m scripts.run_pipeline`

This is intentional, but it means the repository has two top-level operational identities. That can confuse deployment and ownership if not clearly separated.

### Conflict E: duplicate route definition in the API

- `api/main.py` defines `@app.post("/ingest/harris-now")` twice

This is not a file-entry conflict, but it is a conflicting API execution surface inside the main service entry file.

## Bottom Line

- Primary operational entry point: `python -m scripts.run_pipeline`
- Primary API entry point: `uvicorn api.main:app`
- Primary scheduler paths: crontab, systemd timer, and Render Cron Jobs documented in `SCHEDULING.md`
- Strongest stale/broken signals:
  - `render.yaml` points to `api.app:app`
  - `scripts/run_pipeline.py` points to `scripts.normalize_to_simple`
  - `docker-compose.yml` appears to expect a root Dockerfile that is currently disabled

## Recommendation

If this repo is cleaned up later, the highest-value execution-path fixes are:

1. Align `render.yaml` to `api.main:app` if that is the intended API entry
2. Fix `scripts/run_pipeline.py` to call the real normalizer entry path
3. Decide whether `docker-compose.yml` is still active or whether the disabled Dockerfile means the compose path should be retired or repaired
4. Consolidate overlapping Harris maintenance scripts if one is now the preferred path