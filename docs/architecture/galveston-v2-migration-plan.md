# Galveston V2 Migration Plan

**Status**: DRAFT — awaiting Phase 1 (staging accumulation)  
**Last analysis**: 2026-04-27 via `scripts/analyze_galveston_v2_migration.py --limit 500`  
**Blocking**: upsert-key schema incompatibility between legacy and v2 collections  

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Schema Comparison](#2-schema-comparison)
3. [Risk Analysis](#3-risk-analysis)
4. [Proposed Migration Path](#4-proposed-migration-path)
5. [Rollback Plan](#5-rollback-plan)
6. [Validation Checklist](#6-validation-checklist)
7. [Final Recommendation](#7-final-recommendation)
8. [Appendix: Running the Analysis](#8-appendix-running-the-analysis)

---

## 1. Current State

### Legacy collection: `galveston_events`

| Metric | Value |
|---|---|
| Total documents | 6,814 |
| Last write | 2025-09-16 (222+ days stale) |
| Primary key / upsert filter | `{county, source_id}` — SHA-1 hash of normalized detail URL |
| Indexes | `_id` only (no unique constraints) |
| Active writer | None — legacy `galveston_p2c_fast.py` job has not run in 222+ days |

### V2 staging collection: `v2_galveston_events`

| Metric | Value |
|---|---|
| Total documents | 5 |
| Last write | 2026-04-26 (~22h ago) |
| Primary key / upsert filter | `{county, booking_number}` — stable booking system ID |
| Indexes | Unique sparse on `{county, booking_number}`; sparse on `{county, source, full_name, source_url}`; `scraped_at` |
| Active writer | V2 runner (`scripts/run_ingestion_v2.py --source galveston`) |
| Scheduled? | **No** — cron job in `render.yaml` is commented out |

### Key observation

Legacy Galveston ingestion is **effectively dead**.  V2 is the only active writer.
The legacy collection is a read-only historical artifact.  This simplifies the
migration: there is no live writer to disable, no write-conflict risk, and no
need to drain or fence the legacy job before cutting over reads.

---

## 2. Schema Comparison

### 2.1 Field inventory

| Field | Legacy (`galveston_events`) | V2 (`v2_galveston_events`) |
|---|---|---|
| `county` | ✅ `"Galveston"` (title-case) | ✅ `"galveston"` (lowercase) |
| `booking_number` | ❌ null on all 6,814 docs | ✅ 100% populated |
| `jacket_number` | ❌ absent | ❌ absent (not in P2C API) |
| `source_id` | ❌ absent | ✅ 100% — SHA-1 hash or booking_number |
| `source_url` | ✅ 100% | ❌ absent from v2 sample (stored but not always present) |
| `full_name` | ❌ absent | ✅ 100% |
| `last_name` / `first_name` | ❌ absent | ✅ split fields |
| `dob` | ❌ absent | ✅ present |
| `booked_at` | ✅ 100% | ❌ replaced by `booking_date` |
| `booking_date` | ❌ absent | ✅ 100% |
| `observed_at` | ❌ absent | ✅ present |
| `ingested_at` | ❌ absent | ✅ set by pipeline at write time |
| `scraped_at` | ✅ 100% | ✅ 100% |
| `bond_amount` | ❌ absent (nested in `bonds` array) | ✅ scalar float |
| `bonds` (array) | ✅ per-charge bond array | — |
| `total_bond` | ✅ present in `bonds` | subsumed by `bond_amount` |
| `charges` | ❌ absent | ✅ list of charge dicts |
| `arrest_date` | ✅ present | ❌ consumed into `observed_at`/`booking_date` |
| `status` | ✅ present | ❌ not mapped in v2 |
| `facility` | ✅ present | ❌ not mapped in v2 |
| `released_at` | ✅ present | ❌ not mapped in v2 |
| `booking_age_category` | ✅ present | ❌ not yet in v2 |
| `booking_priority` | ✅ present | ❌ not yet in v2 |
| `person_id` | ✅ (P2C `invid`) | ❌ intentionally removed (unstable) |

### 2.2 County case mismatch

Legacy stores `county: "Galveston"` (title-case).  V2 stores `county: "galveston"` (lowercase, per schema contract).  Any query that filters on `county` must handle both forms until all legacy docs are backfilled.

### 2.3 Key strategy incompatibility

The upsert key is incompatible between schemas:

```
Legacy upsert key:   { county: "Galveston",  source_id: "<sha1[:12] of URL>" }
V2 upsert key:       { county: "galveston",  booking_number: "<booking ID>" }
```

Legacy documents have **no `booking_number` field** — it was never scraped by `galveston_p2c_fast.py`.  V2 documents populate `booking_number` from the P2C API detail pages.

This means:
- Legacy and v2 documents cannot be directly upserted into the same collection without a schema migration.
- A cross-match by URL hash (`source_url` → SHA-1) is theoretically possible but unreliable in practice: legacy URL hashes are computed at scrape time and stored implicitly; v2 stores `source_url` but the legacy collection predates the v2 URL normalization logic.
- The 0% sample overlap rate reflects a 222-day temporal gap, not a fundamental data error.

### 2.4 Fields missing from V2 (potential downstream impact)

| Legacy field | Used by? | V2 path |
|---|---|---|
| `status` | Dashboard status filter | Map from P2C detail page `Status` cell — **add to v2** |
| `facility` | Dashboard facility grouping | Map from P2C detail page — **add to v2** |
| `released_at` | Bail analytics | Map from P2C detail page `Release Date` — **add to v2** |
| `booking_age_category` | Dashboard KPI buckets | Derive from `booking_date` → `observed_at` — **compute in v2** |
| `booking_priority` | Sort order | Derive from `booking_age_category` — **compute in v2** |

None of these block the initial read-path switchover, but they must be addressed before retiring the legacy collection.

---

## 3. Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dashboard breaks on `county` case change | HIGH | HIGH | Update all queries to use case-insensitive regex or normalize legacy docs |
| Dashboard breaks on `booked_at` → `booking_date` rename | HIGH | HIGH | Update API/dashboard field references before cutover |
| `status` / `facility` / `released_at` absent in v2 | MEDIUM | MEDIUM | Add field mapping to v2 before pointing dashboard to v2 |
| Legacy `bonds` array vs. v2 `bond_amount` scalar | MEDIUM | MEDIUM | Update dashboard bond display logic |
| V2 volume too low to trust (only 5 docs) | HIGH | LOW | Enable staging cron for 1 week before any cutover |
| URL-hash cross-match fails for existing URLs | MEDIUM | LOW | Not needed for promotion; v2 and legacy are independent collections |
| No rollback path if v2 has bugs | LOW | HIGH | Keep legacy collection intact (read-only); do not drop or rename until 30-day clean-run confirmed |
| Legacy P2C URL format changed since 2025-09 | LOW | MEDIUM | V2 re-scrapes from live API; new records will have current URL format |

---

## 4. Proposed Migration Path

Migration uses a **parallel-run then read-switch** strategy.  The legacy
collection is never written to and never dropped until confirmed safe.

### Phase 1 — Enable staging cron (immediately)

**Goal**: Accumulate a meaningful v2 dataset before any production switchover.

1. Uncomment `v2-galveston-staging` cron block in `services/warrantdb-pipeline/render.yaml`.
2. Deploy to Render.
3. Monitor with:
   ```bash
   PYTHONPATH=$PWD MONGO_URI=... python3 scripts/check_v2_staging_health.py
   ```
4. Wait until `v2_galveston_events` has ≥1,000 docs and health check shows `OK`.

**Duration**: 1–2 days (10-min cadence, ~250 docs/run → 1,000 docs in ~4 runs).

### Phase 2 — Promote staging to production-adjacent collection

**Goal**: Create `galveston_events_v2` as a production-named collection, keeping legacy intact.

1. Rename `v2_galveston_events` → `galveston_events_v2` in MongoDB Atlas:
   ```python
   db["v2_galveston_events"].rename("galveston_events_v2")
   ```
   Or simply update `_STAGING_MAP` in `run_ingestion_v2.py` to route directly to `galveston_events_v2`.

2. Re-run `scripts/create_v2_indexes.py` targeting `galveston_events_v2`:
   ```bash
   PYTHONPATH=$PWD python3 scripts/create_v2_indexes.py --verbose
   ```
   (After updating the collection name in the script or adding a `--collection` flag.)

3. Update `run_ingestion_v2.py` `_STAGING_MAP`:
   ```python
   "galveston_events": "galveston_events_v2",   # was "v2_galveston_events"
   ```

4. Continue running the cron job; verify new docs land in `galveston_events_v2`.

**Duration**: 30 minutes of work + 1 week of parallel operation.

### Phase 3 — Add compatibility alias fields to v2 normalizer

**Status: ✅ COMPLETE** (2026-04-27)

**Goal**: Add backward-compatible fields to `normalize_event()` so dashboard/API code
written against the legacy schema works without modification during the read-path transition.

**Compatibility fields added in `ingestion/event_feeds/galveston_p2c.py`:**

| Field added | Value / derivation | Legacy equivalent |
|---|---|---|
| `booked_at` | alias of `booking_date` (ISO string) | `booked_at` (100% on legacy) |
| `event_date` | alias of `booking_date` (ISO string) | derived from booking date |
| `county_display` | `"Galveston"` (title-case, static) | legacy `county: "Galveston"` |
| `county_normalized` | `"galveston"` (lowercase, = `county`) | explicit alias of v2 `county` |
| `charge_description` | first charge description as plain string | `charges[0].description` equivalent |

**Validation run (2026-04-27):**
- `py_compile` passes on `galveston_p2c.py` and `smoke_test_ingestion_v2.py`
- `smoke_test_ingestion_v2.py` — 25/25 checks pass
- `run_ingestion_v2.py --source galveston --dry-run --limit 3` completes cleanly

**Constraints observed:**
- `_upsert_key` is unchanged: still `{county, booking_number}` (preferred), with jacket/url/name fallbacks
- No v2-native fields removed or renamed
- `person_id` / `invid` never appear in `_upsert_key`

**Remaining fields NOT yet added** (require P2C detail-page scraping changes):

| Field | Source in P2C | Notes |
|---|---|---|
| `status` | Detail page "Status" cell | e.g. `"In Custody"`, `"Released"` |
| `facility` | Detail page "Facility" field | e.g. `"Galveston County Jail"` |
| `released_at` | Detail page "Release Date" | parse with `_parse_date()` |
| `booking_age_category` | Derive from `booking_date` vs. `scraped_at` | use same thresholds as legacy |
| `booking_priority` | Derive from `booking_age_category` | priority 1–8 map |

These five fields are not blocking for the initial read-path switchover — the
dashboard's `unionAll()` function does not query `status`/`facility`/`released_at`
directly.  Add them before retiring legacy if the detail views use these fields.

**Duration**: ✅ Done.

### Phase 4 — Read-path switchover

**Goal**: Point dashboard/API reads to `galveston_events_v2`.  Legacy remains
untouched and queryable.

1. Update the dashboard API query layer:
   - Replace `galveston_events` → `galveston_events_v2` in all read queries.
   - `booked_at` and `booking_date` are now both present in v2 — no field rename needed.
   - `county_display` = `"Galveston"` present in v2 — no case-handling needed.
   - Bond display: `bond_amount` (scalar float) already present in v2.
2. Deploy and verify dashboard shows current data.
3. Keep legacy `galveston_events` as a read-only fallback for 30 days.

**Duration**: 1–2 days of dashboard/API work.

### Phase 5 — Archive legacy collection

**Goal**: Retire legacy data after 30-day clean-run confirmation.

1. Rename `galveston_events` → `galveston_events_archive_2025` in Atlas.
2. Drop `galveston_p2c_fast.py` references from any remaining cron or worker config.
3. Remove legacy field references from any remaining code.

**Duration**: 1 hour.  Timeline: 30+ days after Phase 4.

---

## 5. Rollback Plan

Each phase is independently reversible:

| Phase | Rollback action |
|---|---|
| Phase 1 | Comment out cron in `render.yaml`; redeploy |
| Phase 2 | Revert `_STAGING_MAP` to `"v2_galveston_events"`; rename collection back |
| Phase 3 | Revert `normalize_event()` changes; redeploy scraper |
| Phase 4 | Revert dashboard/API collection reference to `galveston_events`; legacy collection is untouched |
| Phase 5 | **Not trivially reversible** — confirm Phase 4 is stable for 30+ days before archiving |

**The critical constraint**: do not rename or drop `galveston_events` until Phase 4
has been stable for at least 30 days.  Atlas collection renames are fast but drops
are permanent.

---

## 6. Validation Checklist

### Before Phase 1

- [ ] `python3 -m py_compile scripts/analyze_galveston_v2_migration.py` passes
- [ ] `python3 scripts/analyze_galveston_v2_migration.py --limit 500` runs without errors
- [ ] Smoke test passes: `PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py`
- [ ] Indexes exist: `python3 scripts/create_v2_indexes.py --dry-run --verbose`

### After Phase 1 (staging accumulation)

- [ ] `v2_galveston_events` has ≥1,000 documents
- [ ] Health check shows `OK`: `python3 scripts/check_v2_staging_health.py`
- [ ] Re-run analysis: `python3 scripts/analyze_galveston_v2_migration.py --limit 1000`
- [ ] `booking_number` present on ≥95% of new v2 docs
- [ ] Duplicate rate remains 0% (`dup_url_rate_pct`)
- [ ] `observed_at` present on ≥95% of new v2 docs

### Before Phase 4 (read-path switchover)

- [ ] `status`, `facility`, `released_at`, `booking_age_category`, `booking_priority` added to v2 normalizer
- [ ] Dashboard loads with zero JS errors pointing to `galveston_events_v2`
- [ ] API returns same shape as legacy for all `galveston` queries
- [ ] At least one week of v2 data confirmed clean in `galveston_events_v2`
- [ ] `county` case updated in all dashboard filter strings

### Before Phase 5 (archival)

- [ ] 30+ consecutive days of clean reads from `galveston_events_v2`
- [ ] No production incidents related to Galveston data in past 30 days
- [ ] Atlas snapshot backup taken before rename
- [ ] Legacy `galveston_events` collection archived (not dropped) first

---

## 7. Final Recommendation

**Keep legacy read-only. Run v2 in parallel. Switch reads after 1-week accumulation.**

V2 Galveston is architecturally superior:

- Stable `booking_number` key eliminates the `invid` sort-position duplication problem
- Normalized schema (`full_name`, `first_name`/`last_name`, `dob`, `observed_at`)
- Proper MongoDB indexes (unique sparse on `{county, booking_number}`)
- Active writer — legacy has been silent for 222 days; v2 wrote yesterday

The safest promotion path:

1. **Never merge** v2 records into `galveston_events` — key strategies are incompatible.
2. **Never drop** `galveston_events` — rename to archive after 30-day clean run.
3. **Enable the staging cron now** — `galveston_events_v2` needs more data before the dashboard can be pointed at it.
4. **Fix the five missing fields** (`status`, `facility`, `released_at`, `booking_age_category`, `booking_priority`) in `normalize_event()` before the read-path switchover.

The legacy collection is frozen in time (Sept 2025).  There is no active conflict.
This migration has low urgency but high value — the dashboard is currently reading
stale data from a collection that hasn't been updated in 7+ months.

---

## 8. Appendix: Running the Analysis

```bash
cd services/warrantdb-pipeline

# Offline validation (no Mongo)
python3 -m py_compile scripts/analyze_galveston_v2_migration.py
PYTHONPATH=$PWD python3 scripts/analyze_galveston_v2_migration.py --dry-run

# Full live analysis
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/analyze_galveston_v2_migration.py --limit 500

# With sample records printed
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/analyze_galveston_v2_migration.py --limit 500 --verbose

# JSON output for archiving
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/analyze_galveston_v2_migration.py --limit 1000 --json \
  > galveston_migration_analysis_$(date +%F).json
```

**Re-run recommended**: after each phase completes and before making any destructive
change to either collection.
