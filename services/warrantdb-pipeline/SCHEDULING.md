# Scheduling the Warrant Pipeline (twice daily + idempotent writes)

This repo already includes:

- `scripts/run_pipeline.py` orchestrating ingestion ➜ normalize ➜ delta report
- Upserts for persons via `BaseScraper.upsert_person()`
- Normalized \_simple\_\_ collections with stable `_upsert_key` (idempotent)
- Optional audit logs in `scrape_audit`

Below are three production-ready scheduling options. All assume Python 3.11+ and a `.env` with `MONGO_URI` and `MONGO_DB`.

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

````
