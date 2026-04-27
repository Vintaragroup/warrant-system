# Admin Scraper Operations Panel — Discovery

**Date**: 2026-04-27
**Status**: Backend control plane implemented (2026-04-27) — frontend UI pending

## Implementation Status

| Component                   | Status         | Location                                                                 |
| --------------------------- | -------------- | ------------------------------------------------------------------------ |
| `scheduler/config.py`       | ✅ Implemented | `services/warrantdb-pipeline/scheduler/config.py`                        |
| `scheduler/should_run.py`   | ✅ Implemented | `services/warrantdb-pipeline/scheduler/should_run.py`                    |
| `scheduler/audit.py`        | ✅ Implemented | `services/warrantdb-pipeline/scheduler/audit.py`                         |
| `run_ingestion_v2.py`       | ✅ Updated     | Added `--trigger`, `--force`, `--created-by`, `--respect-schedule` flags |
| `routes/adminIngestion.js`  | ✅ Implemented | `apps/dashboard/server/src/routes/adminIngestion.js`                     |
| Route mounted in `index.js` | ✅ Done        | `/api/admin/ingestion` with `requireAuth` + `requireAdmin`               |
| `SCHEDULING.md`             | ✅ Updated     | Mongo scheduler config section added                                     |
| Frontend Admin UI           | ❌ Pending     | See §5 for recommended UI spec                                           |

---

## 1. Current Frontend / Admin Architecture

### Routes (`apps/dashboard/src/App.jsx`)

| Path                     | Component                 | Guard         |
| ------------------------ | ------------------------- | ------------- |
| `/admin`                 | `Admin.jsx`               | `RequireAuth` |
| `/auth/admin-users`      | `AdminUserManagement.tsx` | Session       |
| `/auth/profile-settings` | `ProfileSettings.tsx`     | Session       |

### Admin nav tab gate (`src/layouts/AppLayout.jsx`)

The Admin tab renders only when `currentUser?.roles?.includes('Admin')` is true — **client-side only**. The server currently applies no role check to `/api/dashboard/*` routes beyond `requireAuth`.

### Admin page today (`src/pages/Admin.jsx`)

| Section         | Data                                                   | Wired?                      |
| --------------- | ------------------------------------------------------ | --------------------------- |
| Automation jobs | Hard-coded static array (including `scrape:galveston`) | No — buttons have no action |
| Integrations    | Hard-coded static array                                | No                          |
| Users & roles   | Hard-coded static array                                | No                          |
| Data freshness  | Live via `useCases()` hook                             | Yes                         |

**Finding**: The Admin page is a UI shell. No scraper controls, no real-time status, no scheduling UI, and no backend connection for any automation section exists.

### Auth model (`server/src/middleware/auth.js`)

- Firebase session cookie or Bearer token verified by `requireAuth`
- User profile upserted from MongoDB `users` collection on every request
- `req.user.roles[]` is available for route-level role checks, but **no route currently enforces an Admin role server-side**
- In development, users default to `['Admin']` role (from `User.js` model schema)

### Existing feature flag pattern (`server/src/index.js`)

```js
const USE_TIME_BUCKET_V2 =
  String(process.env.DISABLE_TIME_BUCKET_V2 || "false") === "true"
    ? false
    : true;
app.locals.flags = { USE_TIME_BUCKET_V2 };
```

Read in route handlers via `req.app?.locals?.flags?.USE_TIME_BUCKET_V2`. No runtime mutation path exists.

---

## 2. Current Backend API Architecture

### Server base (`apps/dashboard/server/src/index.js`)

| Mount point      | Router                | Auth          |
| ---------------- | --------------------- | ------------- |
| `/api/health`    | `routes/health.js`    | None          |
| `/api/dashboard` | `routes/dashboard.js` | `requireAuth` |
| `/api/cases`     | `routes/cases.js`     | `requireAuth` |
| `/api/admin`     | ❌ does not exist     | —             |
| `/api/metadata`  | `routes/metadata.js`  | None          |

No `/api/admin` mount point exists. No ingestion, scheduling, or scraper-control endpoints exist.

### Existing health endpoint (`GET /api/health`)

Returns for each `simple_*` collection:

- `count` (estimated)
- `latest_normalized_at`
- `latest_booking_date`
- `missing` field counts
- `warnings[]` (staleness, zero-count, missing fields)
- Redis ping + GPS job heartbeat

Does **not** return:

- scrape run history
- scraper error logs
- v2 staging collection status
- schedule configuration

### `scrape_audit` collection schema (from `ingestion/audited_scraper.py`)

Every `AuditedScraper` run writes one or more documents to `scrape_audit`:

```json
{
  "kind": "scrape_audit",
  "status": "note" | "started" | "completed" | "error",
  "run_id": "galveston:uuid4",
  "county": "Galveston",
  "source": "galveston_jail",
  "started_at": "ISO",
  "ts": "ISO",
  "prefixes_scanned": 0,
  "detail_links_found": 0,
  "details_parsed_ok": 0,
  "upserts_person_inserted": 0,
  "upserts_person_updated": 0,
  "events_yielded": 0,
  "errors": 0,
  "notes": []
}
```

Controlled by `SCRAPER_AUDIT=true` env var (default true). Written by the **legacy** `AuditedScraper` — the v2 `EventFeedScraper` / `ReportIngestor` do **not** inherit from `AuditedScraper` and do not write to `scrape_audit`.

---

## 3. Scraper Schedule Inventory

### Source of truth for scheduling

All Render-managed jobs are defined in `services/warrantdb-pipeline/render.yaml`. There is no runtime scheduler in the application code. Schedule changes **always require a `render.yaml` edit and git push** to take effect. There is no Render API route for dynamically changing cron schedules.

### Legacy pipeline

Defined in `scripts/run_pipeline.py` and `scripts/run_twice_daily.sh`. No Render cron job entries exist for the legacy pipeline in either `render.yaml` or `infra/render/pipeline.render.yaml` — only the background worker (`type: worker`) is defined, which runs `sleep infinity`. The legacy pipeline must be triggered manually or via crontab/systemd (Options A/B from `SCHEDULING.md`).

### V2 staging cron jobs (ALL currently commented out)

| Render cron name            | Schedule (UTC)                             | Sources            | Collection target     | Status                                         |
| --------------------------- | ------------------------------------------ | ------------------ | --------------------- | ---------------------------------------------- |
| `v2-galveston-staging`      | `*/10 13-23,0-4 * * *`                     | `galveston`        | `v2_galveston_events` | ❌ Commented out                               |
| `v2-harris-reports-staging` | `0 6 * * *` (daily at 06:00 UTC = 1 AM CT) | `harris_reports`   | `v2_harris_reports`   | ❌ Commented out                               |
| Fort Bend lookup            | —                                          | `fortbend_lookup`  | `v2_lookup_results`   | 🚫 Intentionally omitted (on-demand only)      |
| Jefferson lookup            | —                                          | `jefferson_lookup` | `v2_lookup_results`   | 🚫 Intentionally omitted (on-demand only)      |
| Brazoria lookup             | —                                          | `brazoria_lookup`  | `v2_lookup_results`   | 🚫 Disabled (network issue pending resolution) |

### Weekend handling

No weekend skip logic exists in any current Render cron schedule or shell script. Galveston's `*/10 13-23,0-4 * * *` runs every day of the week. Harris's `0 6 * * *` runs daily. Weekend skipping would require either a `1-5` day-of-week field in the cron expression or application-level date checks in the runner scripts.

### Key env flags controlling v2 ingestion

| Variable                   | Default | Effect                                           |
| -------------------------- | ------- | ------------------------------------------------ |
| `USE_V2_INGESTION`         | `false` | Master gate — v2 code does not run unless `true` |
| `ENABLE_V2_GALVESTON`      | `false` | Enable Galveston event feed                      |
| `ENABLE_V2_HARRIS_REPORTS` | `false` | Enable Harris report ingestor                    |
| `ENABLE_V2_LOOKUPS`        | `false` | Enable all three lookup scrapers                 |
| `DRY_RUN`                  | `true`  | When `true`, no MongoDB writes occur             |
| `SCRAPER_AUDIT`            | `true`  | Enables `scrape_audit` writes (legacy only)      |

### Can schedules be changed at runtime without redeployment?

**No.** Render cron jobs are defined entirely in `render.yaml`. Changes require:

1. Edit `render.yaml`
2. Commit and push to the deploy branch
3. Render redeploys the service

There is no Render API or webhook available for runtime cron mutation. Any "runtime schedule change" feature in the admin UI would be **configuration-as-data** stored in MongoDB, then consumed by a lightweight in-process scheduler running inside the worker service — Render cron would only need to invoke the worker runner at a fine-grained cadence (e.g., every minute), and the application would decide whether to run based on its own schedule config.

---

## 4. Existing Scraper Audit Data Inventory

| Collection                  | Purpose                                               | Populated by                   | Status                           |
| --------------------------- | ----------------------------------------------------- | ------------------------------ | -------------------------------- |
| `scrape_audit`              | Per-run counters, status, errors                      | `AuditedScraper._audit_emit()` | ✅ Exists — legacy scrapers only |
| `report_manifest`           | Tracks which Harris report files have been downloaded | `ReportIngestor`               | ✅ Exists — legacy               |
| `v2_report_manifest`        | Same, for v2 staging Harris runs                      | `run_ingestion_v2.py`          | ✅ Exists when v2 Harris is run  |
| `v2_galveston_events`       | Staging output for v2 Galveston                       | `GalvestonP2CEventFeed`        | ✅ ~5 docs (low volume)          |
| `v2_harris_reports`         | Staging output for v2 Harris                          | `HarrisReportIngestor`         | Unknown                          |
| `v2_lookup_results`         | Staging output for all lookup scrapers                | `*Lookup.lookup()`             | Unknown                          |
| `v2_galveston_p2c_endpoint` | Galveston POST endpoint cache                         | `GalvestonP2CEventFeed`        | Present                          |
| Admin config collection     | Scraper schedules, flags                              | Nothing                        | ❌ Does not exist                |

### What `scrape_audit` contains today

- `AuditedScraper` subclasses (legacy `BrazoriaLookup`, `FortBendLookup`, `JeffersonLookup`) write to it
- Fields: `run_id`, `county`, `source`, `started_at`, `ts`, `status`, counters, `notes[]`
- V2 `EventFeedScraper` / `ReportIngestor` do **not** write here — v2 runs produce no audit trail

### What is missing for the admin panel

- V2 run history (no `scrape_audit` writes from v2 scrapers)
- Per-run record count deltas (how many new docs were upserted vs updated)
- Error messages with stack traces for UI display
- Schedule configuration persistence
- Last-success vs last-attempt distinction for each source
- Staging vs production collection status per source

---

## 5. Recommended Admin Scraper Operations Panel UI

### Location

`/admin` route → `Admin.jsx` — add a new tab or section group.

Suggested tab structure (nav pills inside the Admin page):

```
[ Overview ]  [ Manual Run ]  [ Daily Monitor ]  [ Scheduler ]  [ Source Controls ]
```

### 5.1 Overview Tab

One card per source. Sources: `galveston`, `harris`, `fortbend`, `jefferson`, `brazoria`.

| Column               | Source                                      | Notes                                            |
| -------------------- | ------------------------------------------- | ------------------------------------------------ |
| Source               | `galveston`                                 |                                                  |
| Enabled              | ✅ / ❌                                     | From admin config collection                     |
| Collection (current) | `simple_galveston` or `v2_galveston_events` |                                                  |
| Schedule             | `*/10 13-23,0-4 * * *`                      | From admin config                                |
| Next run (approx)    | 2026-04-27 14:10 UTC                        | Derived client-side from cron expression         |
| Last run             | 3h ago                                      | From `scrape_audit` or v2 audit log              |
| Last success         | 3h ago                                      |                                                  |
| Last error           | 2d ago — "Connection timeout"               |                                                  |
| Records (total)      | 8,412                                       | From collection count                            |
| Records (last run)   | +47                                         | From audit delta                                 |
| Stale                | ⚠ / ✅                                      | Based on `check_v2_staging_health.py` thresholds |
| Staging              | Active / Inactive                           | v2 cron enabled?                                 |

### 5.2 Manual Run Tab

```
Source:         [ Galveston ▾ ]
Dry run:        [✅ Enabled (safe)]
Limit:          [ 20  ]
Last name:      [           ] (lookup scrapers only)
First name:     [           ] (lookup scrapers only)

[ Preview run command ]

[ Run scraper ]  ← disabled unless Admin role

Output console:
┌─────────────────────────────────────────────────────┐
│ [galveston] dry-run — fetching events (limit=20)    │
│ [galveston] fetched 83 raw rows                     │
│   [OK] { full_name: ..., booking_number: ..., ... } │
│ [galveston] dry-run summary: ok=20 warn=0 skip=0    │
└─────────────────────────────────────────────────────┘
```

**Safety rules**:

- Non-dry-run requires a confirmation modal: "This will write to [collection]. Are you sure?"
- Non-dry-run requires `USE_V2_INGESTION=true` on the pipeline service — surface a warning if not set
- Production collection writes blocked from UI initially (staging writes only)
- Output streamed via SSE or WebSocket from the pipeline worker API

### 5.3 Daily Monitor Tab

Table with one row per (source × day) for the past 14 days:

| Date       | Source    | Runs | Success | Failed | Records written | Last error     |
| ---------- | --------- | ---- | ------- | ------ | --------------- | -------------- |
| 2026-04-27 | galveston | 144  | 144     | 0      | +1,240          | —              |
| 2026-04-27 | harris    | 1    | 1       | 0      | +86             | —              |
| 2026-04-26 | galveston | 0    | 0       | 0      | 0               | ⚠ Weekend skip |

Summary widgets:

- Stale sources (> threshold since last success)
- Sources with errors in last 24h
- Sources with zero records in last run

### 5.4 Scheduler Tab

**Read-only display** (since Render cron cannot be mutated at runtime):

```
Source:         [ Galveston ▾ ]

Current schedule:   */10 13-23,0-4 * * *  (every 10 min, 8 AM–11 PM CT)
Timezone:           America/Chicago (CT)
Frequency:          every 10 minutes
Days of week:       Mon Tue Wed Thu Fri Sat Sun
Skip weekends:      No
Next 3 runs:        2026-04-27 14:10 UTC, 14:20 UTC, 14:30 UTC

Proposed config (stored in MongoDB — takes effect via in-app scheduler):
  Frequency:        [ Every 10 min ▾ ]
  Time window:      [ 08:00 ] to [ 23:00 ]  CT
  Days of week:     [✅ Mon] [✅ Tue] ... [☐ Sat] [☐ Sun]
  Max runs per day: [ 96  ]
  Skip weekends:    [✅]
  Paused:           [☐]

  [ Save schedule ]   [ Revert to Render default ]

⚠ Render cron runs this job on its own schedule.
  For runtime schedule changes, enable the in-app scheduler (see docs).
```

### 5.5 Source Controls Tab

```
Galveston read source
  ○ Legacy: simple_galveston     (current)
  ● V2:     v2_galveston_events

  V2 staging:  ⚠ Not enabled (0 recent docs)
               Enable v2-galveston-staging cron first

  ⚠ Switching to V2 will affect all dashboard aggregations.
     Ensure v2 staging has ≥100 recent documents before enabling.

  [ Enable V2 reads ]   (disabled until prerequisites met)

Harris
  Read source:  simple_harris  (legacy normalized)  — no v2 read path yet

Brazoria / Fort Bend / Jefferson
  Read source:  simple_* (legacy)  — on-demand lookup only
```

---

## 6. Persistence Strategy

### Recommendation: Hybrid (env defaults + MongoDB config collection)

| Layer                              | What is stored                                                                 | When it takes effect                     |
| ---------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `render.yaml` env vars             | Master feature flags (`USE_V2_INGESTION`, `ENABLE_V2_*`), Render cron schedule | Redeploy required                        |
| `app.locals.flags` (server memory) | Runtime overrides (read-source toggles)                                        | Immediately, reverts on restart          |
| `admin_config` MongoDB collection  | Schedule config, pause/resume state, audit trail                               | Immediately (polled by in-app scheduler) |

#### `admin_config` document shape (one doc per source):

```json
{
  "_id": "scraper:galveston",
  "source": "galveston",
  "enabled": true,
  "paused": false,
  "schedule": {
    "cron": "*/10 * * * *",
    "timezone": "America/Chicago",
    "skip_weekends": false,
    "max_runs_per_day": 96,
    "active_window_start": "08:00",
    "active_window_end": "23:00"
  },
  "read_source": "simple_galveston",
  "v2_read_enabled": false,
  "updated_at": "2026-04-27T14:00:00Z",
  "updated_by": "uid_of_admin_user",
  "notes": "Enabled by Ryan 2026-04-27"
}
```

### Why not env-only?

Env-only flags require a Render redeploy for every schedule or toggle change. This is acceptable for permanent promotions but is too slow for operational responses (e.g., pause a scraper because a source site is down).

### Why not Render cron mutation at runtime?

Render does not expose a public API for mutating cron schedules on deployed services. All Render cron changes go through `render.yaml` → git push → redeploy. Treat Render cron as the "floor cadence" (e.g., every minute) and let the in-app scheduler decide whether to actually run.

### In-app scheduler (future)

For true runtime schedule control, the `warrant-pipeline` worker service (currently `sleep infinity`) should be converted to a lightweight polling loop:

```python
# worker/main.py (not yet implemented)
while True:
    config = db['admin_config'].find({})
    for source in config:
        if should_run_now(source):
            run_source(source)
    time.sleep(60)
```

This allows all schedule parameters to be changed via the admin UI without touching `render.yaml`.

---

## 7. Recommended API Endpoints

All endpoints under `/api/admin` — require `requireAuth` + server-side Admin role check.

### 7.1 Ingestion Status

```
GET /api/admin/ingestion/status

Response 200:
{
  "sources": [
    {
      "source": "galveston",
      "enabled": true,
      "paused": false,
      "schedule_cron": "*/10 13-23,0-4 * * *",
      "collection_live": "simple_galveston",
      "collection_staging": "v2_galveston_events",
      "v2_read_enabled": false,
      "last_run_at": "2026-04-27T11:00:00Z",
      "last_success_at": "2026-04-27T11:00:00Z",
      "last_error_at": null,
      "last_error_msg": null,
      "staging_doc_count": 5,
      "staging_latest_ingested_at": "2026-04-27T10:50:00Z",
      "staging_stale": false,
      "live_doc_count": 8412
    }
  ],
  "ts": "2026-04-27T14:00:00Z"
}
```

### 7.2 Run History

```
GET /api/admin/ingestion/runs?source=galveston&limit=50&since=2026-04-20

Response 200:
{
  "runs": [
    {
      "run_id": "galveston:uuid",
      "source": "galveston",
      "county": "Galveston",
      "started_at": "2026-04-27T11:00:00Z",
      "ts": "2026-04-27T11:01:15Z",
      "status": "completed",
      "detail_links_found": 250,
      "upserts_person_inserted": 12,
      "upserts_person_updated": 38,
      "events_yielded": 50,
      "errors": 0,
      "notes": []
    }
  ]
}
```

Data source: `scrape_audit` collection (legacy) + new v2 audit collection.

### 7.3 Trigger Manual Run

```
POST /api/admin/ingestion/run

Body:
{
  "source": "galveston",
  "dry_run": true,
  "limit": 20,
  "last_name": "",
  "first_name": ""
}

Response 200 (dry-run, immediate output):
{
  "ok": true,
  "dry_run": true,
  "source": "galveston",
  "output": "[galveston] dry-run — fetching events (limit=20)\n...",
  "records_sampled": 20,
  "warnings": 0,
  "run_id": null
}

Response 202 (non-dry-run, async):
{
  "ok": true,
  "dry_run": false,
  "source": "galveston",
  "run_id": "galveston:uuid",
  "status_url": "/api/admin/ingestion/runs/galveston:uuid"
}
```

**Safety constraint**: `dry_run: false` rejected unless `"galveston"` maps to a staging collection. Production writes blocked at API layer.

### 7.4 Error Log

```
GET /api/admin/ingestion/errors?source=galveston&limit=25

Response 200:
{
  "errors": [
    {
      "run_id": "galveston:uuid",
      "source": "galveston",
      "ts": "2026-04-25T08:10:00Z",
      "status": "error",
      "msg": "Connection timeout after 30s",
      "errors": 3
    }
  ]
}
```

### 7.5 Config Read/Write

```
GET /api/admin/ingestion/config?source=galveston

Response 200:
{
  "source": "galveston",
  "enabled": true,
  "paused": false,
  "v2_read_enabled": false,
  "schedule": { ... },
  "updated_at": "...",
  "updated_by": "uid"
}

POST /api/admin/ingestion/config
Body: { "source": "galveston", "v2_read_enabled": false, "paused": false }

Response 200:
{ "ok": true, "source": "galveston", "updated": { ... } }
```

### 7.6 Schedule Read/Write

```
GET /api/admin/ingestion/schedules

Response 200:
{
  "schedules": [
    {
      "source": "galveston",
      "cron": "*/10 13-23,0-4 * * *",
      "timezone": "America/Chicago",
      "skip_weekends": false,
      "max_runs_per_day": 96,
      "paused": false,
      "render_managed": true,
      "render_cron_note": "Defined in render.yaml — runtime cron expression changes stored in admin_config but Render cadence unchanged until redeploy."
    }
  ]
}

POST /api/admin/ingestion/schedules
Body:
{
  "source": "galveston",
  "skip_weekends": true,
  "max_runs_per_day": 48,
  "active_window_start": "09:00",
  "active_window_end": "21:00"
}

Response 200: { "ok": true, "source": "galveston", "updated": { ... } }

POST /api/admin/ingestion/schedules/:source/pause
Body: {}
Response 200: { "ok": true, "source": "galveston", "paused": true }

POST /api/admin/ingestion/schedules/:source/resume
Body: {}
Response 200: { "ok": true, "source": "galveston", "paused": false }
```

### 7.7 Feature Flags

```
GET  /api/admin/flags
POST /api/admin/flags

(See galveston-v2-admin-toggle-discovery.md for full spec)
```

---

## 8. Security Review

### Auth gaps to address

| Gap                       | Current state                       | Fix needed                                                                |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------- | --- | ---- |
| Admin role gate on server | **Not enforced** — client-side only | Add `requireAdmin` middleware: `req.user?.roles?.includes('Admin')        |     | 403` |
| `/api/admin/*` mount      | Does not exist                      | Register with `requireAuth` + `requireAdmin`                              |
| Manual run endpoint       | Does not exist                      | Block `dry_run: false` to production collections at API layer             |
| Schedule mutation         | Does not exist                      | Write audit log entry for every change                                    |
| Run output in console     | Not implemented                     | Never include `MONGO_URI`, credentials, or raw exception stacks in output |

### Dangerous action controls

| Action                        | Required safeguard                                                               |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Non-dry-run manual trigger    | Confirmation modal in UI + server-side check that target is a staging collection |
| V2 read toggle ON             | Prerequisite check: staging doc count ≥ threshold                                |
| Pause a scraper               | Confirmation modal                                                               |
| Delete/reset audit data       | Not supported from UI — ops/DBA only                                             |
| Expose `scrape_audit` details | Redact field values that might contain PII or credentials                        |

### Schedule change audit trail

Every write to `admin_config` should record:

```json
{
  "updated_at": "ISO",
  "updated_by": "uid",
  "change": { "field": "skip_weekends", "from": false, "to": true }
}
```

Or append to an `admin_audit` collection for a full change log.

### Production write protection

The pipeline is architecturally prevented from writing to production collections through:

1. `_StagingDb` proxy in `run_ingestion_v2.py` (redirects all writes)
2. `USE_V2_INGESTION` master gate
3. `DRY_RUN` default true

The admin UI should **never pass `dry_run: false` when the target resolves to a production collection name**. The API endpoint must enforce this independently of the UI.

---

## 9. Rollout Plan

### Phase 1 — Backend only (no UI changes)

1. Create `apps/dashboard/server/src/routes/admin.js` — `GET/POST /api/admin/flags` (from previous discovery).
2. Add `requireAdmin` middleware.
3. Add `GET /api/admin/ingestion/status` reading from `scrape_audit` + v2 collection counts.
4. Add `GET /api/admin/ingestion/runs` reading from `scrape_audit`.
5. Create `admin_config` collection with seed documents for all 5 sources.
6. Add `GET/POST /api/admin/ingestion/config` backed by `admin_config`.

### Phase 2 — Admin UI: Overview + Source Controls

1. Replace static `JOBS` array in `Admin.jsx` with live data from `GET /api/admin/ingestion/status`.
2. Add Source Controls section for Galveston V2 read toggle.
3. Wire "Run health check" button to `GET /api/health`.

### Phase 3 — Manual Run Panel

1. Add Manual Run tab to Admin page.
2. Implement `POST /api/admin/ingestion/run` (dry-run only initially).
3. Stream output via SSE or WebSocket.
4. Add confirmation modal for non-dry-run.
5. Enable non-dry-run to staging collections only after Phase 1 validation.

### Phase 4 — Daily Monitor + Scheduler Config

1. Add `GET /api/admin/ingestion/runs` daily aggregation view.
2. Add Scheduler Config tab (read-only for Render-managed schedules; editable for `admin_config` fields like `skip_weekends`, `max_runs_per_day`).
3. Add `pause/resume` endpoints and UI controls.

### Phase 5 — In-app scheduler (optional, future)

Convert the `warrant-pipeline` worker from `sleep infinity` to a polling loop that reads `admin_config` and enforces runtime schedule parameters including weekend skips.

---

## 10. Risks and Safeguards

| Risk                                                     | Severity | Safeguard                                                                                 |
| -------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Admin page triggers write to production collection       | Critical | Block non-staging targets at API level; never pass production collection names from UI    |
| Schedule change takes effect in Render cron (impossible) | Medium   | Surface clear label: "Render cron is fixed — runtime fields only affect in-app scheduler" |
| `scrape_audit` has no v2 records                         | High     | Phase 1 adds v2 audit writes before UI reads are built                                    |
| Manual run hangs / times out                             | Medium   | Apply `MAX_DB_MS` timeout to run endpoint; stream partial output                          |
| Non-Admin user accesses admin API                        | High     | Add server-side `requireAdmin` middleware in Phase 1                                      |
| Leaked credentials in run output                         | Critical | Strip env vars, tokens, and connection strings from console output                        |
| `admin_config` collection unavailable                    | Low      | Fall back to env-based defaults if collection is empty                                    |
| V2 toggle enabled with too few docs                      | High     | Require minimum document count check before allowing toggle                               |
| Admin role assigned too broadly                          | Medium   | Only assign Admin role explicitly; dev default is Admin (dev only)                        |

---

## 11. Validation Checklist

Before any phase goes to production:

**Phase 1 (backend)**

- [ ] `GET /api/admin/ingestion/status` returns 200 for Admin user, 403 for non-Admin
- [ ] `scrape_audit` query returns ≥1 legacy result for `source: galveston_jail`
- [ ] `admin_config` seed documents created for all 5 sources
- [ ] No credentials appear in any API response body

**Phase 2 (UI overview)**

- [ ] Admin page shows live job status (not static)
- [ ] Non-Admin user does not see Admin tab
- [ ] Non-Admin API call returns 403

**Phase 3 (manual run)**

- [ ] Dry-run executes without MongoDB writes (verified via `_NullDb`)
- [ ] Confirmation modal appears before non-dry-run
- [ ] Non-staging target rejected by API
- [ ] Output console does not display `MONGO_URI` or auth tokens

**Phase 4 (scheduler)**

- [ ] `pause` sets `paused: true` in `admin_config`; `resume` reverts
- [ ] Schedule change writes audit log entry
- [ ] UI shows clear warning: Render cron schedule requires redeploy to change
- [ ] `skip_weekends: true` is respected by in-app scheduler (if Phase 5 complete)
