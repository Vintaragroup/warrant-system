# Ingestion Refactor — Migration Plan

> **Status:** In progress  
> **Session:** 6  
> **Goal:** Reorganize the ingestion system into three distinct layers.

---

## 1. Architecture Overview

The ingestion system is now divided into three clearly separated layers:

| Layer | Location | Trigger | Output |
|---|---|---|---|
| **Event Feed** | `ingestion/event_feeds/` | Polled every 5–10 min | Live booking events (append-only) |
| **Report** | `ingestion/reports/` | Daily scheduled batch | CSV/XLSX report records (idempotent) |
| **Lookup** | `ingestion/lookups/` | Enrichment worker on-demand | Per-person search results |

### Inheritance chain

```
BaseScraper (base_scraper.py)
  └── AuditedScraper (audited_scraper.py)
        ├── EventFeedScraper  (event_feeds/base.py)
        │     └── GalvestonP2CEventFeed  (event_feeds/galveston_p2c.py)
        ├── ReportIngestor    (reports/base.py)
        │     └── HarrisReportIngestor  (reports/harris_reports.py)
        └── LookupScraper     (lookups/base.py)
              ├── BrazoriaLookup   (lookups/brazoria_lookup.py)
              ├── FortBendLookup   (lookups/fortbend_lookup.py)
              └── JeffersonLookup  (lookups/jefferson_lookup.py)
```

---

## 2. File Classification Table

| Legacy file | County | Method | New layer | New file |
|---|---|---|---|---|
| `ingestion/galveston_p2c_fast.py` | Galveston | httpx async + Playwright sniff | **Event Feed** | `ingestion/event_feeds/galveston_p2c.py` |
| `ingestion/harris_inmate.py` | Harris | requests + WebForms CSV | **Report** | `ingestion/reports/harris_reports.py` |
| `ingestion/harris_email_roster.py` | Harris | IMAP + openpyxl/csv | **Report** | *(future: `ingestion/reports/harris_email.py`)* |
| `ingestion/brazoria_jail.py` | Brazoria | requests + BS4, requires both names | **Lookup** | `ingestion/lookups/brazoria_lookup.py` |
| `ingestion/fortbend_jail.py` | Fort Bend | requests + BS4, GET form | **Lookup** | `ingestion/lookups/fortbend_lookup.py` |
| `ingestion/jefferson_jail.py` | Jefferson | requests + BS4, ASP.NET anti-forgery | **Lookup** | `ingestion/lookups/jefferson_lookup.py` |

---

## 3. Old → New API Mapping

### Event Feed (Galveston)

| Old | New |
|---|---|
| `GalvestonP2CFastScraper(AuditedScraper)` | `GalvestonP2CEventFeed(EventFeedScraper)` |
| `scraper.run()` | `scraper.poll()` |
| `_fetch_jqgrid_json()` | `fetch_events()` (wraps httpx call) |
| `_playwright_sniff_roster()` | `_discover_endpoint()` (one-shot bootstrap, cached in DB) |
| `_parse_roster_table(html)` | `_parse_results()` + `_parse_detail_page()` |
| Manual `upsert_person()` call | `store_event()` (called by `poll()`) |

### Report (Harris)

| Old | New |
|---|---|
| `HarrisInmateScraper(BaseScraper)` | `HarrisReportIngestor(ReportIngestor)` |
| `scraper.run()` | `scraper.ingest()` |
| Inline CSV download + parse | `download_report()` → `parse_report()` |
| Manual dedup check | `_is_report_processed()` + `report_manifest` collection |
| Separate `harris_bond`, `harris_misfel`, `harris_nafiling` inserts | `store_record()` routes by `kind` field |

### Lookup (Brazoria / Fort Bend / Jefferson)

| Old | New |
|---|---|
| `search_brazoria(last, first)` → dict | `BrazoriaLookup.search_person(last, first)` → `List[LookupResult]` |
| `fetch_brazoria_detail(url)` → dict | `BrazoriaLookup.fetch_detail(url)` → dict |
| `search_fort_bend(last, first)` | `FortBendLookup.search_person(last, first)` |
| `JeffersonInmateSearchScraper._search_by_name()` | `JeffersonLookup.search_person()` |
| `_discover_antiforgery(sess)` (module-level) | `JeffersonLookup._refresh_antiforgery()` (instance method) |
| Manual surname enumeration loops | **Removed** — enumeration belongs in a caller orchestrator, not the scraper |

---

## 4. Breaking Changes

### Timestamp field renames

| Old field | New field | Notes |
|---|---|---|
| `fetched_at` | `scraped_at` | Renamed for clarity; set when HTTP response received |
| `detail_fetched_at` | `detail_fetched_at` | Unchanged; set only when detail page is fetched |
| `_ingested_at` (with underscore) | `ingested_at` | Leading underscore removed |
| `first_seen_at` (set in scraper) | `first_seen_at` (set via `$setOnInsert`) | Now immutable after first write; never overwritten |

### Removed / relocated behaviors

- **Name enumeration loops** — all `for surname in surnames:` loops are removed from the new
  lookup scrapers.  If you need to enumerate surnames for a county, write an orchestrator
  script that calls `LookupScraper.lookup()` in a loop with controlled rate limiting.
  Do NOT add this logic to the base class.

- **`since_days` parameter** — removed from lookup scrapers.  The `_within_days()` helper
  from `harris_inmate.py` belongs in the enrichment orchestrator, not individual scrapers.

- **Playwright in the hot path** — `GalvestonP2CEventFeed.fetch_events()` does not invoke
  Playwright on every poll.  Playwright is only used in `_discover_endpoint()` (one-shot),
  after which the endpoint is cached in MongoDB (`galveston_p2c_endpoint` collection).

### `run_ingestion.py` changes required

- Add `GalvestonP2CEventFeed` to `SCRAPER_SPECS` (replacing `GalvestonP2CFastScraper`).
- Add `HarrisReportIngestor` to `SCRAPER_SPECS` (replacing `HarrisInmateScraper`).
- **Do NOT add** `BrazoriaLookup`, `FortBendLookup`, `JeffersonLookup` to pipeline specs.
  Lookup scrapers are not scheduled pipeline sources.

### `run_pipeline.py` changes required

- Remove lookup scrapers from `DEFAULT_SOURCES` if they were included.
- Lookup scrapers should be invoked from `inmate_enrichment` worker scripts only.

---

## 5. MongoDB Collections

### New collections introduced

| Collection | Owner | Purpose |
|---|---|---|
| `report_manifest` | `ReportIngestor` | Tracks downloaded/ingested reports for idempotency |
| `galveston_p2c_endpoint` | `GalvestonP2CEventFeed` | Caches discovered jqHandler.ashx endpoint params |

### Unchanged collections

| Collection | Owner |
|---|---|
| `galveston_events` | `GalvestonP2CEventFeed` |
| `harris_bond` | `HarrisReportIngestor` |
| `harris_misfel` | `HarrisReportIngestor` |
| `harris_nafiling` | `HarrisReportIngestor` |
| `brazoria_inmates` | `BrazoriaLookup` |
| `fortbend_inmates` | `FortBendLookup` |
| `jefferson_events` | `JeffersonLookup` |
| `scrape_audit` | `AuditedScraper` |

---

## 6. Pending Implementation (TODOs)

These items are marked `TODO` in the new files and require full porting from the legacy scrapers:

### Event Feed
- [ ] `GalvestonP2CEventFeed._parse_roster_row()` — confirm `full_name` field index from jqGrid JSON
  (currently `None`; detail page fetch provides the name as workaround)

### Report
- [ ] `HarrisReportIngestor.normalize_record()` — port full field mapping from `harris_inmate.py`
  (currently preserves `_raw` for forward compatibility; remove `_raw` after porting)
- [ ] `HarrisReportIngestor.parse_report()` — port `_parse_rows()` / `_looks_like_dataset()` validation
- [ ] `HarrisReportIngestor` — implement WebForms POST session fallback in `download_report()`
  for files that require an authenticated session cookie

### Lookups
- [ ] `BrazoriaLookup.fetch_detail()` — port `BrazoriaScraper._parse_booking_detail()` from legacy file
- [ ] `FortBendLookup.fetch_detail()` — port `fetch_fort_bend_detail()` from legacy file
- [ ] `JeffersonLookup.fetch_detail()` — port `JeffersonInmateSearchScraper._fetch_inmate_detail()` from legacy file
- [ ] `JeffersonLookup._parse_results()` — port `_parse_list_page()` from legacy file

---

## 7. Rollout Strategy

1. **Coexistence** — legacy files (`galveston_p2c_fast.py`, `harris_inmate.py`, etc.) are
   **not deleted**.  Both old and new scrapers coexist in the codebase.  Route by source name
   in `run_ingestion.py`.

2. **Shadow run** — run the new scraper alongside the legacy one for 1–2 days.  Compare
   record counts and field coverage.  Fix any normalization gaps.

3. **Cutover** — update `run_ingestion.py` to point at new classes.  Confirm `scrape_audit`
   entries appear correctly.  Confirm `report_manifest` deduplication is working.

4. **Deprecate** — mark legacy files with a `# DEPRECATED: see ingestion/{layer}/` header
   comment.  Do not delete until the shadow run validation is complete.

---

## 8. Do Not Modify

The following files must not be modified as part of this refactor:

- `normalize_to_simple.py` — downstream normalization pipeline, untouched
- `ingestion/base_scraper.py` — root class, no changes needed
- `ingestion/audited_scraper.py` — audit mixin, no changes needed
- All legacy scraper files (`galveston_p2c_fast.py`, `harris_inmate.py`, `brazoria_jail.py`,
  `fortbend_jail.py`, `jefferson_jail.py`) — preserved as-is
