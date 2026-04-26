# Scraper Discovery Report

**Warrant System – warrantdb-pipeline**
**Date:** 2026-04-25
**Author:** Discovery Audit (Senior Python Web-Scraping Engineer)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Overview](#2-current-architecture-overview)
3. [File & Module Inventory](#3-file--module-inventory)
4. [Dependency / Package Inventory](#4-dependency--package-inventory)
5. [County-by-County Findings](#5-county-by-county-findings)
   - 5.1 Harris
   - 5.2 Brazoria
   - 5.3 Galveston
   - 5.4 Fort Bend
   - 5.5 Jefferson
6. [Website Behavior Matrix](#6-website-behavior-matrix)
7. [Scraper-Code Quality Matrix](#7-scraper-code-quality-matrix)
8. [Data Model & Ingestion Audit](#8-data-model--ingestion-audit)
9. [Alternative Data Source Matrix](#9-alternative-data-source-matrix)
10. [Recommended Target Architecture](#10-recommended-target-architecture)
11. [Prioritized Action Plan](#11-prioritized-action-plan)
12. [Quick Wins](#12-quick-wins)
13. [Medium-Term Improvements](#13-medium-term-improvements)
14. [Long-Term Data Acquisition Strategy](#14-long-term-data-acquisition-strategy)

---

## 1. Executive Summary

This pipeline scrapes inmate/booking/bond data from five Texas county sources and feeds a downstream enrichment worker via a normalized `simple_<county>` schema. The current system is functional but has several critical reliability gaps:

**Critical Issues:**

- **Galveston** (`galveston_p2c_fast.py`): `full_name` is **always null** — the P2C roster endpoint does not include names. This produces 2,196 sync skips on every run. No fix is possible without accessing the detail-page-level data for every row or finding an alternate name source.
- **Harris** (`harris_inmate.py`): The scraper targets the **District Clerk bond docket**, not the Sheriff's Office jail roster. This is _court filing data_, not real-time jail population. There is a separate, superior source at `apps.harriscountyso.org/JailInfo/` that is not scraped.
- **Fort Bend** (`fortbend_jail.py`): The raw `booking_date` column from the website actually contains **race values** (BLACK, WHITE, etc.), not dates. This is a known quirk documented in the mapping YAML. Fixed by deriving `first_seen_at` from `fetched_at`.
- **Brazoria** (`brazoria_jail.py`): Requires **both** `first` and `last` name in the POST. Running without a known-name list will return zero results.
- **Jefferson** (`jefferson_jail.py`): Entire coverage depends on a static surname list (`configs/jefferson_lastnames.txt`). New surnames not in the list are silently missed.

**Missing Packages:** `playwright` is used by Galveston and TDCJ enrichment but is **not in `requirements.txt`** and not in the `Dockerfile`. This will silently break on a fresh deployment.

**No retry/back-off logic** exists in any scraper. A transient network error or server 429 causes a permanent skip for that run.

**No structured logging.** All scrapers use `print()`. No log levels, no correlation IDs per run.

---

## 2. Current Architecture Overview

```
warrantdb-pipeline/
├── ingestion/              # Scrapers (one per county)
│   ├── base_scraper.py     # BaseScraper with upsert_person()
│   ├── audited_scraper.py  # AuditedScraper extends Base + audit tracking
│   ├── harris_inmate.py    # Harris district clerk CSV downloader
│   ├── harris_email_roster.py  # Email attachment importer
│   ├── brazoria_jail.py    # Tyler PublicAccess HTML scraper
│   ├── brazoria_ingest.py  # CLI ingest runner for Brazoria
│   ├── galveston_p2c_fast.py  # Async httpx + Playwright sniff scraper
│   ├── fortbend_jail.py    # Simple GET search scraper
│   ├── fortbend_ingest.py  # CLI ingest runner for Fort Bend
│   └── jefferson_jail.py   # ASP.NET Core search scraper (surname-driven)
├── pipeline/mapping/       # YAML-driven mapping engine
│   ├── apply.py            # Applies YAML field mappings to raw docs
│   └── transforms.py       # All transform functions
├── mappings/               # Per-county YAML mapping configs
│   ├── harris/harris_court_bonds.yaml
│   ├── brazoria/brazoria_inquiry.yaml
│   ├── galveston/galveston_p2c.yaml
│   ├── fortbend/fortbend_inmates.yaml
│   └── jefferson/jefferson_events.yaml
├── normalize_to_simple.py  # Reads raw collections → applies YAML → upserts simple_<county>
├── scripts/
│   ├── run_ingestion.py    # CLI dispatcher (--source <name>)
│   ├── run_pipeline.py     # Orchestrator: ingest → normalize → sync → report
│   ├── run_harris_e2e.py   # Harris-specific full pipeline
│   ├── sync_to_enrichment.py  # Copies simple_* → inmate_enrichment.inmates (72h window)
│   └── [20+ maintenance/utility scripts]
├── enrichment/             # Post-ingest enrichment modules
│   ├── harris_hcso_dob.py  # HCSO DOB lookup (requests + bs4)
│   ├── tdcj_enrich.py      # TDCJ inmate lookup (Playwright)
│   ├── enrich_pdl.py       # People Data Labs API client
│   └── public_records.py   # Placeholder
├── entity_resolution/
│   └── matcher.py          # Simple name+DOB hash matcher (placeholder)
├── configs/                # Per-county JSON config files + surname lists
└── storage/                # mongo_client.py shared DB connection
```

**Data flow:**

```
Website → ingestion/*.py → raw MongoDB collection (e.g. harris_bond, brazoria_inmates)
         ↓
normalize_to_simple.py + mappings/*.yaml → simple_<county> (normalized)
         ↓
sync_to_enrichment.py → inmate_enrichment.inmates (72h window filter)
         ↓
enrichment worker (separate service) → enriched inmate profiles
```

**Orchestration:** `scripts/run_pipeline.py` (via `scripts/run_twice_daily.sh`) runs all steps. Scheduled via crontab or systemd timer at 05:05 and 17:05 America/New_York. Optional Render.com deployment (`render.yaml`).

---

## 3. File & Module Inventory

### 3.1 Scraper Files

| File                               | County    | Source Website                       | Entry Point                                     | Output Collection                                 | Tech Stack                                                |
| ---------------------------------- | --------- | ------------------------------------ | ----------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------- |
| `ingestion/harris_inmate.py`       | Harris    | `hcdistrictclerk.com`                | `HarrisInmateScraper` via `run_ingestion`       | `harris_bond`, `harris_misfel`, `harris_nafiling` | requests, BeautifulSoup, CSV                              |
| `ingestion/harris_email_roster.py` | Harris    | Email IMAP attachments               | `HarrisEmailRosterImporter` via `run_ingestion` | `harris_email_roster`                             | openpyxl, xlrd, csv                                       |
| `ingestion/brazoria_jail.py`       | Brazoria  | `pubweb.brazoriacountytx.gov`        | `BrazoriaJailScraper` / `search_brazoria()`     | `brazoria_inmates`                                | requests, BeautifulSoup                                   |
| `ingestion/brazoria_ingest.py`     | Brazoria  | —                                    | `python -m ingestion.brazoria_ingest`           | `brazoria_inmates`                                | pymongo, requests                                         |
| `ingestion/galveston_p2c_fast.py`  | Galveston | `p2c.galvestoncountytx.gov`          | `GalvestonP2CFastScraper` via `run_ingestion`   | `galveston_events`                                | httpx (async), BeautifulSoup, Playwright (sniff), certifi |
| `ingestion/fortbend_jail.py`       | Fort Bend | `jailinq.fortbendcountytx.gov`       | `FortBendJailScraper` / `search_fort_bend()`    | `fortbend_inmates`                                | requests, BeautifulSoup                                   |
| `ingestion/fortbend_ingest.py`     | Fort Bend | —                                    | `python -m ingestion.fortbend_ingest`           | `fortbend_inmates`                                | pymongo, requests                                         |
| `ingestion/jefferson_jail.py`      | Jefferson | `jeffersoncountytx.gov/InmateSearch` | `JeffersonJailScraper` via `run_ingestion`      | `jefferson_events`                                | requests, BeautifulSoup, lxml                             |

### 3.2 Base Classes

| File                           | Purpose                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `ingestion/base_scraper.py`    | `BaseScraper` — shared `upsert_person()` with `_ext_id`/booking/name+DOB key strategy                                     |
| `ingestion/audited_scraper.py` | `AuditedScraper` — extends Base; tracks scrape_audit records in MongoDB, adds counters for links found / upserts / errors |

### 3.3 Pipeline & Normalization

| File                             | Purpose                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `normalize_to_simple.py`         | Main normalizer: iterates raw collection, applies YAML mapping, upserts `simple_<county>` |
| `pipeline/mapping/apply.py`      | YAML field-mapping engine                                                                 |
| `pipeline/mapping/transforms.py` | All transform functions (parse_date, to_iso_datetime, decode_sex_code, etc.)              |

### 3.4 Enrichment Modules

| File                            | County / Source  | Method                                      |
| ------------------------------- | ---------------- | ------------------------------------------- |
| `enrichment/harris_hcso_dob.py` | Harris / HCSO    | requests + BeautifulSoup (URL configurable) |
| `enrichment/tdcj_enrich.py`     | TDCJ statewide   | Playwright (requires installation)          |
| `enrichment/enrich_pdl.py`      | People Data Labs | REST API (requires `PDL_API_KEY`)           |
| `enrichment/public_records.py`  | Placeholder      | Not implemented                             |

### 3.5 Orchestration Scripts

| Script                                   | Purpose                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `scripts/run_ingestion.py`               | Dispatcher: loads scraper class by name, calls `fetch()` or `run()`      |
| `scripts/run_pipeline.py`                | Full pipeline: ingest → normalize → sync → report                        |
| `scripts/run_harris_e2e.py`              | Harris: fetch email → import → ingest → normalize → rebucket → report    |
| `scripts/run_twice_daily.sh`             | Shell wrapper for cron/systemd; sets all env vars                        |
| `scripts/sync_to_enrichment.py`          | Copies `simple_*` → `inmate_enrichment.inmates` (72h eligibility window) |
| `scripts/mark_existing_inmates_stale.py` | One-time migration: marks pre-policy records as STALE                    |

### 3.6 Utility / Maintenance Scripts (selected)

| Script                                                                          | Purpose                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------- |
| `scripts/setup_indexes.py`, `setup_indexes_events.py`, `setup_indexes_extra.py` | MongoDB index creation                            |
| `scripts/report_simple_deltas.py`                                               | Reports new/changed records per run               |
| `scripts/scan_anomalies_simple_harris.py`                                       | Anomaly detection in simple_harris                |
| `scripts/fix_anomalies_simple_harris.py`                                        | Address cleaning, bad SPN marking                 |
| `scripts/backfill_booking_datetime_harris.py`                                   | Backfills booking_datetime from strings           |
| `scripts/enrich_harris_dob.py`                                                  | DOB enrichment via HCSO                           |
| `scripts/tdcj_ivss_recent_intakes.py`                                           | TDCJ recent intake check                          |
| `scripts/cleanup_stale_simple_docs.py`                                          | Deletes null-upsert-key docs                      |
| `scripts/nightly_simple_harris.sh`                                              | Nightly Harris maintenance (anomaly scan + fixes) |

---

## 4. Dependency / Package Inventory

### 4.1 Current `requirements.txt`

```
fastapi==0.111.0
uvicorn[standard]==0.30.5
pydantic==2.8.2
pymongo==4.7.3
python-dotenv==1.0.1
requests==2.32.3
httpx==0.27.2
beautifulsoup4==4.12.3
lxml==5.3.0
PyYAML==6.0.2
openpyxl==3.1.5
xlrd==2.0.1
dropbox==12.0.2
pdfminer.six==20250506
python-dateutil==2.9.0.post0
selenium==4.24.0
webdriver-manager==4.0.2
```

### 4.2 Package Analysis

| Package                  | Status            | Notes                                                                                                                                                                   |
| ------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requests`               | ✅ Used           | Harris, Brazoria, Fort Bend, Jefferson, HCSO enrichment                                                                                                                 |
| `httpx`                  | ✅ Used           | Galveston async fetch                                                                                                                                                   |
| `beautifulsoup4`         | ✅ Used           | All HTML scrapers                                                                                                                                                       |
| `lxml`                   | ✅ Used           | Jefferson (lxml parser in BeautifulSoup calls)                                                                                                                          |
| `pymongo`                | ✅ Used           | All scrapers                                                                                                                                                            |
| `python-dotenv`          | ✅ Used           | Env loading                                                                                                                                                             |
| `PyYAML`                 | ✅ Used           | Mapping YAML files                                                                                                                                                      |
| `python-dateutil`        | ✅ Used           | `transforms.py` date parsing                                                                                                                                            |
| `pydantic`               | ✅ Used (API)     | FastAPI request validation; not used in scrapers                                                                                                                        |
| `fastapi` + `uvicorn`    | ✅ Used (API)     | `api/main.py`                                                                                                                                                           |
| `openpyxl`               | ✅ Used           | Email roster XLSX parsing                                                                                                                                               |
| `xlrd`                   | ✅ Used           | Email roster legacy XLS                                                                                                                                                 |
| `certifi`                | ✅ Used (import)  | Galveston SSL verification (optional)                                                                                                                                   |
| `pdfminer.six`           | ⚠️ Possibly used  | `scripts/jefferson_pdf_recent_bonds.py` — confirm usage                                                                                                                 |
| `dropbox`                | ⚠️ Low confidence | No active scraper code imports it; possible legacy artifact                                                                                                             |
| `selenium`               | ❌ NOT USED       | No scraper currently uses Selenium. Should be removed or replaced with Playwright                                                                                       |
| `webdriver-manager`      | ❌ NOT USED       | Only relevant if Selenium is used; remove                                                                                                                               |
| **`playwright`**         | ❌ MISSING        | Used by `galveston_p2c_fast.py` (`_playwright_sniff_roster`) and `enrichment/tdcj_enrich.py`. **Not in requirements.txt or Dockerfile.** Will fail on fresh deployment. |
| `tenacity`               | ❌ MISSING        | No retry logic in any scraper. Should be added.                                                                                                                         |
| `structlog` or `logging` | ❌ Not used       | All scrapers use raw `print()`.                                                                                                                                         |

### 4.3 Recommended Scraping Stack

| Component            | Recommended Package                                 | Reason                                         |
| -------------------- | --------------------------------------------------- | ---------------------------------------------- |
| HTTP (simple sites)  | `requests` (keep)                                   | Sufficient for Tyler/HCSO sites                |
| HTTP (async / AJAX)  | `httpx` (keep)                                      | Galveston uses it well                         |
| HTML parsing         | `beautifulsoup4` + `lxml` (keep)                    | Current combo is solid                         |
| JS-rendering / sniff | `playwright` (add to requirements)                  | Already used; just missing from deps           |
| Retry / back-off     | `tenacity` (add)                                    | Critical for reliability                       |
| Structured logging   | stdlib `logging` with JSON formatter or `structlog` | Replaces print statements                      |
| Data validation      | `pydantic` v2 (keep; extend to scrapers)            | Currently only used in API layer               |
| Date parsing         | `python-dateutil` (keep)                            | Already handles edge cases                     |
| **Remove**           | `selenium`, `webdriver-manager`                     | Unused; dead weight; security risk if outdated |

---

## 5. County-by-County Findings

---

### 5.1 Harris

#### 5.1.1 Scraper Overview

- **File:** `ingestion/harris_inmate.py`
- **Source:** `https://www.hcdistrictclerk.com/Common/e-services/PublicDatasets.aspx`
- **Source type:** Harris County **District Clerk** — court bond docket data, **not** the HCSO jail roster
- **Method:** Downloads CSV files via ASP.NET WebForms POST (scrapes ViewState/EVENTVALIDATION tokens first)
- **Data types:** 3 file kinds × 2 court groups = 6 potential CSV files per run
  - `bond` — civil/criminal bond filings (case + SPN + amount)
  - `misfel` — misdemeanor/felony listings (SPN + DOB + bond)
  - `nafiling` — non-filing docket entries
- **Output collections:** `harris_bond`, `harris_misfel`, `harris_nafiling`
- **Upsert key:** `(county, category, anchor)` → `anchor` derived from SPN or case_number
- **Entry point:** `python -m scripts.run_ingestion --source harris_inmate` or `python -m scripts.run_harris_e2e`

#### 5.1.2 What it does well

- Handles both GET (public file listing) and POST (WebForms download) with graceful fallback.
- HTML-guard in `_looks_like_dataset()` prevents treating error/redirect pages as data.
- Multi-format date parsing (`_normalize_date_token`) with several strptime formats.
- `_within_days()` staleness guard prevents re-processing old CSV files.
- `scraped_at` is consistently set.
- Has a separate email roster importer for XLSX attachments (`harris_email_roster.py`).
- Harris E2E runner (`run_harris_e2e.py`) orchestrates the full flow cleanly.

#### 5.1.3 Failure Risks / Issues

1. **Wrong data source for bail-bonds use case.** The District Clerk portal provides _court case data_ (who has filed bonds in court), not the _current jail population_ or _active warrant list_. For live bond opportunities, the Sheriff's Office jail roster (`apps.harriscountyso.org/JailInfo/`) or the warrant search (`apps.harriscountyso.org/warrants/`) is far more relevant.
2. **WebForms tokens expire.** If the POST is not performed within the same session as the GET, `__EVENTVALIDATION` will reject the request. The current code re-GETs the page before every POST, which is correct, but adds one extra roundtrip per download.
3. **No DOB in bond/nafiling data.** Only `misfel` files include DOB. The `harris_court_bonds.yaml` mapping sets `dob: const: null`. This limits enrichment matching.
4. **Full name format is `LAST, FIRST MIDDLE`.** The mapping derives `full_name: from: name` but the `name` field is constructed as `"LAST, FIRST_MIDDLE"` — comma-separated. The normalizer's `extract_last`/`extract_first_plus_middle` transforms must correctly parse this, but this should be verified.
5. **`booking_date` uses `file_date`.** Harris bond data has no booking date; `file_date` (court filing date) is used as a proxy via the mapping. This is semantically misleading — `file_date` is when the case was filed in court, often days/weeks after booking.
6. **`booking_number: const: null`** — Harris court data does not have booking numbers, so every record falls back to the anchor key using SPN or case_number.
7. **No retry.** A single failed HTTP request drops the entire CSV for that group/kind.
8. **`scraped_at` uses naive UTC** — `dt.datetime.now(dt.timezone.utc)` is correct, but some uses of `dt.datetime.utcnow()` (deprecated Python 3.12) appear in booking age calculations.

#### 5.1.4 Timestamp Handling

| Field               | Source                                       | Status                                 |
| ------------------- | -------------------------------------------- | -------------------------------------- |
| `scraped_at`        | `dt.datetime.now(dt.timezone.utc)`           | ✅ Set on every doc                    |
| `_ingested_at`      | Not explicitly set                           | ⚠️ Relying on `normalize_to_simple.py` |
| `first_seen_at`     | Not set                                      | ❌ Missing                             |
| `booking_date`      | Derived from `file_date` (court filing date) | ⚠️ Semantically wrong                  |
| `detail_fetched_at` | N/A (no detail pages)                        | —                                      |

#### 5.1.5 Improvement Recommendations

| Item                                                               | Priority | Difficulty |
| ------------------------------------------------------------------ | -------- | ---------- |
| Add HCSO jail roster scraper (`apps.harriscountyso.org/JailInfo/`) | HIGH     | Medium     |
| Add HCSO warrant search scraper                                    | HIGH     | Medium     |
| Add tenacity retry to all CSV download attempts                    | Medium   | Low        |
| Replace `utcnow()` with `datetime.now(timezone.utc)`               | Low      | Low        |
| Document that `booking_date = file_date` is a proxy                | Low      | Low        |

---

### 5.2 Brazoria

#### 5.2.1 Scraper Overview

- **File:** `ingestion/brazoria_jail.py`
- **Source:** `https://pubweb.brazoriacountytx.gov/PublicAccess/JailingSearch.aspx?ID=400`
- **Platform:** Tyler Technologies PublicAccess
- **Method:** GET with name params; falls back to POST with hidden fields + date window
- **Output collection:** `brazoria_inmates`
- **Upsert key:** `booking_number` (unique index)
- **Entry point:** `python -m ingestion.brazoria_ingest` or `python -m scripts.run_ingestion --source brazoria_jail`

#### 5.2.2 What it does well

- Handles both GET and POST (with ASP.NET hidden field collection via `_collect_hidden_fields`).
- Session warm-up (cookies, referrer headers) before search.
- Detects and handles `Public Access Error` pages and `_is_search_form()` redirect bounces.
- Has a `since_days` parameter to limit the fetch window (default 60 days).
- Fetches detail pages via `fetch_brazoria_detail()` to extract per-charge bond amounts.
- Has debug HTML dumping (`_dump_html`) with max-file pruning (`MAX_DEBUG = 20`).
- `AuditedScraper` integration → writes to `scrape_audit` collection.
- `_to_int_money()` reliably strips `$`, `,`, `\xa0` from money strings.

#### 5.2.3 Failure Risks / Issues

1. **Requires BOTH first and last name.** The guard `if (last and not first) or (first and not last): return []` means that searching by last name alone is blocked. This is enforced because Tyler's Defendant search returns garbage results with only one name. However, this means the scraper can only cover **known-name individuals**. Without a comprehensive Brazoria surname list (unlike Jefferson, no such list exists in `configs/`), coverage will be very low.
2. **No surname list configured.** `configs/brazoria.json` does not include a last names file. There is no equivalent of Jefferson's `jefferson_lastnames.txt` for Brazoria, and no ingestion loop that iterates over name prefixes. The existing `ingestion/brazoria_ingest.py` appears to be a CLI wrapper that would need to be called with specific name args, or a name-iteration loop needs to be built.
3. **Duplicate helper code.** `_calculate_booking_age_category()` and `_get_booking_priority()` are copy-pasted identically across `brazoria_jail.py`, `fortbend_jail.py`, `harris_inmate.py`, and `audited_scraper.py`. The version in `audited_scraper.py` should be the canonical one.
4. **`detail_fetched_at` stored as `dt.datetime` object** (not ISO string) in `fetch_brazoria_detail()`. MongoDB will store it as a Date type, but downstream code that stringifies fields may fail.
5. **Tyler portal pagination.** Tyler's `JailingSearch.aspx` typically shows 25 results per page. If a name prefix search returns >25 results, only the first page is captured. No pagination loop exists.
6. **No retry.**

#### 5.2.4 Timestamp Handling

| Field               | Source                                                | Status            |
| ------------------- | ----------------------------------------------------- | ----------------- |
| `fetched_at`        | `dt.datetime.now(dt.timezone.utc)`                    | ✅ Set            |
| `scraped_at`        | `dt.datetime.now(dt.timezone.utc)`                    | ✅ Set (alias)    |
| `detail_fetched_at` | `dt.datetime.now(dt.timezone.utc)` as datetime object | ⚠️ Not ISO string |
| `booking_date_iso`  | Parsed from raw `booking_date`                        | ✅ When available |
| `first_seen_at`     | Not set                                               | ❌ Missing        |

#### 5.2.5 Improvement Recommendations

| Item                                                  | Priority | Difficulty |
| ----------------------------------------------------- | -------- | ---------- |
| Build a surname-iteration loop (like Jefferson)       | HIGH     | Medium     |
| Add Tyler pagination (page-through results)           | HIGH     | Medium     |
| Move booking age helpers to `audited_scraper.py` only | Medium   | Low        |
| Standardize `detail_fetched_at` to ISO string         | Low      | Low        |
| Add tenacity retry                                    | Medium   | Low        |

---

### 5.3 Galveston

#### 5.3.1 Scraper Overview

- **File:** `ingestion/galveston_p2c_fast.py`
- **Source:** `https://p2c.galvestoncountytx.gov/jailinmates.aspx`
- **Platform:** P2C (Police to Citizen) — Galveston County Sheriff's Office
- **Method:** httpx async fetch + optional Playwright sniff to discover `jqHandler.ashx` endpoint
- **Output collection:** `galveston_events`
- **Upsert key:** `(county, category, anchor)` — anchor derived from `person_id` or `source_url`
- **Entry point:** `python -m scripts.run_ingestion --source galveston_p2c_fast`

#### 5.3.2 What it does well

- **Decoupled fetch/sniff architecture.** The `_playwright_sniff_roster()` function uses Playwright to discover the `jqHandler.ashx` AJAX endpoint, then subsequent runs use the discovered URL with httpx. This is a sophisticated approach to handle dynamically-loaded data without needing Playwright on every run.
- `_bump_rows_in_payload()` bumps the `rows=N` parameter to `ROWS_MAX=5000` to fetch the full roster.
- `_normalize_detail_url()` strips volatile `navid` query params to prevent deduplication drift.
- Async concurrency with `GALV_CONCURRENCY=10` for detail-page fetching.
- Mugshot saving support (link/bytes/GridFS modes).
- Controlled snapshot system with global pruning.
- `ROW_DELAY=0.5s` between requests as courtesy throttle.

#### 5.3.3 Critical Issues

1. **`full_name: const: null` in mapping YAML.** The P2C jail roster endpoint (`jqHandler.ashx`) returns tabular data including `Name`, `Primary Charge`, `Arrest Date`, `Booking Agency` — all visible in the roster list at `jailinmates.aspx`. However, the parsed JSON/HTML data going into `galveston_events` is apparently not capturing the `full_name` field, and it has been hard-coded to `null` in the mapping. This is the root cause of 2,196 sync skips per run. **Investigation required:** determine whether the `jqHandler.ashx` response includes a name field, and whether the scraper is mapping it.
2. **`playwright` not in requirements.txt.** The `_playwright_sniff_roster()` function imports `playwright.sync_api` inside a try/except, so it fails silently — meaning the sniff silently returns `None`, and the scraper falls back to a direct httpx fetch using a previously-sniffed or hardcoded URL. On a fresh deployment without Playwright installed, the sniff will always fail, potentially causing the AJAX URL to be wrong.
3. **SSL verification disabled by default** (`SCRAPER_VERIFY_SSL=false` by default). The site uses a valid certificate. This should be enabled.
4. **No retry on httpx requests.** A 429 or 503 causes a skipped inmate.
5. **`_BAD_NAME_RE` filter.** Rows with names matching HOME, DAILY BULLETIN, INMATE INQUIRY, ARRESTS, etc. are dropped — these appear to be navigation link text that bleeds into the parsed table. This indicates a fragile selector that captures non-data rows.

#### 5.3.4 Timestamp Handling

| Field               | Source                       | Status                        |
| ------------------- | ---------------------------- | ----------------------------- |
| `scraped_at`        | Set in scraper output        | ✅                            |
| `fetched_at`        | Set in scraper               | ✅                            |
| `detail_fetched_at` | Set when detail page fetched | ✅                            |
| `booked_at`         | Parsed from P2C roster       | ✅ (mapped to `booking_date`) |
| `first_seen_at`     | Not set                      | ❌ Missing                    |
| `full_name`         | **Always null**              | ❌ Critical gap               |

#### 5.3.5 Improvement Recommendations

| Item                                                                | Priority | Difficulty    |
| ------------------------------------------------------------------- | -------- | ------------- |
| Investigate `jqHandler.ashx` response — does it contain names?      | CRITICAL | Low (inspect) |
| If names in AJAX response: fix mapping YAML to populate `full_name` | CRITICAL | Low           |
| Add `playwright` to `requirements.txt` and `Dockerfile`             | HIGH     | Low           |
| Enable SSL verification                                             | Medium   | Low           |
| Add tenacity retry for httpx                                        | Medium   | Low           |
| Investigate Galveston Odyssey portal for supplemental name data     | Medium   | Medium        |

---

### 5.4 Fort Bend

#### 5.4.1 Scraper Overview

- **File:** `ingestion/fortbend_jail.py`
- **Source:** `https://jailinq.fortbendcountytx.gov/`
- **Platform:** Custom jail inquiry system (not Tyler)
- **Method:** GET with `LastName=`, `FirstName=`, `SearchButton=Search` params
- **Output collection:** `fortbend_inmates`
- **Upsert key:** `(county, category, anchor)` — anchor is `booking_number` or `jail_id`
- **Entry point:** `python -m ingestion.fortbend_ingest` or `python -m scripts.run_ingestion --source fortbend_jail`

#### 5.4.2 What it does well

- Simple GET-based search — no session tokens, no CAPTCHA observed.
- `#InmatesTable` CSS selector with widest-table fallback.
- Detail page fetching via `fetch_fort_bend_detail()` — finds charge/bond tables.
- Column-shift detection: `if name.isdigit() and "," in id` swaps booking_number vs name columns.
- Debug HTML dumping with pruning.

#### 5.4.3 Failure Risks / Issues

1. **`booking_date` raw column holds race values.** The raw `booking_date` field from the website stores race/ethnicity (BLACK, WHITE, HISPANIC, etc.), not a booking date. This is documented in the mapping YAML (`race: from: booking_date`). Booking date is now derived from `first_seen_at` (= `fetched_at`) — this is a workaround, not the real booking date.
2. **No `gender` field.** The mapping sets `gender: const: null`. Gender is not returned by this website in the list view.
3. **Column mapping is brittle.** The scraper assigns `tds[0]` → name, `tds[1]` → id, `tds[2]` → dob, `tds[3]` → booking_date based on positional index. If the website adds/removes a column, all mappings break silently.
4. **No pagination.** Fort Bend's search returns a table of all matching results on a single page. This is likely fine for individual name searches, but if iterating over prefixes, large result sets may be truncated server-side.
5. **No surname iteration loop.** Like Brazoria, there is no built-in loop to systematically iterate last-name prefixes. Coverage depends on the caller providing search terms.
6. **`VarJailID` extraction.** The `jail_id` is extracted from the detail URL pattern `VarJailID=([A-Za-z0-9]+)`, which is brittle if the URL scheme changes.
7. **`booking_date_iso = None`** for most records (since the raw column is race). The `_calculate_booking_age_category` will return `"unknown"` for all Fort Bend records.

#### 5.4.4 Timestamp Handling

| Field               | Source                                        | Status                        |
| ------------------- | --------------------------------------------- | ----------------------------- |
| `fetched_at`        | `dt.datetime.now(dt.timezone.utc)`            | ✅                            |
| `scraped_at`        | `dt.datetime.now(dt.timezone.utc)`            | ✅ (same as fetched_at)       |
| `detail_fetched_at` | Set in `fetch_fort_bend_detail()`             | ✅                            |
| `booking_date`      | Derived from `first_seen_at` (= `fetched_at`) | ⚠️ Proxy only                 |
| `first_seen_at`     | Set in YAML from `fetched_at`                 | ✅ (fix applied this session) |

#### 5.4.5 Improvement Recommendations

| Item                                                               | Priority | Difficulty |
| ------------------------------------------------------------------ | -------- | ---------- |
| Investigate whether Fort Bend detail page includes booking date    | HIGH     | Low        |
| Add surname iteration loop (prefix-based)                          | HIGH     | Medium     |
| Fix column parsing to use header names instead of positional index | Medium   | Low        |
| Add `gender` extraction from detail page                           | Medium   | Low        |
| Add tenacity retry                                                 | Medium   | Low        |

---

### 5.5 Jefferson

#### 5.5.1 Scraper Overview

- **File:** `ingestion/jefferson_jail.py`
- **Source:** `https://jeffersoncountytx.gov/InmateSearch`
- **Platform:** ASP.NET Core MVC with anti-forgery token
- **Method:** GET form with `LastName` and optional `FirstName`, then POST to `/Search/List`
- **Search strategy:** Surname-driven iteration from `configs/jefferson_lastnames.txt`
- **Output collection:** `jefferson_events`
- **Upsert key:** `(county, category, anchor)` — anchor derived from `booking_number` or `_ext_id`
- **Entry point:** `python -m scripts.run_ingestion --source jefferson_jail`

#### 5.5.2 What it does well

- **Anti-forgery token discovery** (`_discover_antiforgery()`) handles hidden input, meta tag, cookie fallbacks — robust across ASP.NET variants.
- **Snapshot system** for debugging search form, results, and detail pages.
- **`tr.clickable-row[data-href]`** — uses semantic row selector for detail links with anchor fallback.
- **`_extract_property_pairs()`** — multi-strategy property extractor (div.detail-property-title pairs → dl/dt/dd → keymap normalization).
- **`_extract_charges()`** — extracts charge rows from detail page.
- **`total_bond`** computed as sum of all per-charge bond amounts.
- **State tracking** (`STATE_DOC_ID = "jefferson_scrape_state"`) persists scrape state to MongoDB.
- **Rate limiting**: `ROW_DELAY=0.6s`, `SEARCH_DELAY=1s`, `JEFF_REQ_TIMEOUT=30`.
- Loads surnames from MongoDB (`jefferson_events.distinct("last_name")`) as supplement to file-based list.

#### 5.5.3 Failure Risks / Issues

1. **Coverage limited to surname list.** If a surname is not in `configs/jefferson_lastnames.txt` or previously seen in `jefferson_events`, it will never be scraped. The file is a static `jefferson_lastnames.txt` (size unknown without reading it). New inmates with uncommon surnames are silently missed.
2. **Wildcards explicitly disabled.** Comment states `APPEND_WILDCARD_DEFAULT = False  # Wildcards don't work`. This means partial-name matching is unavailable.
3. **`dob: None` hardcoded.** The Jefferson detail page shows "Age at Arrest" but not DOB. DOB is never populated.
4. **`booking_number: None`** — Jefferson's detail page does not appear to include a booking number. Anchor falls back to `_ext_id` derived from the detail URL `/Detail/12345`.
5. **`sex` field from detail page is the raw string** ("Male"/"Female" etc.) before `decode_sex_code` transform — verify the transform handles this correctly.
6. **Anti-forgery token may change per-session.** The scraper re-fetches the form before each surname search, which is correct. However, rate limits on too-many GET requests to the form page could trigger IP bans.
7. **`MAX_RESULTS_PER_PREFIX=2000`** — if a common surname has >2000 results, only 2000 are processed. Jefferson is a smaller county so this is unlikely, but the check is still good to have.
8. **Parallel search not used.** Surname iteration is sequential. For a large surname list, this could be very slow. (Jefferson is a mid-sized county so this is acceptable for now.)

#### 5.5.4 Timestamp Handling

| Field               | Source                                     | Status     |
| ------------------- | ------------------------------------------ | ---------- |
| `booked_at`         | Parsed from "Jail Entry Time" detail field | ✅         |
| `scraped_at`        | Set by `AuditedScraper`                    | ✅         |
| `detail_fetched_at` | Not explicitly tracked                     | ⚠️         |
| `first_seen_at`     | Not set                                    | ❌ Missing |
| `dob`               | **Always null**                            | ❌         |

#### 5.5.5 Improvement Recommendations

| Item                                                                                  | Priority | Difficulty |
| ------------------------------------------------------------------------------------- | -------- | ---------- |
| Expand surname list or switch to alphabet-sweep (A..Z) if site allows blank last name | HIGH     | Low        |
| Add `detail_fetched_at` tracking                                                      | Medium   | Low        |
| Investigate whether "booking number" appears elsewhere on detail page                 | Medium   | Low        |
| Add tenacity retry                                                                    | Medium   | Low        |
| Consider caching anti-forgery token per session (not per-surname)                     | Medium   | Low        |

---

## 6. Website Behavior Matrix

| County        | URL                                | Requires JS          | Session Cookies | CAPTCHA | POST/GET          | Hidden Tokens              | Pagination             | Name Req'd         | Detail Pages | SSL      |
| ------------- | ---------------------------------- | -------------------- | --------------- | ------- | ----------------- | -------------------------- | ---------------------- | ------------------ | ------------ | -------- |
| Harris (DC)   | hcdistrictclerk.com                | No                   | Yes             | No      | POST              | ViewState, EventValidation | No (bulk CSVs)         | No (bulk download) | No           | ✅ Valid |
| Harris (HCSO) | apps.harriscountyso.org            | Unknown              | Unknown         | Unknown | Unknown           | Unknown                    | Unknown                | Partial            | Unknown      | ✅ Valid |
| Brazoria      | pubweb.brazoriacountytx.gov        | No                   | Yes             | No      | GET+POST fallback | ASP.NET hidden fields      | Yes (25/page) ⚠️       | Both first+last    | Yes          | ✅ Valid |
| Galveston     | p2c.galvestoncountytx.gov          | Yes (jqHandler.ashx) | Yes             | No      | GET (after sniff) | AJAX session params        | rows=N param           | No (full roster)   | Yes          | ✅ Valid |
| Fort Bend     | jailinq.fortbendcountytx.gov       | No                   | Minimal         | No      | GET               | None observed              | Possibly (unconfirmed) | No (blank allowed) | Yes          | ✅ Valid |
| Jefferson     | jeffersoncountytx.gov/InmateSearch | No                   | Yes             | No      | GET+POST          | Anti-forgery token         | Results page           | Last name required | Yes          | ✅ Valid |

**Key observations:**

- All sites use valid TLS. SSL verification should be **enabled** everywhere.
- Galveston is the only site requiring JavaScript-rendered data discovery; after sniff, httpx suffices.
- Brazoria and Jefferson require name input (cannot enumerate entire jail population blindly).
- Harris District Clerk is unique in providing bulk CSV file downloads — no HTML scraping needed after token acquisition.

---

## 7. Scraper-Code Quality Matrix

| County          | Retry Logic | Logging | Dedup Key             | Detail Pages | Pagination         | Name Split         | Timestamps                       | Booking Date            | Error Handling        | Overall |
| --------------- | ----------- | ------- | --------------------- | ------------ | ------------------ | ------------------ | -------------------------------- | ----------------------- | --------------------- | ------- |
| Harris (inmate) | ❌ None     | print() | SPN/case_no ✅        | N/A (CSV)    | N/A (bulk)         | LAST, FIRST ✅     | scraped_at ✅                    | File date proxy ⚠️      | HTML guard ✅         | B       |
| Brazoria        | ❌ None     | print() | booking_no ✅         | ✅ Fetches   | ❌ First page only | name string ✅     | fetched_at, detail_fetched_at ✅ | booking_date_iso ✅     | Error catch ✅        | B-      |
| Galveston       | ❌ None     | print() | person_id/URL ✅      | ✅ Async     | rows=5000 ✅       | ❌ **Always null** | scraped_at, booked_at ✅         | booked_at ✅            | try/except ✅         | C+      |
| Fort Bend       | ❌ None     | print() | booking_no/jail_id ✅ | ✅ Fetches   | ❌ Unconfirmed     | name string ✅     | fetched_at ✅                    | ❌ Race value / derived | Column shift guard ✅ | C+      |
| Jefferson       | ❌ None     | print() | \_ext_id/anchor ✅    | ✅ Fetches   | ✅ State tracked   | full_name split ✅ | booked_at ✅                     | Jail entry time ✅      | Snapshot on fail ✅   | B+      |

---

## 8. Data Model & Ingestion Audit

### 8.1 Current Raw Collection Schema

Each county's raw collection stores a slightly different document shape. Common fields:

```
booking_number      string | null
name / full_name    string (LAST, FIRST or LAST FIRST formats vary)
dob                 ISO date string | null (Harris misfel only)
booking_date        string | date object | null
scraped_at          datetime
fetched_at          datetime
source              string
detail_url          string | null
charges             [{charge, bond_amount, ...}]
bond_total          number | null
```

### 8.2 Normalized `simple_<county>` Schema

After normalization via `normalize_to_simple.py` + mapping YAML:

```
_upsert_key         {county, category, anchor}  — compound upsert key
county              string
category            "Criminal" | "Civil"
full_name           string | null
last_name           string | null
first_name          string | null
middle_name         string | null
dob                 ISO date | null
gender              "M" | "F" | null
sex                 same as gender
race                string | null
booking_number      string | null
spn                 string | null
jail_id             string | null
anchor              string — derived from booking_number or jail_id
booking_date        ISO datetime | null
booking_datetime    ISO datetime | null  (derived by normalizer)
first_seen_at       ISO datetime | null
release_date        ISO datetime | null
offense             string | null
bond_amount         number | null
bond_type           string | null
case_number         string | null
source_url          string | null
agency              string | null
facility            string | null
_normalized_at      ISO datetime (set by normalize_to_simple.py)
_ingested_at        ISO datetime (set by normalizer)
```

### 8.3 Schema Inconsistencies

| Field            | Harris             | Brazoria          | Galveston      | Fort Bend                         | Jefferson          |
| ---------------- | ------------------ | ----------------- | -------------- | --------------------------------- | ------------------ |
| `full_name`      | ✅ LAST, FIRST     | ✅ uppercase      | ❌ null        | ✅ uppercase                      | ✅ uppercase       |
| `dob`            | ✅ misfel only     | ✅ when available | ❌ null        | ❌ null                           | ❌ null            |
| `booking_number` | ❌ null            | ✅                | ⚠️ often null  | ✅                                | ⚠️ null            |
| `booking_date`   | ⚠️ file_date proxy | ✅                | ✅ booked_at   | ⚠️ derived (fetched_at)           | ✅ jail entry time |
| `gender`         | ✅ decoded         | ✅                | ✅             | ❌ null                           | ✅ decoded         |
| `race`           | ✅ decoded         | ✅                | ✅             | ✅ (from raw booking_date field!) | ✅                 |
| `charges`        | ✅ (denormalized)  | ✅ from detail    | ✅ from detail | ✅ from detail                    | ✅ from detail     |
| `bond_amount`    | ✅                 | ✅                | ✅             | ✅                                | ✅                 |
| `source_url`     | ❌                 | ❌                | ✅             | ✅ via detail_url                 | ✅                 |

### 8.4 Recommended Canonical Schema

```python
class SimpleInmateSchema(BaseModel):
    # --- Identity ---
    county: str
    category: str = "Criminal"
    anchor: str                          # stable dedup key
    full_name: Optional[str]             # "LAST, FIRST MIDDLE" normalized
    last_name: Optional[str]
    first_name: Optional[str]
    middle_name: Optional[str]

    # --- Demographics ---
    dob: Optional[str]                   # ISO date YYYY-MM-DD
    gender: Optional[Literal["M", "F", "U"]]
    race: Optional[str]

    # --- Booking ---
    booking_number: Optional[str]
    spn: Optional[str]                   # Harris Sheriff's Person Number
    jail_id: Optional[str]               # Site-specific ID
    booking_date: Optional[str]          # ISO datetime UTC
    booking_datetime: Optional[str]      # derived datetime (highest precision)
    first_seen_at: Optional[str]         # When first scraped
    release_date: Optional[str]

    # --- Legal ---
    offense: Optional[str]
    charges: Optional[List[Dict]]
    bond_amount: Optional[float]
    bond_type: Optional[str]
    case_number: Optional[str]

    # --- Source ---
    county_source: str                   # e.g. "harris_bond", "galveston_p2c"
    source_url: Optional[str]
    agency: Optional[str]
    facility: Optional[str]

    # --- Pipeline timestamps ---
    scraped_at: str                      # ISO UTC datetime
    _ingested_at: str                    # Set by normalizer
    _normalized_at: str                  # Set by normalizer
    detail_fetched_at: Optional[str]

    # --- Quality flags ---
    booking_date_confidence: Optional[Literal["actual", "proxy_fetched_at", "file_date"]]
    has_full_name: bool
    has_dob: bool
    has_booking_date: bool
```

### 8.5 Deduplication Strategy

**Current strategy:**

- Raw collections: upsert on `_ext_id` or `booking_number` or `(full_name, dob)` — see `BaseScraper.upsert_person()`
- `simple_<county>` collections: upsert on `_upsert_key = {county, category, anchor}` compound index
- `inmate_enrichment.inmates`: upsert on `_upsert_key` (same)

**Issues:**

- `entity_resolution/matcher.py` is a placeholder — simple `name+DOB` SHA1 hash with no fuzzy matching, no phonetic matching.
- Cross-county deduplication is not implemented. The same person booked in Harris and Jefferson will appear as two separate records.
- `full_name` case normalization is inconsistent — some raw sources use UPPER, some use Title Case.
- No soundex/metaphone for name matching.

---

## 9. Alternative Data Source Matrix

### 9.1 Harris County

| Source                | Type                          | URL                                 | Reliability | Legal      | Easier than scraping?                   |
| --------------------- | ----------------------------- | ----------------------------------- | ----------- | ---------- | --------------------------------------- |
| **HCSO JailInfo**     | Live jail roster              | `apps.harriscountyso.org/JailInfo/` | High        | Public     | Yes — currently not scraped             |
| **HCSO Warrants**     | Active warrants               | `apps.harriscountyso.org/warrants/` | High        | Public     | Yes — currently not scraped             |
| **Harris Courts**     | Case/bond data                | `www.myharriscountycases.com`       | High        | Public     | Yes (current source via District Clerk) |
| **Vinelink**          | Custody status                | vinelink.com (Harris)               | Medium      | Public     | Partial                                 |
| **HCSO API**          | Unknown — needs investigation | —                                   | Unknown     | Unknown    | —                                       |
| **Texas OCA / CAPRS** | Court records aggregator      | —                                   | High        | Restricted | No — requires agreement                 |

**Recommendation:** Add HCSO JailInfo scraper as primary Harris source. The current District Clerk feed is supplementary court data.

### 9.2 Brazoria County

| Source                               | Type           | URL                                            | Notes                                         |
| ------------------------------------ | -------------- | ---------------------------------------------- | --------------------------------------------- |
| **Tyler PublicAccess JailingSearch** | Jail bookings  | pubweb.brazoriacountytx.gov                    | Current source; limited by name requirement   |
| **Tyler PublicAccess CaseSearch**    | Court cases    | pubweb.brazoriacountytx.gov/Search.aspx?ID=100 | Configured in `brazoria.json` but not scraped |
| **Brazoria Sheriff's Office**        | Sheriff roster | brazoriacountytx.gov                           | Investigate for direct roster page            |
| **Vinelink**                         | Custody status | —                                              | Partial, name-based                           |

**Recommendation:** Investigate whether `brazoria.json`'s `cases_public` Tyler portal has a full inmate list view that doesn't require name input.

### 9.3 Galveston County

| Source                       | Type                | URL                                      | Notes                                        |
| ---------------------------- | ------------------- | ---------------------------------------- | -------------------------------------------- |
| **P2C jailinmates.aspx**     | Live jail roster    | p2c.galvestoncountytx.gov                | Current source; names missing                |
| **P2C jqHandler.ashx**       | AJAX data endpoint  | p2c.galvestoncountytx.gov/jqHandler.ashx | Current AJAX source — investigate name field |
| **Galveston Odyssey**        | Court records       | odyssey.galvestoncountytx.gov            | Configured in `galveston.json`; not scraped  |
| **Galveston Sheriff direct** | Possibly CSV/export | —                                        | Needs investigation                          |
| **VINE (Vinelink)**          | Custody status      | —                                        | Texas uses VINELink                          |

**Recommendation:** Inspect `jqHandler.ashx` response JSON to determine if `name` field is available. If it is, fix the mapping YAML — this is a critical win. If not, fetch individual detail pages (already supported in code) to get names.

### 9.4 Fort Bend County

| Source                    | Type             | URL                                                    | Notes                                        |
| ------------------------- | ---------------- | ------------------------------------------------------ | -------------------------------------------- |
| **Fort Bend jailinq**     | Live jail roster | jailinq.fortbendcountytx.gov                           | Current source; booking date issue           |
| **Fort Bend public jail** | Alternate roster | `jail.fortbendcountytx.gov/public/` (in fortbend.json) | Not currently scraped — may be better source |
| **Tyler Technologies**    | Court/booking    | —                                                      | Fort Bend may use Tyler for some systems     |
| **Vinelink**              | Custody check    | —                                                      | Partial                                      |

**Recommendation:** Check `jail.fortbendcountytx.gov/public/` (listed in `configs/fortbend.json`) — may be a more complete roster than the current inquiry site.

### 9.5 Jefferson County

| Source                | Type             | URL                                | Notes                           |
| --------------------- | ---------------- | ---------------------------------- | ------------------------------- |
| **InmateSearch**      | Live jail search | jeffersoncountytx.gov/InmateSearch | Current source                  |
| **Jefferson Sheriff** | Direct roster    | —                                  | Investigate for full list       |
| **Tyler Odyssey**     | Court records    | —                                  | Jefferson may use Tyler/Odyssey |
| **Vinelink**          | Custody status   | —                                  | Texas VINELink                  |

### 9.6 Texas Statewide

| Source                              | Coverage                 | Notes                                            |
| ----------------------------------- | ------------------------ | ------------------------------------------------ |
| **TDCJ InmateSearch**               | TDCJ incarcerated only   | Used in `enrichment/tdcj_enrich.py` (Playwright) |
| **Texas OCA**                       | All county courts        | Requires data sharing agreement; not public API  |
| **VINELink**                        | Custody status by county | Good for alerts; limited fields                  |
| **JailBase / BustedMugshots**       | Aggregator               | Third-party; terms restrict commercial use       |
| **Appriss VINE**                    | Victim notifications     | Commercial product                               |
| **Texas DPS**                       | Criminal history         | Requires authorized access                       |
| **Tyler Technologies API**          | Tyler counties           | No public API documented; contact Tyler          |
| **OpenJustice / PublicRecords.com** | Aggregators              | Third-party; verify ToS                          |

**Important note:** The current sites (P2C, Tyler PublicAccess, HCSO JailInfo) display **public information** without authentication. Scraping this data is generally permissible under Texas law (Government Code §552) and established case law (hiQ v. LinkedIn; Van Buren v. United States). However:

- Do not bypass CAPTCHA, login walls, or rate-limit controls.
- Respect `robots.txt`.
- Add reasonable request delays (already present in most scrapers).
- Do not harvest personally-identifying data for commercial resale without legal review.

---

## 10. Recommended Target Architecture

```
┌─────────────────────────────────────────────────────┐
│                   SCRAPERS LAYER                    │
├─────────────────┬──────────────┬───────────────────-┤
│ Harris HCSO     │ Harris DC    │ Harris Email Roster│
│ (requests+bs4)  │ (requests+   │ (openpyxl/csv)    │
│ NEW             │  WebForms)   │                   │
├─────────────────┼──────────────┼────────────────────┤
│ Brazoria        │ Galveston    │ Fort Bend          │
│ (requests+bs4   │ (httpx+      │ (requests+bs4)     │
│  + surname iter)│  playwright) │ + surname iter     │
├─────────────────┼──────────────┼────────────────────┤
│ Jefferson       │ [Future]     │                    │
│ (requests+bs4   │ Montgomery   │                    │
│  + surname iter)│ Chambers etc │                    │
└─────────────────┴──────────────┴────────────────────┘
           ↓ tenacity retry on all HTTP calls
           ↓ structured logging (stdlib logging)
           ↓ first_seen_at always set
┌─────────────────────────────────────────────────────┐
│              RAW MONGODB COLLECTIONS                │
│   harris_bond, harris_misfel, harris_nafiling,      │
│   brazoria_inmates, galveston_events,               │
│   fortbend_inmates, jefferson_events                │
└─────────────────────────────────────────────────────┘
           ↓ normalize_to_simple.py + YAML mappings
┌─────────────────────────────────────────────────────┐
│           simple_<county> COLLECTIONS               │
│   Canonical schema, compound _upsert_key            │
│   booking_date_confidence flag added                │
└─────────────────────────────────────────────────────┘
           ↓ sync_to_enrichment.py (72h window)
┌─────────────────────────────────────────────────────┐
│         inmate_enrichment.inmates                   │
│   enrichment_status: NEW | STALE | ENRICHED         │
└─────────────────────────────────────────────────────┘
           ↓ enrichment worker
┌─────────────────────────────────────────────────────┐
│   ENRICHMENT SOURCES                                │
│   HCSO DOB lookup │ TDCJ │ PDL API │ Odyssey court  │
└─────────────────────────────────────────────────────┘
```

**Key changes from current state:**

1. Add HCSO JailInfo scraper as primary Harris source
2. Fix Galveston `full_name` (inspect AJAX response)
3. Add surname iteration to Brazoria and Fort Bend
4. Add `playwright` to `requirements.txt` and `Dockerfile`
5. Add `tenacity` retry to all HTTP calls
6. Replace `print()` with `logging`
7. Remove `selenium` / `webdriver-manager` (unused)
8. Add `booking_date_confidence` quality flag to simple schema
9. Add `first_seen_at` to all scrapers

---

## 11. Prioritized Action Plan

### P0 — Blockers (fix before next production run)

| #    | Task                                                           | File(s)                                       | Effort |
| ---- | -------------------------------------------------------------- | --------------------------------------------- | ------ |
| P0-1 | Add `playwright` to `requirements.txt` and `Dockerfile`        | `requirements.txt`, `Dockerfile`              | 1h     |
| P0-2 | Investigate Galveston `jqHandler.ashx` response for name field | `galveston_p2c_fast.py`, `galveston_p2c.yaml` | 2h     |
| P0-3 | Remove `selenium`, `webdriver-manager` from `requirements.txt` | `requirements.txt`                            | 30m    |

### P1 — High Priority (this sprint)

| #    | Task                                                           | File(s)                                  | Effort   |
| ---- | -------------------------------------------------------------- | ---------------------------------------- | -------- |
| P1-1 | Add HCSO JailInfo scraper                                      | New file `ingestion/harris_hcso_jail.py` | 1-2 days |
| P1-2 | Add surname iteration loop to Brazoria                         | `ingestion/brazoria_ingest.py`           | 4h       |
| P1-3 | Add surname iteration loop to Fort Bend                        | `ingestion/fortbend_ingest.py`           | 4h       |
| P1-4 | Add `tenacity` retry to all HTTP calls (5 scrapers)            | All `ingestion/*.py`                     | 1 day    |
| P1-5 | Fix Galveston `full_name` mapping (if AJAX includes name)      | `galveston_p2c.yaml`                     | 2h       |
| P1-6 | Add `first_seen_at` to Brazoria, Galveston, Jefferson raw docs | `ingestion/*.py`                         | 2h       |

### P2 — Medium Priority (next sprint)

| #    | Task                                                                          | File(s)                      | Effort |
| ---- | ----------------------------------------------------------------------------- | ---------------------------- | ------ |
| P2-1 | Add Tyler pagination to Brazoria (page-through >25 results)                   | `ingestion/brazoria_jail.py` | 4h     |
| P2-2 | Consolidate `_calculate_booking_age_category` to `audited_scraper.py`         | 4 files                      | 1h     |
| P2-3 | Replace `datetime.utcnow()` with `datetime.now(timezone.utc)`                 | Multiple files               | 1h     |
| P2-4 | Enable SSL verification on Galveston                                          | `galveston_p2c_fast.py`      | 30m    |
| P2-5 | Investigate `jail.fortbendcountytx.gov/public/` as alternate Fort Bend source | New file or config           | 2h     |
| P2-6 | Add `booking_date_confidence` quality flag to mapping YAMLs                   | All mapping YAMLs            | 2h     |
| P2-7 | Replace `print()` with `logging` in all scrapers                              | All `ingestion/*.py`         | 4h     |

### P3 — Long Term

| #    | Task                                               | Effort         |
| ---- | -------------------------------------------------- | -------------- |
| P3-1 | Add Montgomery County scraper                      | Medium         |
| P3-2 | Add Chambers County scraper                        | Medium         |
| P3-3 | Implement fuzzy/phonetic entity resolution         | High           |
| P3-4 | Evaluate Texas OCA court data agreement            | Low (research) |
| P3-5 | Investigate VINELink API for custody status alerts | Low            |
| P3-6 | Add Pydantic models for scraper output validation  | Medium         |

---

## 12. Quick Wins

Tasks completable in under 2 hours each:

1. **Add `playwright` to `requirements.txt`** — prevents silent deployment failures.

   ```
   playwright==1.44.0
   ```

   Also add to `Dockerfile`:

   ```dockerfile
   RUN pip install --no-cache-dir -r requirements.txt
   RUN playwright install chromium --with-deps
   ```

2. **Remove `selenium`, `webdriver-manager`** — reduces attack surface, faster installs.

3. **Enable Galveston SSL verification** — change default `SCRAPER_VERIFY_SSL=false` to `true`.

4. **Add `tenacity` to requirements and wrap all `sess.get()` / `sess.post()` calls** with:

   ```python
   from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
   import requests

   @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10),
          retry=retry_if_exception_type(requests.RequestException))
   def _fetch_with_retry(sess, url, **kwargs):
       return sess.get(url, **kwargs)
   ```

5. **Consolidate `_calculate_booking_age_category`** — it's copy-pasted in 4 files; move to `audited_scraper.py` and import from there.

6. **Add `first_seen_at` to all ingest documents** — every raw document should record `first_seen_at = fetched_at` so the normalizer always has a timestamp to derive from.

7. **Investigate `jqHandler.ashx` response** — run the Galveston scraper in debug mode and inspect the raw JSON/HTML returned by the AJAX endpoint to determine if `name` is present.

---

## 13. Medium-Term Improvements

### 13.1 HCSO JailInfo Scraper (Harris Primary Source)

The `configs/harris.json` lists `apps.harriscountyso.org/JailInfo/` as the inmates source but no scraper currently hits it. Adding this would give Harris **real-time jail population** data rather than court-filing data.

Investigation needed:

- Does it require a session cookie or auth?
- Is there a full roster view or only search-by-name?
- Does it paginate?
- Does it expose booking dates and charges?

### 13.2 Surname Iteration for Brazoria / Fort Bend

Jefferson already has this pattern. Brazoria and Fort Bend need a loop like:

```python
ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
for letter in ALPHABET:
    results = search_brazoria(last=letter, first="")  # if single-name search works
    # or iterate known surnames from a config file
```

For Brazoria, if single-letter last name still requires a first name, use the Jefferson approach: build a surname list from MongoDB distinct values and iterate.

### 13.3 Structured Logging

Replace all `print(f"[county] ...")` with:

```python
import logging
logger = logging.getLogger(__name__)
logger.info("[county] Processing %s …", surname)
```

Configure a root handler in `storage/mongo_client.py` or the pipeline runner to emit JSON logs for structured log aggregation (e.g., Render.com log drains).

### 13.4 Pydantic Output Validation

Add a Pydantic model to each scraper's `fetch()` output to catch schema drift early:

```python
class BrazoriaRawDoc(BaseModel):
    booking_number: str
    name: str
    booking_date_iso: Optional[str]
    fetched_at: datetime
    ...
```

### 13.5 Tyler Pagination for Brazoria

Tyler's PublicAccess portal uses ASP.NET pager with `__EVENTTARGET` / `__EVENTARGUMENT` to navigate pages. When results exceed 25, add:

```python
while has_next_page(soup):
    data = get_next_page_postback_data(soup)
    r = sess.post(url, data=data, ...)
    soup = BeautifulSoup(r.text, "html.parser")
    rows.extend(parse_rows(soup))
```

---

## 14. Long-Term Data Acquisition Strategy

### 14.1 VINE / VINELink

The Texas VINE (Victim Information and Notification Everyday) system operated by Appriss provides custody status for all Texas counties. While direct API access requires partnership with Appriss, the public website (`vinelink.com`) can be used for custody verification without automated bulk scraping.

**Opportunity:** Integrate VINELink as a release-status check for records already in the DB. When a `NEW` inmate moves to release, mark them for bond analysis immediately.

### 14.2 Texas OCA (Office of Court Administration)

The Texas OCA aggregates court records from all county district and county courts via the TexFile / Tyler Odyssey network. A data-sharing agreement with OCA would provide structured court case data without per-county scraping.

**Opportunity:** For research and reporting, a formal OCA data agreement would provide access to warrant, bond, and case data for all 254 Texas counties. This is not immediately practical but should be investigated as volume grows.

### 14.3 Tyler Technologies Data Feeds

Brazoria and Galveston both use Tyler PublicAccess. Tyler does offer a documented API (`Tyler Supervision`, `Tyler Odyssey REST`) for licensed agencies. Contact Tyler about whether their public-portal data is available via a feed for permitted third parties.

### 14.4 Cross-County Entity Resolution

As more counties are added, cross-county deduplication becomes critical. Recommend:

- Implement phonetic matching (metaphone or double metaphone) on name + county
- Add a `persons` collection as a global entity store (currently only a placeholder in `base_scraper.py`)
- Use DOB when available as the strongest signal
- Flag cross-county matches for human review rather than auto-merging

### 14.5 Coverage Expansion

Target counties by population / bail-bond activity priority:

1. **Montgomery County** — large suburban county, active jail population
2. **Chambers County** — east of Harris, smaller but relevant geography
3. **Waller County** — northwest Houston
4. **Liberty County** — northeast Houston
5. **Matagorda County** — coast

Each should follow the same discovery checklist (see `SCRAPER_DISCOVERY_CHECKLIST.md`) before implementation.

---

## Appendix: Key Constants and Env Vars

| Variable                  | Default                                                                 | Used By                 |
| ------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `MONGO_URI`               | —                                                                       | All                     |
| `MONGO_DB`                | `warrantdb`                                                             | All                     |
| `BRAZORIA_BASE_URL`       | `https://pubweb.brazoriacountytx.gov/PublicAccess/`                     | `brazoria_jail.py`      |
| `FORTBEND_BASE_URL`       | `https://jailinq.fortbendcountytx.gov/`                                 | `fortbend_jail.py`      |
| `HARRIS_BASE_FILES_URL`   | `https://www.hcdistrictclerk.com/Common/e-services/Files`               | `harris_inmate.py`      |
| `HARRIS_DATASETS_PAGE`    | `https://www.hcdistrictclerk.com/Common/e-services/PublicDatasets.aspx` | `harris_inmate.py`      |
| `GALV_CONCURRENCY`        | `10`                                                                    | `galveston_p2c_fast.py` |
| `GALV_ROW_DELAY_SEC`      | `0.5`                                                                   | `galveston_p2c_fast.py` |
| `ROWS_MAX`                | `5000`                                                                  | `galveston_p2c_fast.py` |
| `SCRAPER_VERIFY_SSL`      | `false`                                                                 | `galveston_p2c_fast.py` |
| `JEFF_SURNAME_FILE`       | `configs/jefferson_lastnames.txt`                                       | `jefferson_jail.py`     |
| `JEFF_ROW_DELAY_SEC`      | `0.6`                                                                   | `jefferson_jail.py`     |
| `JEFF_SEARCH_DELAY_SEC`   | `1`                                                                     | `jefferson_jail.py`     |
| `PIPELINE_SOURCES`        | see run_twice_daily.sh                                                  | `run_pipeline.py`       |
| `PIPELINE_STEPS`          | `ingest,normalize,report`                                               | `run_pipeline.py`       |
| `ENRICHMENT_WINDOW_HOURS` | `72`                                                                    | `sync_to_enrichment.py` |
| `PDL_API_KEY`             | —                                                                       | `enrich_pdl.py`         |
| `SCRAPER_AUDIT`           | `true`                                                                  | `audited_scraper.py`    |
