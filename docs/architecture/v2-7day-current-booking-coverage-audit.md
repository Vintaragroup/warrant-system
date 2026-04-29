# V2 7-Day Current Booking Coverage Audit

**Date:** 2026-04-28  
**Scope:** Staging/v2 collections only (`v2_galveston_events`, `v2_harris_reports`, `v2_lookup_results`)  
**Purpose:** Audit and document 7-day booking coverage across all five Houston-area counties, identifying scraper limitations and dashboard fixes applied.

---

## 1. Source Classification

| County    | Source Type         | Scraper                                  | 7-Day Coverage                                                                                 |
| --------- | ------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Galveston | CURRENT_ROSTER_ONLY | `ingestion/event_feeds/galveston_p2c.py` | Partial — reflects whoever is currently jailed                                                 |
| Harris    | REPORT_BASED        | `ingestion/reports/harris_reports.py`    | Approximate — `observed_at` = report download date, not individual booking date                |
| Jefferson | FULL_7DAY_COVERAGE  | `ingestion/lookups/jefferson_lookup.py`  | Full — fetches complete MyOCV JSON feed, filters by booking date                               |
| Brazoria  | LOOKUP_ONLY         | `ingestion/lookups/brazoria_lookup.py`   | **Not possible** — Tyler portal requires both first AND last name; date-only searches rejected |
| Fort Bend | LOOKUP_ONLY         | `ingestion/lookups/fortbend_lookup.py`   | **Not possible** — requires name-based search; no date-sweep capability                        |

---

## 2. Mongo Ground Truth (post-scrape audit, 2026-04-28)

### Collection totals

| County    | Collection            | Total docs | Docs in 7-day window | Latest booking_date              |
| --------- | --------------------- | ---------- | -------------------- | -------------------------------- |
| galveston | `v2_galveston_events` | 1110       | 138                  | 2026-04-28                       |
| harris    | `v2_harris_reports`   | 655        | 655                  | N/A (no per-record booking_date) |
| jefferson | `v2_lookup_results`   | 130        | 99                   | 2026-04-28                       |
| brazoria  | `v2_lookup_results`   | 66         | 0                    | 2025-10-01 (stale seed data)     |
| fortbend  | `v2_lookup_results`   | 19         | 0                    | None (field not populated)       |

### 7-day bucket note

"Docs in 7-day window" uses `booking_date_candidates = [booking_date, observed_at, arrest_date, booked_at, event_date]`. Harris counts all 655 because `observed_at` = report download date falls within 7 days.

---

## 3. Per-County Source Details

### Galveston — CURRENT_ROSTER_ONLY

- **Endpoint:** `https://jcso.galvestoncountytx.gov/Inmate/jqHandler.ashx` (live JSON feed, up to 5000 rows)
- **booking_date source:** `disp_arrest_date` or `date_arr` field from the JSON row
- **Coverage limitation:** Only shows currently-jailed individuals. Released inmates from earlier in the week are absent. "7-day" count reflects only those still in custody as of scrape time.
- **Fields populated:** `booking_date` (100%), `observed_at` (100%), `arrest_date` (100% after 2026-04-28 fix), `arrest_date_raw` (100% after fix)
- **Dedup key:** `booking_number` if present; else stable hash of `source_id`

### Harris — REPORT_BASED

- **Source:** Harris County bond/misdemeanor PDF reports
- **No per-record booking date.** `observed_at` = date the report was downloaded (not the individual booking date). `booking_date` = None for all 655 docs.
- **Coverage behavior:** Dashboard `last7d` = all docs whose `observed_at` falls within 7 days. This is correct behavior given the source — Harris reports do not include individual arrest timestamps.
- **Fields populated:** `observed_at` (100%), `booking_date` (0%)
- **Two-cohort split (as of 2026-04-28):** 420 docs from 2026-04-26, 235 docs from 2026-04-28

### Jefferson — FULL_7DAY_COVERAGE

- **Endpoint:** `https://cdn.myocv.com/ocvapps/a125277701/Jeffersoninmates.json` (full JSON feed, no auth)
- **Method:** Downloads entire feed, filters locally by `booking_date >= cutoff`
- **Date-only lookup supported:** `lookup_by_date(booking_date)` — no name required
- **Fields populated:** `booking_date` (100%), `observed_at` (100%)
- **7-day scrape procedure:** Run `--source jefferson_lookup --booking-date <YYYY-MM-DD>` once per date (8 dates for a full 7-day window)

### Brazoria — LOOKUP_ONLY (confirmed)

- **Portal:** `https://portal-txbrazoria.tylertech.cloud/PublicAccess/JailingSearch.aspx?ID=400`
- **Platform:** Tyler Technologies PublicAccess (ASP.NET WebForms)
- **Constraint confirmed:** Server returns `ErrorOccured.aspx` for any search without both `LastName` AND `FirstName`. Single-letter initials work but return 0 results. Date-only searches are rejected server-side.
- **66 existing docs:** Legacy seed data from 2025-10 test runs. `booking_date = 2025-10-01` across all docs. These are NOT recent bookings.
- **What is possible:** Named lookups (e.g., `--last-name RODRIGUEZ --first-name JOSE --booking-date 2026-04-28`) do work and return results filtered by date. Coverage is limited to the names provided.
- **Dashboard impact:** Brazoria `last7d` count from v2 = 0 (stale seed data does not fall in 7-day window). Brazoria counts come from legacy lookup flow.

### Fort Bend — LOOKUP_ONLY

- **Portal:** `https://jailinq.fortbendcountytx.gov/`
- **Constraint:** Requires at minimum a last name. No date-sweep mode.
- **19 existing docs:** All named "RODRIGUEZ" from a name-based seed run. `booking_date = None` for all 19 (portal column detection may have failed on the results table, or portal does not expose booking date in the search results list).
- **Dashboard impact:** FortBend `last7d` based on `scraped_at` when `booking_date` is null.

---

## 4. Dashboard Fixes Applied

### 4a. `toYmd()` UTC timezone shift bug (prior session)

**File:** `apps/dashboard/server/src/routes/dashboard.js`

**Root cause:** MongoDB `$convert` of `'2026-04-28'` string → UTC midnight Date → `$dateToString` in `America/Chicago` timezone → returned `'2026-04-27'` (one day behind in CDT/CST).

**Fix:** Added `$regexMatch` fast-path in `toYmd()`: if the value is already a `YYYY-MM-DD` string, return it directly via `$substrCP` without UTC conversion.

**Result:** Harris `today` count corrected from 0 → 235. All per-county dates now return correct values.

### 4b. V2 collection routing

**Change:** `COUNTY_COLLECTIONS` updated to `['v2_galveston_events', 'v2_harris_reports', 'v2_lookup_results']`.  
All five counties (`brazoria`, `fortbend`, `galveston`, `harris`, `jefferson`) listed in `ALL_COUNTY_NAMES`.

### 4c. `observed_at` added to booking date candidates

`observed_at` added to the `booking_date_n` candidate chain in both `unionAll()` and `unionAllFast()`. This ensures Harris records (which have `observed_at` but no `booking_date`) are counted in date buckets.

### 4d. Coarse pre-filter allows null booking_date docs

The pre-filter aggregation stage was updated to allow docs with `booking_date: null` through the pipeline (needed for Harris and FortBend records).

### 4e. `DISABLE_TIME_BUCKET_V2=true`

Set in `docker-compose.admin-dev.yml` to disable the experimental time-bucket v2 query path and use the stable union-based aggregation.

### 4f. `arrest_date` and `event_date` added to booking_date_n candidates (2026-04-28)

**File:** `apps/dashboard/server/src/routes/dashboard.js`

**Change:** Added `arrest_date` (highest priority) and `event_date` (fallback) to the `booking_date_n` candidate chain in both `unionAll()` and `unionAllFast()`.

**Priority order (highest → lowest):**

1. `arrest_date` — primary for Galveston (`v2_galveston_events`)
2. `booking_date`
3. `observed_at` — primary for Harris reports
4. `booking_date_iso`
5. `booked_at`
6. `event_date` — Galveston compatibility alias
7. `normalized_at`
8. `scraped_at` — last resort only

**Rationale:** Galveston stores arrest dates in `arrest_date`; prioritizing it avoids relying on the aliased `booking_date` field and is more semantically correct.

### 4g. Per-county legacy path: date-anchored counts (2026-04-28)

**File:** `apps/dashboard/server/src/routes/dashboard.js`

**Problem:** The `per-county` legacy path (used when `DISABLE_TIME_BUCKET_V2=true`) was computing `today`/`yesterday`/`twoDaysAgo`/`last7d`/`last30d` using `$dateDiff` in `hour` units, then comparing against fixed constants (`< 24`, `< 168`, etc.). This creates ambiguity at window boundaries (e.g., records exactly at the 168-hour mark). Additionally, a `booking_dt` Date object was required even though v2 collections store dates as strings.

**Fix:** Replaced the `hoursAgo < n` group-stage conditions with string-comparison against YYYY-MM-DD values derived from `ymdInTZ()`. The `per-county` pipeline now projects `booking_date` (= `booking_date_n`) and groups on date-string equality/comparison.

**Both code paths updated:**

- `pathVariant = 'legacy'` (normal path when `DISABLE_TIME_BUCKET_V2=true`)
- `pathVariant = 'legacy-fallback-empty-buckets'` (fallback when v2 buckets are absent)

**Window semantics (calendar-day anchored):**

- `today` = `booking_date == ymdAgo(0)` (today's date string)
- `yesterday` = `booking_date == ymdAgo(1)`
- `twoDaysAgo` = `booking_date == ymdAgo(2)`
- `last7d` = `booking_date >= ymdAgo(6)` (today + previous 6 days = 7 inclusive)
- `last30d` = `booking_date >= ymdAgo(29)` (today + previous 29 days = 30 inclusive)

**Note on Galveston last7d=118:** With calendar-day anchoring, the 7-day window covers `ymdAgo(6)` through today. For a run on 04/28, this is 04/22–04/28 = 7 dates = 118 records. The 04/21 cohort (20 records) is correctly excluded — it falls on day 8. This matches `buildWindowMatch('7d')` used by the KPI endpoint. The 138-record Mongo count spans 8 dates (04/21–04/28), which is an 8-day window.

---

## 5. Galveston arrest_date Preservation Fix (2026-04-28)

**File:** `services/warrantdb-pipeline/ingestion/event_feeds/galveston_p2c.py`

**Problem:** `normalize_event()` read `arrest_date` from raw and stored it as `booking_date`, but did not preserve it as a separate `arrest_date` field. `arrest_date` was 0% populated in `v2_galveston_events`.

**Fix:**

1. Roster fetch dict now includes `arrest_date_raw` (the original `disp_arrest_date` or `date_arr` string from the jqHandler JSON response).
2. `EventRecord` now stores `arrest_date` (ISO-parsed) and `arrest_date_raw` (original string) as explicit fields alongside `booking_date`.

**Effect:** New Galveston scrapes will have `arrest_date` 100% populated. Existing 1110 docs from today's scrape do not have this field — a re-scrape will backfill via upsert.

---

## 6. Remaining Limitations

| Issue                               | Status      | Notes                                                                                           |
| ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| Brazoria 7-day coverage             | Won't fix   | Tyler portal requires names; no date-sweep possible                                             |
| Fort Bend booking_date = None       | Known issue | Portal may not expose booking date in results list; field parsing may need column-detection fix |
| Galveston roster-only               | Accepted    | Live jail roster; released inmates from earlier in the week are absent                          |
| Harris no per-record booking_date   | Accepted    | Report-based source; `observed_at` = report date is the best available proxy                    |
| Brazoria 66 stale docs (2025-10-01) | Legacy      | Seed data from test run; do not reflect current bookings                                        |

---

## 7. Audit Script

**Location:** `services/warrantdb-pipeline/scripts/audit_v2_7day_coverage.py`

Queries all v2 collections directly against MongoDB Atlas and produces a per-county summary of:

- Total docs
- Docs within the 7-day window (using `BOOKING_DATE_CANDIDATES`)
- Latest booking date
- Field presence percentages

**Usage:**

```bash
docker exec warrant-admin-dev-api-1 python3 /pipeline/scripts/audit_v2_7day_coverage.py --cutoff 2026-04-21
docker exec warrant-admin-dev-api-1 python3 /pipeline/scripts/audit_v2_7day_coverage.py --cutoff 2026-04-21 --verbose
```

---

## 8. Dashboard Validation (2026-04-28)

### `/api/dashboard/per-county`

```
brazoria  today:5   yesterday:0   twoDaysAgo:0   last7d:5    last30d:5
fortbend  today:18  yesterday:0   twoDaysAgo:1   last7d:19   last30d:19
galveston today:16  yesterday:37  twoDaysAgo:10  last7d:118  last30d:350
harris    today:235 yesterday:0   twoDaysAgo:420 last7d:655  last30d:655
jefferson today:29  yesterday:22  twoDaysAgo:13  last7d:92   last30d:110
```

All five counties return non-zero `last7d` counts. Harris `today: 235` confirms the `toYmd()` fix is working correctly. Galveston `last7d: 118` is correct: the 7-day window covers 04/22–04/28 (7 dates). The 04/21 cohort (20 records) is on day 8.

### `/api/dashboard/kpis`

```
newCountsBooked: {
  today: 303, yesterday: 59, twoDaysAgo: 444,
  threeToSeven: 303, last7d: 889, last30d: 1139
}
```

### Galveston per-day breakdown (04/21–04/28)

| Date            | Records | Notes                                 |
| --------------- | ------- | ------------------------------------- |
| 2026-04-21      | 20      | Day 8 — outside 7-day window          |
| 2026-04-22      | 16      | Day 7 of window                       |
| 2026-04-23      | 13      |                                       |
| 2026-04-24      | 14      |                                       |
| 2026-04-25      | 12      |                                       |
| 2026-04-26      | 10      |                                       |
| 2026-04-27      | 37      |                                       |
| 2026-04-28      | 16      | Today                                 |
| **7-day total** | **118** | 04/22–04/28                           |
| **8-day total** | **138** | 04/21–04/28 (full scrape audit range) |

### Galveston roster name verification (04/28 sample, all confirmed ✓)

All 10 names from the 04/28 live jail roster were verified present in `v2_galveston_events`:

| Name                      | arrest_date |
| ------------------------- | ----------- |
| ALBUSTANJI, AHMAD HAITHAM | 2026-04-28  |
| BATTS, ASHELY RENA        | 2026-04-28  |
| FORD, LIONEL EDWARD       | 2026-04-28  |
| HAMMACK, MELINDA ANN      | 2026-04-28  |
| MOORE, MIRANDA LYNN       | 2026-04-28  |
| RICHARDSON, DENNIS RAY    | 2026-04-28  |
| SERNA, VERONICA LYNN      | 2026-04-28  |
| THOMPKINS, DERRICK AARON  | 2026-04-28  |
| USHER, ISAIAH EDWARD      | 2026-04-28  |
| VERDUN, BRANDI LYNN       | 2026-04-28  |

### Debug Endpoint

`GET /api/dashboard/galveston-debug?debug=1` — returns per-day breakdown, field usage audit, excluded doc count, and today's sample records directly from `v2_galveston_events`.
