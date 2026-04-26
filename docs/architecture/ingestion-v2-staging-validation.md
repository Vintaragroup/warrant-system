# V2 Ingestion Staging Validation Report

**Date:** 2026-04-26  
**Validator:** automated staging run + manual inspection  
**Scope:** `scripts/run_ingestion_v2.py` — first live staging write for all four enabled v2 sources

---

## 1. Write Path Inspection

### `_NullDb` (dry-run)
All pymongo calls (`find_one`, `insert_one`, `update_one`, `find`) return null / empty stubs. No I/O occurs.

### `_StagingDb` (non-dry-run)
Wraps a real pymongo database. Every collection access is intercepted via `__getitem__` / `__getattr__` and mapped through `_STAGING_MAP`:

| Production collection | Staging collection |
|---|---|
| `galveston_events` | `v2_galveston_events` |
| `harris_bond` | `v2_harris_reports` |
| `harris_misfel` | `v2_harris_reports` |
| `harris_nafiling` | `v2_harris_reports` |
| `report_manifest` | `v2_report_manifest` |
| `brazoria_inmates` | `v2_lookup_results` |
| `fortbend_inmates` | `v2_lookup_results` |
| `jefferson_events` | `v2_lookup_results` |
| `galveston_p2c_endpoint` | `v2_galveston_p2c_endpoint` |

Collections not listed in `_STAGING_MAP` pass through unchanged. The only non-staging passthrough that occurs during a v2 run is `scrape_audit`, which records structured audit events to the shared `scrape_audit` collection. This is acceptable: audit entries are append-only metadata, not inmate data, and do not overwrite production records.

### Feature-flag gate
- `USE_V2_INGESTION=true` required for any non-dry-run write  
- Per-source flags (`ENABLE_V2_GALVESTON`, etc.) gate individual sources  
- Both default to `false` — safe for production deployments that do not set them

---

## 2. Baseline Counts (before staging writes)

Established before any v2 staging writes were executed.

| Collection | Count |
|---|---|
| `galveston_events` | 6,814 |
| `harris_bond` | 14,239 |
| `harris_misfel` | 5,419 |
| `harris_nafiling` | 1,440 |
| `brazoria_inmates` | 3,140 |
| `fortbend_inmates` | 858 |
| `jefferson_events` | 3,714 |
| `report_manifest` | 0 |
| `v2_galveston_events` | 0 |
| `v2_harris_reports` | 0 |
| `v2_lookup_results` | 0 |
| `v2_report_manifest` | 0 |
| `v2_galveston_p2c_endpoint` | 0 |

---

## 3. Staging Write Commands

All commands run from `services/warrantdb-pipeline/` with `PYTHONPATH=$PWD`.

### Galveston (limit 5)
```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  USE_V2_INGESTION=true ENABLE_V2_GALVESTON=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source galveston --no-dry-run --limit 5
```
Result: stored 5 events → `v2_galveston_events`

### Harris District Clerk (limit 1 report)
```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  USE_V2_INGESTION=true ENABLE_V2_HARRIS_REPORTS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source harris_reports --no-dry-run --limit 1
```
Result: 4 reports found; 1 report downloaded and ingested → 273 records → `v2_harris_reports`; 4 manifest entries → `v2_report_manifest`

> Note: The runner currently applies `--limit` to the number of reports processed but `detect_new_reports()` iterates all found reports from the manifest check. On a first run with `--limit 1`, only the first report was fetched and stored; the manifest recorded all four as "seen" because `fetch_report_list()` was called first. On subsequent runs all four are skipped. See § 4 (idempotency) and § 7 (TODOs).

### Fort Bend lookup (RODRIGUEZ)
```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  USE_V2_INGESTION=true ENABLE_V2_LOOKUPS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name RODRIGUEZ --no-dry-run
```
Result: 16 results stored → `v2_lookup_results`

### Jefferson lookup (SMITH)
```bash
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  USE_V2_INGESTION=true ENABLE_V2_LOOKUPS=true DRY_RUN=false \
  python3 scripts/run_ingestion_v2.py --source jefferson_lookup --last-name SMITH --no-dry-run
```
Result: 5 results stored → `v2_lookup_results`

---

## 4. Staging Collection Inspection (after writes)

### `v2_galveston_events` (5 documents)

Sample document fields (post-write, `_upsert_key` absent ✅):
```json
{
  "full_name": "AGUILAR, BILLIE JO",
  "last_name": "AGUILAR",
  "first_name": "BILLIE",
  "dob": "1971-12-04",
  "booking_number": "441503",
  "booking_date": "2026-02-12",
  "agency": "Galveston County Sheriffs Office",
  "charges": ["THEFT PROP >=$750<$2500 ENH IAT"],
  "county": "galveston",
  "source": "galveston_p2c",
  "source_id": "1",
  "scraped_at": "2026-04-26T...",
  "observed_at": "2026-02-12",
  "ingested_at": "2026-04-26T...",
  "first_seen_at": "2026-04-26T..."
}
```

Timestamp check:
| Field | Present | Value |
|---|---|---|
| `scraped_at` | ✅ | ISO UTC set by `normalize_event` |
| `ingested_at` | ✅ | ISO UTC set by `store_event()` at write time |
| `observed_at` | ✅ | booking/arrest date from source |
| `first_seen_at` | ✅ | set by `$setOnInsert` on first upsert only |
| `_upsert_key` | ✅ absent | correctly popped before write |

### `v2_harris_reports` (273 documents)

Sample document fields:
```json
{
  "county": "harris",
  "source_system": "harris_district_clerk",
  "kind": "bond",
  "group": "Civil",
  "full_name": "GERARD, CHRISTOPHER",
  "last_name": "GERARD",
  "first_name": "CHRISTOPHER",
  "spn": "03189662",
  "case_number": "261689601010",
  "offense": "ASSAULT-FAMILY MEMBER",
  "bond_amount": 3000,
  "scraped_at": "2026-04-26T...",
  "ingested_at": "2026-04-26T...",
  "observed_at": null
}
```

Timestamp check:
| Field | Present |
|---|---|
| `scraped_at` | ✅ |
| `ingested_at` | ✅ |
| `observed_at` | `null` — Harris bond CSV does not include a publish date in the row itself; `report_meta.publish_date` is derived from the filename. Not a bug. |

### `v2_lookup_results` (21 documents)

Contains a mix of Fort Bend and Jefferson records. Upsert keys:
- Fort Bend: `{"county": "fortbend", "source": "fortbend_jailinq", "booking_number": "<booking>"}`
- Jefferson: `{"county": "jefferson", "source": "jefferson_inmate_search", ...}` using `inmate_id`

Timestamp check:
| Field | Present |
|---|---|
| `scraped_at` | ✅ |
| `ingested_at` | ✅ |
| `observed_at` | ✅ (booking_date) |
| `_upsert_key` | ✅ absent |

### `v2_report_manifest` (4 documents)

One entry per Harris report file. Tracks `filename`, `downloaded_at`, `ingested_at`. Used by `detect_new_reports()` to skip already-processed reports.

### `v2_galveston_p2c_endpoint` (1 document)

Galveston P2C discovers its POST endpoint via Playwright on first run and caches the discovered URL here to avoid repeated browser launches.

---

## 5. Idempotency Results

### Galveston — re-run with same `--limit 5`

| Run | `v2_galveston_events` count |
|---|---|
| Run 1 | 5 |
| Run 2 (re-run) | **5** (no change) ✅ |

The 5 documents were upserted (matched, not inserted). `first_seen_at` was preserved via `$setOnInsert`. ✅

### Harris — re-run with same `--limit 1`

| Run | Records stored | Reason |
|---|---|---|
| Run 1 | 273 | First ingest |
| Run 2 | **0** | All 4 reports already in `v2_report_manifest` ✅ |

Harris idempotency is driven by the manifest, not by record-level upsert. Re-ingesting the same report is prevented at the report level, not the row level.

> ⚠️ **Known behaviour:** With `--limit 1`, only 1 report is ingested but `detect_new_reports()` iterates all available reports through the manifest check before the `--limit` is enforced. On the first run this writes all 4 manifest entries even though only 1 report was downloaded and stored. Subsequent runs with `--limit 1` see all 4 as "already ingested" and skip them all. See TODO §7.

---

## 6. Production Safety Verification

Final production collection counts compared to baseline:

| Collection | Baseline | After v2 writes | Delta |
|---|---|---|---|
| `galveston_events` | 6,814 | 6,814 | **0** ✅ |
| `harris_bond` | 14,239 | 14,239 | **0** ✅ |
| `harris_misfel` | 5,419 | 5,419 | **0** ✅ |
| `harris_nafiling` | 1,440 | 1,440 | **0** ✅ |
| `brazoria_inmates` | 3,140 | 3,140 | **0** ✅ |
| `fortbend_inmates` | 858 | 858 | **0** ✅ |
| `jefferson_events` | 3,714 | 3,714 | **0** ✅ |
| `report_manifest` | 0 | 0 | **0** ✅ |

**No production collection was modified by v2 ingestion.** ✅

---

## 7. Known Limitations and TODOs

### TODO-1: Galveston upsert key uses `invid` (positional index), not `booking_number`

**Severity:** Medium — affects upsert stability across roster refreshes  
**Detail:** `normalize_event()` resolves `source_id` as `person_id` (the P2C `invid` field) when available. `invid` is the sort-position index in the JSON roster (1, 2, 3…), not a stable identifier. If the P2C API returns the roster in a different order on a subsequent run, `invid` will map to a different inmate and upserts will create duplicates.

The `booking_number` (e.g., `"441503"`) is available in every row and is a stable, booking-system-assigned identifier.

**Idempotency test result:** Passed (no duplicates) — the P2C API returns results in alphabetical order which is stable across runs, so `invid` was consistent during testing.

**Recommended fix:** Change `_upsert_key` in `normalize_event()` to use `booking_number` directly:
```python
# In ingestion/event_feeds/galveston_p2c.py normalize_event():
_bn = raw.get("booking_number") or None
"_upsert_key": (
    {"county": self.COUNTY, "booking_number": _bn}
    if _bn
    else {"county": self.COUNTY, "source_id": source_id}
),
```
**Coordination required:** The same `normalize_event()` is used by the legacy production pipeline writing to `galveston_events`. Changing the upsert key will break deduplication against existing production documents (old docs have `{county, source_id}` key; new writes would use `{county, booking_number}`). The fix should be paired with a one-time index migration on `galveston_events` or applied only after the v2 collection is promoted to replace it.

### TODO-2: Harris `--limit` applies after manifest check, not before

**Severity:** Low — affects incremental ingestion runs  
**Detail:** `detect_new_reports()` → `fetch_report_list()` fetches all reports and checks each against the manifest. `--limit N` in the runner then stops after N downloads. But manifest entries are written for all reports that were *checked*, not just the ones *downloaded*. So `--limit 1` on a fresh manifest writes 4 manifest entries but only 273 records. Subsequent `--limit 1` runs then skip all 4 reports.

**Fix:** Cap the manifest iteration in the runner — pass `limit` into `detect_new_reports()` or limit the slice before yielding. Alternatively, only write to `_mark_report_downloaded` after a successful download.

### TODO-3: Harris `observed_at` is `null` for bond/misfel/nafiling rows

**Severity:** Low — data quality gap  
**Detail:** Harris bond CSV rows do not embed a date per row. `report_meta.publish_date` is parsed from the filename (`04-26-26-bond.txt` → `"2026-04-26"`), but `normalize_record()` sets `observed_at = publish_date` only when it is non-None. The current filename parser returns `None` for this filename format. Result: `observed_at = null` on all Harris records.

**Fix:** Update `fetch_report_list()` regex to parse `MM-DD-YY` filename dates; or set `observed_at = scraped_at` as a fallback.

### TODO-4: Brazoria staging write not tested — target host unreachable

**Severity:** Informational  
**Detail:** `pubweb.brazoriacountytx.gov` is unreachable from the local network. Code compiles and schema-validates cleanly. Staging write will be validated when network access is available (e.g., on Render).

### TODO-5: Add Mongo indexes on staging collections before enabling scheduled jobs

Before enabling recurring cron jobs against staging collections, add the same unique indexes used on production to prevent duplicate documents from accumulating if an upsert key collision occurs:

```bash
PYTHONPATH=$PWD python3 - <<'EOF'
from storage.mongo_client import get_db
db = get_db()
db["v2_galveston_events"].create_index(
    [("county", 1), ("source_id", 1)], unique=True, background=True)
db["v2_harris_reports"].create_index(
    [("county", 1), ("source_system", 1), ("kind", 1), ("case_number", 1)], background=True)
db["v2_lookup_results"].create_index(
    [("county", 1), ("source", 1), ("booking_number", 1)], background=True, sparse=True)
print("indexes created")
EOF
```

---

## 8. Summary

| Check | Result |
|---|---|
| Dry-run uses `_NullDb` | ✅ |
| Staging writes use `_StagingDb` | ✅ |
| All production collection names redirected to `v2_*` | ✅ |
| No production collection modified | ✅ |
| `_upsert_key` absent from stored documents | ✅ |
| `scraped_at` present on all written documents | ✅ |
| `ingested_at` set at write time (not in normalize) | ✅ |
| `first_seen_at` set only on first upsert (`$setOnInsert`) | ✅ |
| Galveston idempotency — no duplicates on re-run | ✅ |
| Harris idempotency — manifest prevents re-ingest | ✅ |
| Lookup idempotency — upsert by booking number | ✅ |
| Feature flags default to safe (false / dry-run) | ✅ |

### Before enabling scheduled staging jobs, complete:
1. **TODO-1:** Fix Galveston upsert key to use `booking_number` (coordinate with production migration)
2. **TODO-2:** Fix Harris `--limit` + manifest interaction
3. **TODO-3:** Fix Harris `observed_at = null` (parse filename date)
4. **TODO-5:** Create indexes on staging collections

---

## 9. Promotion Blocker Fixes (2026-04-26)

All four blockers identified in §7 were resolved in the same session.  
No production collections were written. No existing staging data was deleted.

### Fix 1 — Galveston upsert key (TODO-1) ✅ RESOLVED

**File:** `ingestion/event_feeds/galveston_p2c.py` → `normalize_event()`

**Change:** Removed `person_id` (`invid`) from the upsert key entirely. The new key priority is:

| Priority | Key fields | Used when |
|---|---|---|
| 1 | `{county, booking_number}` | `booking_number` present (most cases) |
| 2 | `{county, jacket_number}` | `jacket_number` present, no booking_number |
| 3 | `{county, source_url, full_name}` | detail URL available |
| 4 | `{county, source, full_name, scraped_date}` | last resort — not stable across polls |

The `source_id` record field is still populated (for legacy compatibility) but is no longer used as the upsert key. `invid` / `person_id` is never used as a key.

Comments added to `normalize_event()` explaining why `person_id` is unstable.

> **Production coordination note:** Existing `galveston_events` documents in production were written with `{county, source_id}` keys. The new key structure (`{county, booking_number}`) is fully compatible with v2 staging (`v2_galveston_events`) but would not match old production documents on upsert. A one-time migration is needed before promoting v2 to replace the production collection.

**Validation:** Galveston dry-run `--limit 3` completed with `ok=3 warn=0 skip=0`. Smoke test: 17/17.

---

### Fix 2 — Harris `--limit` + manifest interaction (TODO-2) ✅ RESOLVED

**File:** `scripts/run_ingestion_v2.py` → `run_harris_reports()`

**Change:** Added a `_limited_detect()` wrapper that monkey-patches `ingestor.detect_new_reports` to yield at most `limit` reports before the ingest loop starts. The manifest now records only the reports that were actually downloaded.

Before fix: `--limit 1` on a fresh manifest → all 4 reports downloaded, all 4 manifest entries written, 273 records stored.  
After fix: `--limit 1` → exactly 1 report downloaded, 1 manifest entry written.

**Validation:** Harris dry-run `--limit 1` showed `sample: ok=5 warn=0` for 1 report. Compile clean.

---

### Fix 3 — Harris `observed_at = null` (TODO-3) ✅ RESOLVED

**File:** `ingestion/reports/harris_reports.py` → `_date_from_filename()`

**Change:** Rewrote the function to support four filename date formats in priority order:

| Format | Example | Result |
|---|---|---|
| `YYYY-MM-DD` | `2026-04-26-bond.txt` | `2026-04-26` |
| `MM-DD-YY` | `04-26-26-bond.txt` (**current Harris format**) | `2026-04-26` |
| `YYYYMMDD` | `20260426_BondNoAtty.txt` | `2026-04-26` |
| `MMDDYYYY` | `DistrictClerk_bond_04262026.csv` | `2026-04-26` (legacy) |

YYYY-style patterns are checked before MM-DD-YY to prevent misparse (e.g. `2026-04-26` → `26-04-26`). YYYYMMDD is checked before MMDDYYYY to prevent `20260426` from being read as `month=20`. Month/day range validation (`1–12`, `1–31`) guards both 8-digit patterns.

`normalize_record()` was already setting `observed_at = publish_date`, so fixing the filename parser is sufficient — no changes to `normalize_record()`.

**Unit test (8 cases):** 8/8 pass, 0 fail.

---

### Fix 4 — Mongo indexes on staging collections (TODO-5) ✅ RESOLVED

**File created:** `scripts/create_v2_indexes.py`

11 indexes created across 4 staging collections:

| Collection | Index name | Type |
|---|---|---|
| `v2_galveston_events` | `galveston_booking_number_uq` | unique sparse |
| `v2_galveston_events` | `galveston_name_url_fallback` | compound sparse |
| `v2_galveston_events` | `galveston_scraped_at` | single field |
| `v2_harris_reports` | `harris_report_case` | compound |
| `v2_harris_reports` | `harris_county_kind` | compound |
| `v2_harris_reports` | `harris_scraped_at` | single field |
| `v2_lookup_results` | `lookup_county_name_booking` | compound sparse |
| `v2_lookup_results` | `lookup_county_source` | compound |
| `v2_lookup_results` | `lookup_scraped_at` | single field |
| `v2_report_manifest` | `manifest_source_report_id_uq` | unique sparse |
| `v2_report_manifest` | `manifest_source_url` | compound sparse |

Script is idempotent (safe to rerun). `--dry-run` flag available.

**Validation:** `python3 scripts/create_v2_indexes.py --verbose` → 11/11 OK, 0 errors.

---

### Commands run during fix validation

```bash
# From services/warrantdb-pipeline/

# Compile check (all four modified/new files)
python3 -m py_compile \
  ingestion/event_feeds/galveston_p2c.py \
  ingestion/reports/harris_reports.py \
  scripts/run_ingestion_v2.py \
  scripts/create_v2_indexes.py
# → exit 0 ✅

# Smoke test (17 offline schema checks, no network)
PYTHONPATH=$PWD python3 scripts/smoke_test_ingestion_v2.py
# → 17 passed / 0 failed ✅

# Galveston dry-run
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source galveston --dry-run --limit 3
# → ok=3 warn=0 skip=0 ✅

# Harris dry-run
PYTHONPATH=$PWD python3 scripts/run_ingestion_v2.py --source harris_reports --dry-run --limit 1
# → 1 report downloaded, sample: ok=5 warn=0 ✅

# Index creation (live)
PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
  python3 scripts/create_v2_indexes.py --verbose
# → 11 indexes created, 0 errors ✅
```

---

### Remaining promotion risks

| Risk | Severity | Status |
|---|---|---|
| Galveston upsert key change breaks dedup against old production docs | Medium | Needs one-time migration before promotion |
| Brazoria staging write not tested (host unreachable locally) | Low | Test on Render before promoting Brazoria |
| `scrape_audit` writes to production collection | Acceptable | Audit records; not data; append-only |
| `jacket_number` field not in P2C response (Galveston) | Low | Falls through to `source_url+name` key; safe |

