# V2 Ingestion Promotion Readiness Report

**Generated**: 2026-04-27  
**Author**: automated comparison via `scripts/compare_v2_legacy_ingestion.py`  
**Status**: ⚠️ STAGING — not yet promoted to production

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Readiness Status at a Glance](#2-readiness-status-at-a-glance)
3. [Galveston Events](#3-galveston-events)
4. [Harris Reports](#4-harris-reports)
5. [Lookup Scrapers](#5-lookup-scrapers)
6. [Cross-Cutting Findings](#6-cross-cutting-findings)
7. [Required Fixes Before Promotion](#7-required-fixes-before-promotion)
8. [Promotion Recommendations](#8-promotion-recommendations)
9. [Appendix: How to Re-run This Comparison](#9-appendix-how-to-re-run-this-comparison)

---

## 1. Executive Summary

V2 ingestion is **architecturally sound** and producing well-structured, enriched
records.  However, staging volume is low because scheduled v2 cron jobs are not
yet enabled.  Key blockers remain for two sources (Galveston upsert-key migration,
Jefferson missing `booking_number`) before v2 can replace — rather than merely
supplement — legacy ingestion.

| Source | Recommendation |
|---|---|
| **Galveston** | **Supplement** — stage in parallel; promote after upsert-key migration |
| **Harris** | **Supplement** — v2 schema is richer; safe to co-ingest; promote once `observed_at` fill rate is confirmed |
| **Lookups (Fort Bend)** | **Enrichment-only** — on-demand; not a scheduled primary source |
| **Lookups (Jefferson)** | **Enrichment-only** — fix `booking_number` mapping before promoting |
| **Lookups (Brazoria)** | **Disabled** — network issue unresolved; do not schedule |

---

## 2. Readiness Status at a Glance

| Metric | Galveston | Harris (bond) | Harris (misfel) | Harris (nafiling) | Ft Bend | Jefferson | Brazoria |
|---|---|---|---|---|---|---|---|
| V2 staging docs | 5 | 240 | 2 | 31 | 8 | 13 | 0 |
| Legacy prod docs | 6,814 | 14,239 | 5,419 | 1,440 | 858 | 3,714 | 3,140 |
| V2 latest write | 2026-04-26 | recent | recent | recent | recent | recent | — |
| Legacy latest write | 2025-09-16 | 2025-12-15* | 2025-12-15* | 2025-12-15* | 2025-11-13* | 2025-11-13* | 2025-11-13* |
| Missing required fields | none | `observed_at` | `observed_at` | `observed_at` | none | `booking_number` | n/a |
| Duplicate key rate (v2) | 0% | 0% | 0% | 0% | 0% | 100%† | n/a |
| Cross-match rate (sampled) | 0%‡ | 0%‡ | 0%‡ | 0%‡ | 0%‡ | 0%‡ | n/a |
| Indexes created | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Smoke test | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

\* Approximate; legacy jobs appear to have been idle for 133–229 days.  
† Jefferson duplicate rate reflects missing `booking_number` — all sampled records
  hash to the same key.  Not a data problem; the comparison script uses the wrong
  key field for Jefferson (see §7).  
‡ 0% cross-match because legacy data is 4–7 months older than v2 data; there is
  no temporal overlap in the sampled windows, not because records are wrong.

---

## 3. Galveston Events

### 3.1 Collection comparison

| | V2 (`v2_galveston_events`) | Legacy (`galveston_events`) |
|---|---|---|
| Documents | 5 | 6,814 |
| Latest write | 2026-04-26 | 2025-09-16 (7+ months stale) |
| Upsert key | `{county, booking_number}` | `{county, source_id}` (sha1 of URL) |
| `county` value | `"galveston"` (lowercase) | `"Galveston"` (title-case) |
| Duplicate key rate | 0% | 100% (no `booking_number` on legacy docs) |
| `booking_number` present | ✅ ~100% | ❌ legacy docs omit this field |

### 3.2 Fields only in V2

`bond_amount`, `booking_date`, `dob`, `first_name`, `full_name`, `ingested_at`,
`last_name`, `observed_at`, `source`, `source_id`

V2 records are materially richer than legacy.  Legacy `galveston_events` stores
raw scrape output keyed on a SHA-1 hash of the detail URL (`source_id`).  V2
normalises to a named schema with stable booking identifiers.

### 3.3 Field coverage (v2 sample, n=5)

All required fields (`full_name`, `county`, `source`, `scraped_at`,
`booking_number`) present in 100% of sampled records.

### 3.4 Risks

| Risk | Severity | Notes |
|---|---|---|
| Upsert key mismatch | **HIGH** | Existing legacy `galveston_events` docs keyed on `{county, source_id}`.  Promoting v2 without migration will create duplicate documents for all historical records. |
| `county` case mismatch | MEDIUM | Queries joining on `county: "galveston"` will miss legacy `"Galveston"` docs and vice-versa.  Normalise legacy docs or add a case-insensitive index. |
| Legacy jobs idle | LOW | Legacy Galveston P2C fast scraper last wrote 2025-09-16 — 7+ months ago.  V2 is the only active writer.  Risk of a stale production collection if v2 staging is not promoted. |
| Low v2 volume | LOW | Only 5 staging docs; scheduled cron not yet enabled.  Enable `v2-galveston-staging` in `render.yaml` before assessing full match rate. |

### 3.5 Recommendation

**Supplement → Promote with migration**

1. Enable `v2-galveston-staging` cron job (uncomment in `render.yaml`).
2. Run for ≥1 week to accumulate staging volume.
3. Execute one-time migration: rewrite all legacy `galveston_events` docs to use
   `{county: "galveston", booking_number: <value>}` upsert key and lowercase `county`.
4. Drop old `source_id`-based unique index; apply new `{county, booking_number}` unique index.
5. Cut over v2 as primary writer; retire `galveston_p2c_fast.py`.

---

## 4. Harris Reports

### 4.1 Collection comparison

| | V2 (`v2_harris_reports`) | Legacy (`harris_bond`) | Legacy (`harris_misfel`) | Legacy (`harris_nafiling`) |
|---|---|---|---|---|
| Documents (filtered by kind) | 240 / 2 / 31 | 14,239 | 5,419 | 1,440 |
| Latest write | recent | ~2025-12-15 (133 days stale) | ~2025-12-15 | ~2025-12-15 |
| Upsert key | `{county, source, kind, case_number}` | `{spn, case_number, group}` | same | same |
| `kind` field | ✅ bond / misfel / nafiling | ❌ none | ❌ none | ❌ none |
| `observed_at` | ⚠️ missing on some records | n/a (uses `file_date`) | n/a | n/a |
| `county` field | ✅ `"harris"` | ❌ absent | ❌ absent | ❌ absent |

### 4.2 Fields only in V2

`county`, `source_system`, `kind`, `ingested_at`, `observed_at`

### 4.3 Fields only in legacy

`booking_age_category`, `booking_priority`, `history` (push array),
`needs_bond_help` (bond/nafiling), `first_seen_at`, `first_seen_file_date`,
`last_seen_file_date`, `updated_at`

These are enrichment/analytics fields computed by the legacy ingestor.  V2 does
not yet populate them.  They are not required for basic promotion but are used
downstream in bail-bond analytics.

### 4.4 `observed_at` issue

V2 `normalize_record()` sets `observed_at = publish_date` from `_date_from_filename()`.
The comparison shows `observed_at` is missing from some records, suggesting the
filename date parser is still returning `None` for some report filenames not
covered by the four current patterns.

**Action**: Re-run `scripts/run_ingestion_v2.py --source harris_reports --dry-run --limit 4`
and inspect the printed `publish_date` values.  If any are `None`, add a fallback
pattern to `_date_from_filename()`.

### 4.5 Cross-match note

0% match rate is expected: legacy data is ~133 days old; v2 is ingesting current
reports.  There is no temporal overlap.  This is not a data quality problem.

### 4.6 Risks

| Risk | Severity | Notes |
|---|---|---|
| `observed_at` null on some records | MEDIUM | Breaks downstream time-series queries.  Confirm fill rate ≥95% before promotion. |
| Missing legacy analytics fields | LOW | `booking_age_category`, `booking_priority`, `history` used by dashboard.  Must be backfilled or computed post-promotion. |
| Legacy jobs idle 133 days | MEDIUM | If legacy Harris jobs are also off, v2 may be the only source of fresh data.  Worth verifying whether legacy Harris cron is still running. |
| v2 splits 3 collections into 1 | LOW | v2 uses a single `v2_harris_reports` collection with a `kind` discriminator.  Dashboard queries that target `harris_bond` directly must be updated before cutting over. |

### 4.7 Recommendation

**Supplement**

V2 Harris produces richer records with `county`, `kind`, and `observed_at`.  It
is safe to co-ingest (separate staging collection; no conflict with production).
Promote once:

- `observed_at` fill rate ≥95% confirmed
- Analytics fields (`booking_age_category`, `booking_priority`) are backfilled or
  the dashboard is updated to compute them from v2 data
- Dashboard queries updated to use `kind` discriminator instead of separate collections

---

## 5. Lookup Scrapers

### 5.1 Fort Bend

| | V2 (`v2_lookup_results`, county=fortbend) | Legacy (`fortbend_inmates`) |
|---|---|---|
| Documents | 8 | 858 |
| Latest write | recent | ~2025-11-13 (165+ days stale) |
| Upsert key | `{county, source, booking_number}` | `{id}` or `{booking_number}` |
| `booking_number` present | ✅ | ✅ |
| `observed_at` | ✅ | ❌ absent |

V2 adds `observed_at` and standard `county`/`source` fields.  Legacy uses
VarJailID (`id`) as primary key — this field is absent from v2 records.

### 5.2 Jefferson

| | V2 (`v2_lookup_results`, county=jefferson) | Legacy (`jefferson_events`) |
|---|---|---|
| Documents | 13 | 3,714 |
| Latest write | recent | ~2025-11-13 (165+ days stale) |
| Upsert key (intended) | `{county, source, inmate_id}` | `{identifiers.inmate_id}` (via `persons`) |
| `booking_number` | ❌ absent (Jefferson API does not return it) | ❌ absent |
| `inmate_id` | ✅ present | ✅ via `persons.identifiers` |
| Duplicate key rate (v2) | 100%† | — |

† The comparison script's `v2_lookup_results` key_fields include `booking_number`.
  Jefferson records have no `booking_number`; all key tuples are identical →
  100% reported duplicate rate.  This is a **script measurement artifact**, not a
  real duplication problem.  The actual v2 upsert key uses `inmate_id`.

### 5.3 Brazoria

| | V2 (`v2_lookup_results`, county=brazoria) | Legacy (`brazoria_inmates`) |
|---|---|---|
| Documents | **0** | 3,140 |
| Latest write | never | ~2025-11-13 |

V2 Brazoria lookup has never successfully written.  The Brazoria county
PublicAccess portal (`pubweb.brazoriacountytx.gov`) is unreachable from the
development network.  This must be confirmed to work on the Render deployment
network before scheduling.

### 5.4 Risks

| Risk | Source | Severity | Notes |
|---|---|---|---|
| `booking_number` absent on Jefferson | Jefferson | MEDIUM | Script reports 100% dup rate (false positive).  Verify real dedup works via `inmate_id` index. |
| Brazoria never written | Brazoria | HIGH | Cannot promote until at least one successful write is confirmed outside local network. |
| `id` (VarJailID) absent | Fort Bend | LOW | Legacy uses `id` as primary key; v2 uses `booking_number`.  May create duplicates if both writers are active and a record has no `booking_number`. |
| On-demand only | All lookups | LOW | Lookups require a name query input.  They are not candidates for scheduled primary ingestion.  This is by design. |

### 5.5 Recommendation

**Enrichment-only (not scheduled primary ingestion)**

Lookups are triggered by name queries, not on a polling schedule.  They supplement
the enrichment pipeline for known subjects.  Do not attempt to make them primary
data sources.

Fix the Brazoria network issue on Render before any staging run.
Fix the Jefferson `booking_number` false-positive in `compare_v2_legacy_ingestion.py`
(use `inmate_id` as key for Jefferson cross-match).

---

## 6. Cross-Cutting Findings

### 6.1 Legacy ingestion is effectively idle

All legacy collections show last writes that are 133–229 days old.  The only
actively written collection is `v2_harris_reports` (240+ bond records) and the
new v2 staging collections.  **V2 is already the freshest data source.**

### 6.2 V2 schema is materially richer

V2 records consistently add:

- `county` (normalised lowercase) — absent from legacy Harris and lookup records
- `observed_at` — event timestamp; absent from legacy lookups
- `ingested_at` — pipeline write timestamp
- `source` and `kind` discriminators
- `bond_amount` as a scalar float (legacy buries it in per-charge arrays or omits it)
- `first_name` / `last_name` split from `full_name`
- `dob` (date of birth) — absent from some legacy collections

### 6.3 Key format incompatibility

The Galveston upsert key change (`source_id` → `booking_number`) means v2 records
cannot be merged with legacy records via upsert without a one-time migration.  All
other sources use stable keys (`case_number`, `booking_number`) that are compatible
across v2 and legacy formats.

### 6.4 `county` case normalisation

V2 normalises all `county` values to lowercase (`"galveston"`, `"harris"`, etc.).
Legacy Galveston uses `"Galveston"` (title-case).  Any index, query, or dashboard
widget that filters on `county` must handle both forms until legacy records are
backfilled.

### 6.5 Harris `observed_at` fill rate

The `_date_from_filename()` rewrite (task 2) fixed the primary pattern (`MM-DD-YY`).
However, the comparison shows `observed_at` still null on some records.  This needs
a targeted audit — run with `--verbose` and inspect which filenames aren't matching.

---

## 7. Required Fixes Before Promotion

### 7.1 Galveston — upsert key migration (BLOCKING)

Before v2 Galveston can replace legacy as the primary writer:

1. Add `booking_number` to all existing `galveston_events` production documents
   (backfill from the P2C API or from existing `source_url` parsing).
2. Normalise `county` to lowercase on all legacy documents.
3. Replace the `source_id` unique index with `{county, booking_number}` unique index.
4. Update any queries that filter on `county: "Galveston"` (title-case).

This is a one-time migration.  Until it runs, v2 and legacy write to separate
collections independently — safe to co-ingest.

### 7.2 Harris `observed_at` — confirm fill rate (NEAR-BLOCKING)

- Audit current `observed_at` null rate across all 240+ v2 bond records.
- If null rate > 5%, add additional filename patterns or a `scraped_at` fallback.
- Target: `observed_at` populated on ≥95% of ingested records before promotion.

### 7.3 Jefferson lookup key (MINOR, comparison script)

- Update `compare_v2_legacy_ingestion.py`: when `county_filter == "jefferson"`,
  use `inmate_id` as the cross-match key instead of `booking_number`.
- This is a script measurement fix, not a data fix.  Jefferson v2 records are
  correctly keyed on `inmate_id` in the actual DB upsert.

### 7.4 Brazoria network validation (BLOCKING for Brazoria)

- Deploy the v2 runner to Render Staging environment.
- Run `python3 scripts/run_ingestion_v2.py --source brazoria_lookup --last-name SMITH --dry-run`.
- Confirm network connectivity to `pubweb.brazoriacountytx.gov` from Render.
- Do not enable scheduled Brazoria job until at least one successful write is confirmed.

### 7.5 Legacy analytics fields (LOW — dashboard-blocking)

Before Harris promotion, the dashboard must either:

- Compute `booking_age_category`, `booking_priority` from v2 `observed_at` (preferred), or
- The v2 ingestor must populate these fields in `normalize_record()`.

---

## 8. Promotion Recommendations

### Galveston — Supplement → Promote with Migration

**Current state**: Staging in parallel.  5 v2 docs vs 6,814 legacy (legacy idle 7+ months).  

**Path to promotion**:
1. Enable `v2-galveston-staging` cron (uncomment in `render.yaml`).
2. Run staging for ≥1 week; confirm health check shows `v2_galveston_events` not stale.
3. Execute upsert-key migration on `galveston_events`.
4. Redirect primary writer to v2 runner; retire `galveston_p2c_fast.py`.

**Timeline**: 1–2 sprints after migration script is written and tested.

---

### Harris — Supplement (safe to co-ingest now)

**Current state**: V2 actively ingesting (240 bond, 2 misfel, 31 nafiling).
Legacy idle 133 days.  V2 is de-facto the only active Harris writer.

**Path to promotion**:
1. Confirm `observed_at` fill rate ≥95%.
2. Update dashboard queries to use `kind` discriminator.
3. Backfill or compute `booking_age_category` / `booking_priority`.
4. Move legacy Harris collection reads to v2 collection.

**Timeline**: 1 sprint.  This is the lowest-risk promotion.

---

### Lookups — Enrichment-only (do not schedule as primary ingestion)

**Current state**: On-demand only.  Fort Bend and Jefferson have small staging
volumes (8 and 13 docs respectively).  Brazoria has 0.

**Path to productive use**:
1. Fix Brazoria network issue on Render.
2. Fix Jefferson key mapping in comparison script.
3. Integrate lookups as enrichment steps triggered by enrichment pipeline name
   queries, not as standalone cron jobs.

**Timeline**: Brazoria network fix is the only external blocker.

---

## 9. Appendix: How to Re-run This Comparison

```bash
cd services/warrantdb-pipeline

# All sources (limit 50 per collection)
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/compare_v2_legacy_ingestion.py --source all --limit 50

# Single source with sample records printed
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/compare_v2_legacy_ingestion.py --source galveston --limit 25 --verbose

# JSON output for programmatic use
PYTHONPATH=$PWD \
  MONGO_URI="..." \
  MONGO_DB=warrantdb \
  python3 scripts/compare_v2_legacy_ingestion.py --source all --limit 100 --json > v2_comparison_$(date +%F).json

# Dry-run (no MongoDB required)
PYTHONPATH=$PWD python3 scripts/compare_v2_legacy_ingestion.py --dry-run
```

**Re-run recommended**: after enabling scheduled staging cron jobs, after
executing the Galveston migration, and before each formal promotion review.
