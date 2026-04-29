# Admin UI Staging Write Validation

**Date:** 2026-04-28  
**Stack:** `docker-compose.admin-dev.yml` — api:3001  
**Route:** `POST /api/admin/ingestion/run`  
**Auth method:** `DEV_BYPASS_AUTH=true` — injects synthetic `Admin` user (dev-only; blocked in production via `NODE_ENV` guard)  
**Write mode:** `dry_run=false` → `--no-dry-run` CLI flag → `_StagingDb` proxy → all writes redirected to `v2_*` staging collections  
**Non-dry-run guard:** `ALLOW_ADMIN_NON_DRY_RUN=true` confirmed in container

---

## Container Environment Verification

```
$ docker exec warrant-admin-dev-api-1 printenv | grep -E "DEV_BYPASS|ALLOW_ADMIN|ENABLE_V2|USE_V2|DRY_RUN"
DEV_BYPASS_AUTH=true
ALLOW_ADMIN_NON_DRY_RUN=true
USE_V2_INGESTION=true
ENABLE_V2_GALVESTON=true
ENABLE_V2_HARRIS_REPORTS=true
ENABLE_V2_LOOKUPS=true
DRY_RUN=true
```

Note: `DRY_RUN=true` is the container default for safety. The API route overrides this per-spawn by passing `--no-dry-run` to the Python subprocess and setting `DRY_RUN=false` in the child process env.

---

## API Run Results

| Source           | HTTP   | exit_code | Request params                            | results returned          | stderr               | Notes                                               |
| ---------------- | ------ | --------- | ----------------------------------------- | ------------------------- | -------------------- | --------------------------------------------------- |
| galveston        | 200 ok | 0         | `limit=2 force=true`                      | `stored 2 events`         | —                    | ✅ Wrote to `v2_galveston_events`                   |
| harris_reports   | 200 ok | 0         | `limit=1 force=true`                      | `total records stored: 0` | WARN (advisory only) | ✅ All 7 reports already ingested — idempotent skip |
| fortbend_lookup  | 200 ok | 0         | `limit=2 last_name=SMITH`                 | 2 records printed         | —                    | ✅ Wrote to `v2_lookup_results`                     |
| jefferson_lookup | 200 ok | 0         | `limit=2 last_name=SMITH`                 | 2 records printed         | —                    | ✅ Wrote to `v2_lookup_results`                     |
| brazoria_lookup  | 200 ok | 0         | `limit=2 last_name=SMITH first_name=JOHN` | 2 records printed         | —                    | ✅ Wrote to `v2_lookup_results`                     |

All responses returned `"ok": true, "status": "success"`.

### harris_reports note

The advisory stderr warning `ENABLE_V2_HARRIS_REPORTS is not set — running in dry-run mode only` was present on the first run (before the flag was added). The warning is informational only — `_check_feature_flags()` does not force dry-run; actual mode is controlled by `--no-dry-run` / `DRY_RUN=false` in the child env. After adding `ENABLE_V2_HARRIS_REPORTS=true` to the container the warning is gone. Zero records stored is expected: all available Harris reports were already ingested in the prior CLI validation run.

### jefferson_lookup date-mode note

`booking_date=2025-04-16` returned 0 results (no bookings on that date in the live roster). `last_name=SMITH` returned 2 results successfully.

---

## MongoDB Counts — Before / After UI Runs

| Collection            | Before UI runs | After UI runs | Delta                             |
| --------------------- | -------------- | ------------- | --------------------------------- |
| `v2_galveston_events` | 5              | 5             | +0 (upserts of existing docs)     |
| `v2_harris_reports`   | 508            | 508           | +0 (all reports already ingested) |
| `v2_lookup_results`   | 102            | 115           | **+13 new docs**                  |

The +13 in `v2_lookup_results` are new SMITH-name records from jefferson and brazoria that were not present from the prior CLI runs (which used different search terms).

---

## Staging Safety Confirmation

All writes verified to go to `v2_*` collections only via the `_StagingDb` proxy in `run_ingestion_v2.py`.

**`_STAGING_MAP`:**

```python
galveston_events       → v2_galveston_events
harris_bond            → v2_harris_reports
harris_misfel          → v2_harris_reports
harris_nafiling        → v2_harris_reports
report_manifest        → v2_report_manifest
brazoria_inmates       → v2_lookup_results
fortbend_inmates       → v2_lookup_results
jefferson_events       → v2_lookup_results
galveston_p2c_endpoint → v2_galveston_p2c_endpoint
```

No writes to production collections (`galveston_events`, `harris_bond`, etc.) occurred.

---

## Promotion Readiness API

`GET /api/admin/ingestion/readiness?days=3` returns a per-source + global readiness verdict
computed directly from `ingestion_runs` without spawning a Python subprocess.

```json
{
  "ok": true,
  "evaluated_at": "...",
  "observation_days": 3,
  "global": {
    "overall": "blocked | watch | ready_to_promote",
    "required_sources_ready": false,
    "blocked_sources": ["galveston"],
    "recommendation": "..."
  },
  "sources": [
    {
      "source": "galveston",
      "readiness": "blocked | watch | ready | manual-only",
      "blockers": ["only 0 day(s) with successful runs (need ≥3)"],
      "success_rate": null,
      "days_observed": 0,
      "latest_success": null,
      "avg_records_written": null,
      "duplicate_key_warnings_total": 0
    }
  ]
}
```

Visible in Admin UI under **Scraper Ops → Readiness** tab (no "Promote" button — promotion is manual).

---

## `ingestion_runs` Observation Metrics (added in Session 3)

New fields recorded by `scheduler/audit.py::finish_run()`:

| Field                          | Description                                                                |
| ------------------------------ | -------------------------------------------------------------------------- |
| `records_inserted`             | Docs newly inserted (populated by scraper if available)                    |
| `records_updated`              | Docs updated in-place                                                      |
| `records_skipped`              | Docs skipped (already current, filtered out, etc.)                         |
| `collection_name`              | Staging collection written to                                              |
| `required_field_missing_count` | Docs missing required schema fields                                        |
| `duplicate_key_warnings`       | Duplicate-key write warnings                                               |
| `source_health`                | Optional health annotation from the scraper                                |
| `previous_records_written`     | `records_written` from the previous successful non-dry-run for this source |
| `records_written_delta`        | Difference from previous run (positive = growth, negative = shrink)        |
| `previous_run_id`              | `run_id` of the prior run used for delta computation                       |

Delta fields are only set for `status=success, dry_run=false` runs.

---

## Run History

`GET /api/admin/ingestion/runs` returns 1 entry — a scheduled galveston skip from 2026-04-27. Manual API runs do not create run history entries unless `--respect-schedule` is passed (which is intentional; audit records are for scheduled/production runs).

---

## Auth Bypass Security Notes

`DEV_BYPASS_AUTH=true` is a **dev-only mechanism** with two layers of production protection:

1. `requireAuth` middleware in `apps/dashboard/server/src/middleware/auth.js` hard-checks `process.env.NODE_ENV !== 'production'` before the bypass activates — the bypass is unreachable in production regardless of the env var.
2. `docker-compose.admin-dev.yml` is not used in staging or production deployments.

The bypass must never be set in `.env.staging`, `.env.production`, or render.yaml.

---

## Files Changed During Validation Setup

| File                                           | Change                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/dashboard/server/src/middleware/auth.js` | Added `DEV_BYPASS_AUTH` bypass block at top of `requireAuth`                                                        |
| `.env.admin-dev`                               | Added `DEV_BYPASS_AUTH=true`, `ENABLE_V2_GALVESTON=true`, `ENABLE_V2_HARRIS_REPORTS=true`, `ENABLE_V2_LOOKUPS=true` |
| `docker-compose.admin-dev.yml`                 | Added `ENABLE_V2_HARRIS_REPORTS`, `ENABLE_V2_LOOKUPS` env passthrough to api service                                |
