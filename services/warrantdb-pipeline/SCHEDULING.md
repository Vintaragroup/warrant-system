# Scheduling the Warrant Pipeline (twice daily + idempotent writes)

This repo already includes:

- `scripts/run_pipeline.py` orchestrating ingestion ➜ normalize ➜ delta report
- Upserts for persons via `BaseScraper.upsert_person()`
- Normalized _simple\__ collections with stable `_upsert_key` (idempotent)
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

## V2 Ingestion Experimental Jobs

These jobs run the new three-layer ingestion architecture (`ingestion/event_feeds/`,
`ingestion/reports/`, `ingestion/lookups/`).  **All flags default to false or
dry-run** — no v2 code runs in production unless explicitly enabled.

### Feature flags

| Variable | Default | Description |
|---|---|---|
| `USE_V2_INGESTION` | `false` | Master gate — required for non-dry-run writes |
| `ENABLE_V2_GALVESTON` | `false` | Enable `GalvestonP2CEventFeed` |
| `ENABLE_V2_HARRIS_REPORTS` | `false` | Enable `HarrisReportIngestor` |
| `ENABLE_V2_LOOKUPS` | `false` | Enable all three lookup scrapers |
| `DRY_RUN` | `true` | Print records; suppress MongoDB writes |

### Staging collections (non-dry-run writes)

| Source | Staging collection |
|---|---|
| Galveston | `v2_galveston_events` |
| Harris | `v2_harris_reports` |
| All lookups | `v2_lookup_results` |
| Harris manifest | `v2_report_manifest` |

Production collections are **never** written to by `run_ingestion_v2.py`.

### Dry-run exploration (no flags needed)

> **Note:** Run from `services/warrantdb-pipeline/` with `PYTHONPATH=$PWD` so the
> `ingestion/` and `storage/` packages are importable (same requirement as all other
> pipeline scripts).

```bash
cd services/warrantdb-pipeline

# Galveston P2C — print first 5 normalized events, no DB writes
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source galveston --dry-run --limit 5

# Harris District Clerk — download and normalize 1 report
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source harris_reports --dry-run --limit 1

# Fort Bend lookup — search and print results
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name SMITH --dry-run

# Jefferson lookup
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source jefferson_lookup --last-name SMITH --dry-run

# Brazoria lookup (requires both names)
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source brazoria_lookup --last-name SMITH --first-name JOHN --dry-run
````

### Staging writes (requires master gate)

```bash
# Enable and write to staging collections
USE_V2_INGESTION=true DRY_RUN=false ENABLE_V2_GALVESTON=true \
  PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source galveston --limit 100

USE_V2_INGESTION=true DRY_RUN=false ENABLE_V2_HARRIS_REPORTS=true \
  PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source harris_reports --limit 5

USE_V2_INGESTION=true DRY_RUN=false ENABLE_V2_LOOKUPS=true \
  PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name RODRIGUEZ
```

### Crontab examples (nightly, off-peak)

```cron
# Galveston P2C — every 15 min during business hours (dry-run until promoted)
*/15 8-22 * * * cd /opt/warrantdb-pipeline && \
  PYTHONPATH=$PWD DRY_RUN=true python3 scripts/run_ingestion_v2.py --source galveston --limit 200 \
  >> logs/v2_galveston.$(date +\%F).log 2>&1

# Harris reports — nightly at 3 AM
0 3 * * * cd /opt/warrantdb-pipeline && \
  PYTHONPATH=$PWD USE_V2_INGESTION=true DRY_RUN=false ENABLE_V2_HARRIS_REPORTS=true \
  python3 scripts/run_ingestion_v2.py --source harris_reports --limit 10 \
  >> logs/v2_harris.$(date +\%F).log 2>&1
```

### Offline smoke test

Run this before deploying any v2 code change. No network required unless `--live` is passed.

```bash
cd services/warrantdb-pipeline
PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py          # offline schema checks
PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py --live   # also run real network lookups
```

### Render Cron Jobs (staging promotion path)

When v2 jobs are ready to run in production on Render:

```yaml
# render.yaml — add under services:
- type: cron
  name: v2-galveston-ingest
  schedule: "*/15 8-22 * * *"
  buildCommand: pip install -r requirements.txt
  startCommand: python3 scripts/run_ingestion_v2.py --source galveston --limit 500
  envVars:
    - key: USE_V2_INGESTION
      value: "true"
    - key: DRY_RUN
      value: "false"
    - key: ENABLE_V2_GALVESTON
      value: "true"
```
