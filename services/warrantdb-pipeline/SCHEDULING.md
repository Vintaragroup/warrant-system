# Scheduling the Warrant Pipeline

This document covers both the **legacy pipeline** (twice-daily ingest + normalize) and the **v2 staged ingestion** system (conservative scheduled runs into `v2_*` staging collections).

---

## V2 Staged Ingestion (active — staging collections only)

V2 ingestion runs continuously against `v2_*` staging collections and does not touch any legacy production collection. All schedule enforcement is handled by `scheduler/should_run.py` which reads `admin_config` at runtime — Render cron jobs act as heartbeats.

### Source schedule defaults (`scheduler/config.py`)

| Source             | Enabled | Strategy  | Cadence (CT)           | max/day | Limit | Notes                                                             |
| ------------------ | ------- | --------- | ---------------------- | ------- | ----- | ----------------------------------------------------------------- |
| `galveston`        | ✅      | interval  | every 15 min           | 64      | 250   | All-day; writes to `v2_galveston_events`                          |
| `harris_reports`   | ✅      | run_times | 01:30 CT               | 1       | 4     | After nightly publish; writes to `v2_harris_reports`              |
| `jefferson_lookup` | ✅      | run_times | 06:15, 12:15, 18:15 CT | 3       | 100   | booking_date="today" auto-resolved; writes to `v2_lookup_results` |
| `brazoria_lookup`  | ❌      | run_times | 07:00, 19:00 CT        | 2       | 100   | Disabled — network issue unresolved; do not enable yet            |
| `fortbend_lookup`  | ❌      | manual    | never (cron)           | 0       | 10    | Trigger via CLI or Admin UI only                                  |

### Render cron jobs (`render.yaml`)

Three jobs are active:

```
v2-galveston-staging    */15 * * * *   --respect-schedule --trigger scheduled --limit 250
v2-harris-reports-staging  0 * * * *   --respect-schedule --trigger scheduled --limit 4
v2-jefferson-staging      15 * * * *   --respect-schedule --trigger scheduled --limit 100
```

Required env vars for all cron jobs:

```
USE_V2_INGESTION=true
ENABLE_V2_GALVESTON=true       (galveston job)
ENABLE_V2_HARRIS_REPORTS=true  (harris job)
ENABLE_V2_LOOKUPS=true         (jefferson job)
DRY_RUN=false
ALLOW_ADMIN_NON_DRY_RUN=false  (Admin API remains the only non-dry-run gate)
```

### How --respect-schedule works

1. `run_ingestion_v2.py --respect-schedule` calls `should_run_source(db, source, trigger="scheduled")`.
2. If the schedule says skip, a `skipped` record is written to `ingestion_runs` and the job exits 0.
3. If it should run, a `running` record is created, the scraper executes, and the record is updated to `success` or `failed`.
4. `_count_runs_today()` reads `ingestion_runs` to enforce `max_runs_per_day`.

### Date-mode auto-resolution

For `jefferson_lookup` and `brazoria_lookup`, `default_args.booking_date = "today"` in their config. When `--respect-schedule` is active and no `--booking-date` is provided on the CLI, the script resolves the date using `America/Chicago` timezone automatically. `"today"` and `"yesterday"` are always resolved to `YYYY-MM-DD` before being passed to the scraper.

### Observability

- All runs (including skips) are recorded in the `ingestion_runs` collection.
- Health check: `PYTHONPATH=$PWD MONGO_URI=... python3 scripts/check_v2_staging_health.py`
- Promotion readiness: `PYTHONPATH=$PWD MONGO_URI=... python3 scripts/check_v2_promotion_readiness.py --days 3`

#### `ingestion_runs` fields added for observation-period metrics

| Field                          | Set by       | Description                                                    |
| ------------------------------ | ------------ | -------------------------------------------------------------- |
| `records_inserted`             | `finish_run` | Docs newly inserted (optional — set by scraper if available)   |
| `records_updated`              | `finish_run` | Docs updated in-place                                          |
| `records_skipped`              | `finish_run` | Docs skipped (already up-to-date, filtered, etc.)              |
| `collection_name`              | `finish_run` | Target staging collection name for this run                    |
| `required_field_missing_count` | `finish_run` | Count of docs missing one or more required schema fields       |
| `duplicate_key_warnings`       | `finish_run` | Count of duplicate-key write warnings encountered              |
| `source_health`                | `finish_run` | Optional free-text health annotation from the scraper          |
| `previous_records_written`     | `finish_run` | `records_written` from previous successful non-dry-run         |
| `records_written_delta`        | `finish_run` | `records_written − previous_records_written`                   |
| `previous_run_id`              | `finish_run` | `run_id` of the previous successful non-dry-run used for delta |

Delta fields are only populated for `status=success, dry_run=false` runs.

| Collection            | Stale threshold |
| --------------------- | --------------- |
| `v2_galveston_events` | > 1h            |
| `v2_harris_reports`   | > 36h           |
| `v2_lookup_results`   | > 12h           |
| `v2_report_manifest`  | > 36h           |

### Promotion readiness

Run `check_v2_promotion_readiness.py` to get a per-source + global readiness verdict:

```bash
# Human-readable
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  python3 scripts/check_v2_promotion_readiness.py --days 3

# JSON (used by Admin API GET /api/admin/ingestion/readiness)
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  python3 scripts/check_v2_promotion_readiness.py --days 3 --json
```

#### Readiness rules per source

| Source             | Rule                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `galveston`        | ≥3 days with successes, success_rate ≥95%, latest_success <1h, avg_records_written >0, no dup explosion |
| `harris_reports`   | ≥3 days with successes, success_rate ≥95%, latest_success <36h                                          |
| `jefferson_lookup` | ≥3 days with successes, success_rate ≥90%, latest_success <12h                                          |
| `brazoria_lookup`  | Always `watch` — disabled/optional; enable explicitly to promote                                        |
| `fortbend_lookup`  | Always `manual-only` — never scheduled                                                                  |

#### Readiness values

| Value              | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `ready`            | All thresholds met for the observation window              |
| `watch`            | Marginal — more observation required                       |
| `blocked`          | Hard failure (stale data, low success rate, no runs, etc.) |
| `manual-only`      | Source is not scheduled for continuous ingestion           |
| `ready_to_promote` | All required sources ready (global verdict only)           |

#### Global gate

Required sources: `galveston`, `harris_reports`, `jefferson_lookup`.

- All three `ready` → overall `ready_to_promote`
- Any required source `blocked` → overall `blocked`
- Otherwise → `watch`

**No automated promotion.** The readiness check surfaces metrics only. Promotion requires manual sign-off and a separate deployment step.

### Promotion gates

Do NOT promote v2 reads to production until:

1. `check_v2_promotion_readiness.py --days 3` returns `OVERALL: READY TO PROMOTE`.
2. Each enabled source has ≥ 3 consecutive days of successful staged writes (enforced by the readiness script's `days_observed` check).
3. `check_v2_staging_health.py` shows all collections healthy.
4. Schema contract review passes (see `SCHEMA_CONTRACT.md`).

### Manual run (one-off, bypasses schedule)

```bash
# Dry-run any source
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source galveston --dry-run --limit 5

# Forced staging write (overrides enabled=false)
PYTHONPATH=$PWD USE_V2_INGESTION=true ENABLE_V2_GALVESTON=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source galveston --trigger manual --force --limit 10
```

---

## Legacy Pipeline (Option A–C below)

This repo also includes a legacy twice-daily pipeline for legacy production collections. All assume Python 3.11+ and a `.env` with `MONGO_URI` and `MONGO_DB`.

---

## Option A — crontab (Linux/macOS)

1. Ensure your venv and env are set:

```bash
cd /opt/warrantdb-pipeline
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Put MONGO_URI and MONGO_DB in .env (or export them in the crontab line)
```

2. Create indexes (one-time, safe to re-run):

```bash
python -m scripts.setup_indexes
python -m scripts.setup_indexes_extra
python -m scripts.setup_indexes_events
```

3. Add to crontab (runs 5:05 AM and 5:05 PM **America/New_York**):

```cron
# WarrantDB twice-daily pipeline
5 5,17 * * * cd /opt/warrantdb-pipeline &&   /usr/bin/env -S bash -lc 'source .venv/bin/activate &&   export TZ=America/New_York &&   export PIPELINE_SOURCES="harris_inmate,galveston_p2c_fast,jefferson_jail,fortbend_jail,brazoria_jail" &&   export PIPELINE_STEPS="ingest,normalize,report" &&   export JEFF_MIN_LAST_LEN=2 JEFF_MIN_FIRST_LEN=1 JEFF_SEARCH_DELAY_SEC=1 JEFF_ROW_DELAY_SEC=0.4 JEFF_REQ_TIMEOUT=30 &&   python -m scripts.run_pipeline >> logs/pipeline.$(date +\%F).log 2>&1'
```

> Tip: Make `/opt/warrantdb-pipeline/logs/` first. Log rotation can be handled by `logrotate`.

---

## Option B — systemd timer (Ubuntu/Debian)

Create `/etc/systemd/system/warrantdb.service`:

```ini
[Unit]
Description=WarrantDB twice-daily pipeline

[Service]
Type=oneshot
WorkingDirectory=/opt/warrantdb-pipeline
Environment=TZ=America/New_York
Environment=PIPELINE_SOURCES=harris_inmate,galveston_p2c_fast,jefferson_jail,fortbend_jail,brazoria_jail
Environment=PIPELINE_STEPS=ingest,normalize,report
Environment=JEFF_MIN_LAST_LEN=2
Environment=JEFF_MIN_FIRST_LEN=1
Environment=JEFF_SEARCH_DELAY_SEC=1
Environment=JEFF_ROW_DELAY_SEC=0.4
Environment=JEFF_REQ_TIMEOUT=30
ExecStart=/bin/bash -lc 'source .venv/bin/activate && python -m scripts.run_pipeline >> logs/pipeline.$(date +%%F).log 2>&1'
```

Create `/etc/systemd/system/warrantdb.timer`:

```ini
[Unit]
Description=Run WarrantDB pipeline twice daily

[Timer]
OnCalendar=05:05,17:05
Persistent=true

[Install]
WantedBy=timers.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now warrantdb.timer
```

---

## Option C — Render Cron Jobs (recommended if you deploy on Render)

1. Deploy this repo as a Background Worker on Render with `.env` (MONGO_URI, MONGO_DB).
2. Create **two** Render Cron Jobs (UTC-based) that run the worker command:

```
render run python -m scripts.run_pipeline
```

Schedule them at 09:05 UTC and 21:05 UTC (which correspond to 5:05 AM/PM ET while DST is active). Update if DST changes.

You can pass env vars in the Worker’s settings (PIPELINE*SOURCES, PIPELINE_STEPS, JEFF*\*).

---

## Idempotency & “Only Add New Data”

- **Persons**: `ingestion/base_scraper.py` uses a stable upsert key: `_ext_id` → booking number → (full_name, dob). This prevents duplicates naturally.
- **Events**: add the unique index below so we don’t double-insert the same custody event (same `person_id` and `source_url` or same `booking_number`). See `scripts/setup_indexes_events.py` included in this patch.
- **Normalized**: `scripts/normalize_to_simple.py` upserts into `simple_*` collections via `_upsert_key`. Safe to run repeatedly.

---

## Quick sanity check

````bash
# One-off run
python -m scripts.run_pipeline

# Limit to ingestion only:
PIPELINE_STEPS=ingest python -m scripts.run_pipeline

# Run only specified sources:
PIPELINE_SOURCES="jefferson_jail,galveston_p2c_fast" python -m scripts.run_pipeline

---

## Optional: Nightly DOB enrichment (Harris, last 24h)

Run this once per night after normalization to enrich recent Harris entries with DOB from HCSO. The script only targets rows missing DOB by default.

```bash
# Cron example (runs at 2:15 AM local time; adjust as needed)
15 2 * * * cd /opt/warrantdb-pipeline && /usr/bin/env -S bash -lc 'source .venv/bin/activate && python -m scripts.enrich_harris_dob --limit 200 --window 24h >> logs/enrich_harris_dob.$(date +\%F).log 2>&1'
````

For Render, create a Cron Job that runs your Worker command:

```
render run python -m scripts.enrich_harris_dob --limit 200 --window 24h
```

Environment variables required:

- HCSO_SPN_URL_FMT, HCSO_NAME_URL_FMT
- Optional: HCSO_THROTTLE_SEC, HCSO_TIMEOUT_SEC, HCSO_BETWEEN_PEOPLE_SEC

````

---

## V2 Ingestion Staging Jobs

These jobs run the new three-layer ingestion architecture (`ingestion/event_feeds/`,
`ingestion/reports/`, `ingestion/lookups/`).  **All flags default to false or
dry-run** — no v2 code runs unless explicitly enabled.

All staging writes go to `v2_*` collections.  No production collection is ever
written to by `run_ingestion_v2.py`.

---

### Feature flags

| Variable | Default | Description |
|---|---|---|
| `USE_V2_INGESTION` | `false` | Master gate — required for non-dry-run writes |
| `ENABLE_V2_GALVESTON` | `false` | Enable `GalvestonP2CEventFeed` |
| `ENABLE_V2_HARRIS_REPORTS` | `false` | Enable `HarrisReportIngestor` |
| `ENABLE_V2_LOOKUPS` | `false` | Enable all three lookup scrapers |
| `DRY_RUN` | `true` | Print records; suppress MongoDB writes |

### Staging collections

| Source | Staging collection |
|---|---|
| Galveston | `v2_galveston_events` |
| Harris | `v2_harris_reports` |
| All lookups | `v2_lookup_results` |
| Harris manifest | `v2_report_manifest` |

---

### Recommended staging cadence

| Source | Cadence | Rationale |
|---|---|---|
| **Galveston** | Every 10–15 min (business hours) | P2C roster refreshes frequently; booking events are time-sensitive |
| **Harris reports** | Daily at ~06:00 UTC | Harris publishes new CSV files once per night; idempotent via manifest |
| **Fort Bend lookup** | Manual / enrichment-triggered | Requires a specific name query; no value in polling without a subject |
| **Jefferson lookup** | Manual / enrichment-triggered | Same as Fort Bend |
| **Brazoria lookup** | **Disabled** | `pubweb.brazoriacountytx.gov` unreachable outside Render network — validate first |

---

### Prerequisites before enabling any scheduled staging job

1. Indexes created (one-time, idempotent):
   ```bash
   PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
     python3 scripts/create_v2_indexes.py --verbose
   ```
2. Smoke test passes (no network required):
   ```bash
   PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py
   ```
3. At least one successful manual staging write confirmed (see commands below).
4. Health check shows no errors:
   ```bash
   PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
     python3 scripts/check_v2_staging_health.py
   ```

---

### Staging write commands

Run from `services/warrantdb-pipeline/` with `PYTHONPATH=$PWD`.

```bash
# Galveston — write up to 250 new/updated bookings to v2_galveston_events
PYTHONPATH=$PWD \
  USE_V2_INGESTION=true ENABLE_V2_GALVESTON=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source galveston --no-dry-run --limit 250

# Harris reports — download and ingest up to 4 new report files
PYTHONPATH=$PWD \
  USE_V2_INGESTION=true ENABLE_V2_HARRIS_REPORTS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source harris_reports --no-dry-run --limit 4

# Fort Bend lookup — manual, supply a name
PYTHONPATH=$PWD \
  USE_V2_INGESTION=true ENABLE_V2_LOOKUPS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name RODRIGUEZ --no-dry-run

# Jefferson lookup — manual, supply a name
PYTHONPATH=$PWD \
  USE_V2_INGESTION=true ENABLE_V2_LOOKUPS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source jefferson_lookup --last-name SMITH --no-dry-run
```

### Dry-run exploration (no flags required)

```bash
# Galveston — print first 5 events, no DB writes
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source galveston --dry-run --limit 5

# Harris — download and normalize 1 report, no writes
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source harris_reports --dry-run --limit 1

# Fort Bend / Jefferson — print results, no writes
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name SMITH --dry-run
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source jefferson_lookup --last-name SMITH --dry-run
```

### Offline smoke test

Run before deploying any v2 code change. No network required unless `--live` is passed.

```bash
PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py          # 17 offline schema checks
PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py --live   # also run real network lookups
```

### Staging health check

```bash
# Print doc counts, latest ingested_at, and staleness warnings
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  python3 scripts/check_v2_staging_health.py

# Dry-run (no Mongo connection needed — reports what would be checked)
PYTHONPATH=$PWD python3 scripts/check_v2_staging_health.py --dry-run
```

---

### Crontab examples (staging, not production)

```cron
# Galveston P2C — every 10 min, 8 AM–11 PM CT (UTC 13:00–04:00)
*/10 13-23,0-4 * * * cd /opt/warrantdb-pipeline && \
  PYTHONPATH=$PWD USE_V2_INGESTION=true ENABLE_V2_GALVESTON=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source galveston --no-dry-run --limit 250 \
  >> logs/v2_galveston.$(date +\%F).log 2>&1

# Harris reports — daily at 1 AM CT (06:00 UTC)
0 6 * * * cd /opt/warrantdb-pipeline && \
  PYTHONPATH=$PWD USE_V2_INGESTION=true ENABLE_V2_HARRIS_REPORTS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source harris_reports --no-dry-run --limit 4 \
  >> logs/v2_harris.$(date +\%F).log 2>&1

# Health check — every hour
0 * * * * cd /opt/warrantdb-pipeline && \
  PYTHONPATH=$PWD python3 scripts/check_v2_staging_health.py \
  >> logs/v2_health.$(date +\%F).log 2>&1
```

### Render Cron Jobs

See `render.yaml` for commented-out v2 staging cron blocks.  Uncomment the
`v2-galveston-staging` and `v2-harris-reports-staging` service blocks to deploy.

> **Do not** set `ENABLE_V2_GALVESTON=true` on the production `warrant-pipeline`
> worker until the Galveston upsert-key migration is complete.  The new key
> (`{county, booking_number}`) does not match existing production documents keyed
> on `{county, source_id}`.

---

### Remaining promotion blockers

| Blocker | Required action |
|---|---|
| Galveston upsert key mismatch | One-time migration: rewrite existing `galveston_events` docs to use `{county, booking_number}` key, then drop the old `source_id` unique index |
| Brazoria network unreachable | Confirm a successful staging write on Render before scheduling |
| Lookup scrapers not scheduled | Design enrichment-triggered invocation; lookups require a name query |

---

## Mongo Scheduler Config (`admin_config` collection)

The `scheduler/` Python package provides a runtime configuration layer that
sits between the Render cron wake-up and the actual scraper execution.
This allows pause/resume, skip-weekends, and interval tuning without
requiring a `render.yaml` edit or redeployment.

### How it works

```
Render cron (or crontab)  →  run_ingestion_v2.py --respect-schedule --trigger scheduled
                                          ↓
                              scheduler.should_run.should_run_source(db, source)
                              reads admin_config document for the source
                                          ↓
                   skip?  →  write ingestion_runs record (status=skipped)  →  exit 0
                   run?   →  create ingestion_runs record  →  execute scraper
                                          ↓
                              finish ingestion_runs record (status=success|failed)
```

Without `--respect-schedule`, the runner behaves exactly as before (no schedule
check, no audit write).

### Seeding default configs

```bash
# Seeds admin_config documents for all 5 sources (safe to run repeatedly)
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 - <<'PY'
from storage.mongo_client import get_db
from scheduler.config import ensure_default_configs
ensure_default_configs(get_db())
PY
```

### Pausing and resuming a source

```bash
# Pause galveston (schedule checks will skip it)
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 - <<'PY'
from storage.mongo_client import get_db
from scheduler.config import upsert_source_config
upsert_source_config(get_db(), "galveston", {"schedule": {"paused": True}}, updated_by="ops")
PY

# Resume
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 - <<'PY'
from storage.mongo_client import get_db
from scheduler.config import upsert_source_config
upsert_source_config(get_db(), "galveston", {"schedule": {"paused": False}}, updated_by="ops")
PY
```

Or via the Admin API (requires Admin/SuperUser role):

```bash
curl -X POST https://your-dashboard/api/admin/ingestion/schedules/galveston/pause \
  -H "Authorization: Bearer $TOKEN"

curl -X POST https://your-dashboard/api/admin/ingestion/schedules/galveston/resume \
  -H "Authorization: Bearer $TOKEN"
```

### Skipping weekends

```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 - <<'PY'
from storage.mongo_client import get_db
from scheduler.config import upsert_source_config
upsert_source_config(get_db(), "galveston", {"schedule": {"skip_weekends": True}}, updated_by="ops")
PY
```

Via Admin API:

```bash
curl -X POST https://your-dashboard/api/admin/ingestion/config \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "galveston", "patch": {"schedule": {"skip_weekends": true}}}'
```

### Setting multiple fixed run times per day (Harris-style)

```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 - <<'PY'
from storage.mongo_client import get_db
from scheduler.config import upsert_source_config
upsert_source_config(get_db(), "harris_reports", {
    "schedule": {
        "strategy": "run_times",
        "run_times": ["01:00", "13:00"],
        "max_runs_per_day": 2,
    }
}, updated_by="ops")
PY
```

### Render cron invocation with schedule check

When the v2 staging cron blocks in `render.yaml` are uncommented, change the
`startCommand` to include `--respect-schedule --trigger scheduled`:

```yaml
startCommand: >
  PYTHONPATH=$PWD
  USE_V2_INGESTION=true ENABLE_V2_GALVESTON=true DRY_RUN=false
  python3 scripts/run_ingestion_v2.py
    --source galveston
    --no-dry-run
    --limit 250
    --trigger scheduled
    --respect-schedule
```

With this, the Render cron can fire frequently (e.g., every 5 min) and the
application controls actual execution frequency via `interval_minutes` in
`admin_config`.  Schedule changes take effect on the next cron tick with no
redeployment.

### Manually triggering a dry-run from the Admin API

```bash
curl -X POST https://your-dashboard/api/admin/ingestion/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "galveston",
    "dry_run": true,
    "limit": 5
  }'
```

> **Warning:** Production writes from the Admin API are disabled by default.
> To enable staging writes (not production), set `ALLOW_ADMIN_NON_DRY_RUN=true`
> on the dashboard server AND ensure `PIPELINE_ROOT` points to the pipeline
> directory.  Production collection writes remain blocked at the API layer.

### Viewing recent run history

```bash
curl https://your-dashboard/api/admin/ingestion/runs?source=galveston&limit=20 \
  -H "Authorization: Bearer $TOKEN"
```

````
