# Scraper Discovery Checklist
**Warrant System – warrantdb-pipeline**
**Version:** 1.0 | **Date:** 2026-04-25

Use this checklist when adding a new county scraper or auditing an existing one. Complete every section before marking a scraper as production-ready.

---

## How to Use This Checklist

1. Copy this file → `SCRAPER_DISCOVERY_<COUNTY>.md`
2. Fill in every item with ✅, ❌, ⚠️ (partial / unknown), or N/A
3. Record all findings, even negative ones
4. Submit findings for review before writing any code
5. Reference this checklist during PR review

---

## Section 1: County / Source Identification

- [ ] **County name** (official): _______________
- [ ] **State**: TX
- [ ] **Responsible agency**: Sheriff's Office / District Clerk / Police Dept / Other: _______________
- [ ] **Source URL(s)**: _______________
- [ ] **Platform / vendor identified** (Tyler, P2C, Odyssey, custom, etc.): _______________
- [ ] **Data type**: ☐ Jail roster ☐ Warrant list ☐ Court bond docket ☐ Email attachment ☐ Other: ___
- [ ] **Data freshness**: How often does the site update? _______________
- [ ] **Public data verification**: Confirmed this data is publicly available under Texas Government Code §552: ___
- [ ] **`robots.txt` reviewed**: Location → `<base_url>/robots.txt`. Findings: _______________
- [ ] **Terms of Service reviewed**: Found at: _______________. Restrictions: _______________

---

## Section 2: Website Technical Fingerprint

### 2.1 Authentication & Session Requirements

- [ ] **Login required**: ☐ Yes ☐ No ☐ Optional (more results with login)
- [ ] **Session cookie required**: ☐ Yes (warm-up GET needed) ☐ No ☐ Unknown
- [ ] **IP rate limiting observed**: ☐ Yes (describe: ___) ☐ No ☐ Unknown
- [ ] **CAPTCHA present**: ☐ Yes (type: reCAPTCHA v2 / v3 / hCaptcha / other) ☐ No
- [ ] **Anti-scraping headers checked** (X-Robots-Tag, etc.): _______________

### 2.2 JavaScript / Rendering

- [ ] **Site works without JS**: ☐ Yes ☐ No (JS required) ☐ Partially
- [ ] **AJAX / XHR endpoints identified**: ☐ Yes (URL: ___) ☐ No ☐ Unknown
- [ ] **Playwright/Selenium required**: ☐ Yes ☐ No ☐ Only for endpoint sniff
- [ ] **WebSocket used**: ☐ Yes ☐ No
- [ ] **Page source inspected** (View Source vs DevTools Elements differ): _______________

### 2.3 Form / Request Mechanics

- [ ] **Request method**: ☐ GET ☐ POST ☐ Both
- [ ] **Hidden form fields required** (ViewState, EventValidation, anti-forgery tokens): ☐ Yes (list: ___) ☐ No
- [ ] **Query parameters documented**: _______________
- [ ] **POST body format**: ☐ form-encoded ☐ JSON ☐ multipart ☐ XML
- [ ] **Referrer header required**: ☐ Yes ☐ No
- [ ] **User-Agent restriction**: ☐ Yes (describe: ___) ☐ No
- [ ] **Origin / X-Requested-With headers required**: ☐ Yes ☐ No

### 2.4 Pagination

- [ ] **Pagination present**: ☐ Yes ☐ No (single page) ☐ rows=N param
- [ ] **Pagination mechanism**: ☐ URL params ☐ Page postback (ASP.NET __EVENTTARGET) ☐ Infinite scroll ☐ Cursor
- [ ] **Max results per page**: _______________
- [ ] **Can fetch all results in one request** (e.g. rows=9999): ☐ Yes ☐ No
- [ ] **Total result count exposed**: ☐ Yes (selector: ___) ☐ No

### 2.5 Name Search Requirements

- [ ] **First name required**: ☐ Yes (enforced by site) ☐ Optional ☐ No field
- [ ] **Last name required**: ☐ Yes (enforced by site) ☐ Optional ☐ No field
- [ ] **Wildcard / prefix search supported**: ☐ Yes ☐ No ☐ Unknown
- [ ] **Blank name returns all records**: ☐ Yes ☐ No ☐ Unknown
- [ ] **If both names required — coverage strategy**: ☐ Surname enumeration file ☐ Alphabet sweep ☐ Known-name list ☐ Other: ___

### 2.6 TLS / SSL

- [ ] **SSL certificate valid**: ☐ Yes ☐ No (self-signed) ☐ Expired
- [ ] **Certificate authority**: _______________
- [ ] **SSL verification should be enabled**: ☐ Yes ☐ No (reason: ___)

---

## Section 3: Data Available

### 3.1 List / Roster View Fields

Document every field visible in the search results list:

| Field Name (on site) | Sample Value | Notes |
|---|---|---|
| (add rows as needed) | | |

- [ ] **Full name available in list view**: ☐ Yes ☐ No ← if No, note in Section 6
- [ ] **Booking number available in list view**: ☐ Yes ☐ No
- [ ] **DOB available in list view**: ☐ Yes ☐ No
- [ ] **Booking date available in list view**: ☐ Yes ☐ No
- [ ] **Charges visible in list view**: ☐ Yes ☐ No (detail page only)
- [ ] **Bond amount in list view**: ☐ Yes ☐ No

### 3.2 Detail Page Fields

- [ ] **Detail page exists**: ☐ Yes ☐ No
- [ ] **Detail URL pattern**: _______________
- [ ] **Detail page adds these fields** (beyond list view):

| Field Name (on site) | Sample Value | Maps to schema field |
|---|---|---|
| (add rows as needed) | | |

- [ ] **Charges listed on detail page**: ☐ Yes ☐ No
- [ ] **Per-charge bond amounts**: ☐ Yes ☐ No
- [ ] **Mug shot available**: ☐ Yes (URL pattern: ___) ☐ No
- [ ] **Physical description (height, weight, tattoos)**: ☐ Yes ☐ No
- [ ] **Attorney info**: ☐ Yes ☐ No
- [ ] **Housing unit / facility**: ☐ Yes ☐ No
- [ ] **Next court date**: ☐ Yes ☐ No
- [ ] **Release date or status**: ☐ Yes ☐ No

### 3.3 Date & Timestamp Availability

| Timestamp | Available | Location | Format | Notes |
|---|---|---|---|---|
| Booking date | ☐ Yes ☐ No | | | |
| Booking time | ☐ Yes ☐ No | | | |
| Release date | ☐ Yes ☐ No | | | |
| Court date | ☐ Yes ☐ No | | | |
| Last updated | ☐ Yes ☐ No | | | |
| DOB | ☐ Yes ☐ No | | | |
| Date of offense | ☐ Yes ☐ No | | | |

### 3.4 Identity Fields

| Field | Available | Format | Notes |
|---|---|---|---|
| Full name | ☐ Yes ☐ No | LAST, FIRST / FIRST LAST / other: ___ | |
| First name | ☐ Yes ☐ No | | |
| Last name | ☐ Yes ☐ No | | |
| Middle name | ☐ Yes ☐ No | | |
| DOB | ☐ Yes ☐ No | | |
| Age | ☐ Yes ☐ No | | DOB derivable? |
| Race | ☐ Yes ☐ No | | Encoded? |
| Sex / Gender | ☐ Yes ☐ No | | Encoded? |
| SPN / Sheriff ID | ☐ Yes ☐ No | | |
| State ID (SID) | ☐ Yes ☐ No | | |
| FBI number | ☐ Yes ☐ No | | |
| Address | ☐ Yes ☐ No | | |

### 3.5 Legal / Bond Fields

| Field | Available | Notes |
|---|---|---|
| Booking number | ☐ Yes ☐ No | |
| Case number | ☐ Yes ☐ No | |
| Charge description | ☐ Yes ☐ No | |
| Charge code / statute | ☐ Yes ☐ No | |
| Bond amount (total) | ☐ Yes ☐ No | |
| Bond amount (per charge) | ☐ Yes ☐ No | |
| Bond type | ☐ Yes ☐ No | |
| Bond status | ☐ Yes ☐ No | |
| Bond posted? | ☐ Yes ☐ No | |
| Arresting agency | ☐ Yes ☐ No | |
| Arresting officer | ☐ Yes ☐ No | |
| Warrant type | ☐ Yes ☐ No | |

---

## Section 4: Upsert / Deduplication Key

- [ ] **Natural unique key identified**: _______________
- [ ] **Key type**: ☐ Booking number ☐ Jail ID ☐ SPN ☐ (county, booking_number) ☐ Name+DOB (last resort) ☐ Other: ___
- [ ] **Key is stable** (does not change if record is re-fetched): ☐ Yes ☐ No
- [ ] **Key is unique within county**: ☐ Yes ☐ No (explain: ___)
- [ ] **Key is present in list view**: ☐ Yes ☐ No (requires detail page)
- [ ] **Compound key needed**: ☐ Yes (fields: ___) ☐ No
- [ ] **MongoDB index to create**: `db.<collection>.create_index([("<field1>", 1), ("<field2>", 1)], unique=True)`

---

## Section 5: Coverage & Completeness

- [ ] **Can full roster be fetched without name input**: ☐ Yes ☐ No
  - If No: coverage strategy → _______________
- [ ] **Date window supported** (fetch only last N days): ☐ Yes ☐ No
  - Method: ☐ Query param ☐ Client-side filter ☐ Neither
- [ ] **Estimated total records in current roster**: _______________
- [ ] **Estimated new records per day**: _______________
- [ ] **Released inmates removed from site**: ☐ Yes (how quickly: ___) ☐ No ☐ Unknown
- [ ] **Historical data available** (back more than 30 days): ☐ Yes ☐ No ☐ Unknown
- [ ] **Roster last updated timestamp shown on site**: ☐ Yes (location: ___) ☐ No

---

## Section 6: Known Gaps & Permanent Limitations

Document every field/behavior that is intentionally missing or structurally unavailable:

| Gap | Root Cause | Can It Be Fixed? | Workaround |
|---|---|---|---|
| (e.g., full_name always null) | | | |
| (e.g., no DOB in list view) | | | |
| (add rows as needed) | | | |

- [ ] **All permanent nulls in mapping YAML documented above**: ☐ Yes ☐ No
- [ ] **Gaps reviewed and accepted by team**: ☐ Yes ☐ No

---

## Section 7: Reliability & Fragility Assessment

### 7.1 Selectors / Parsers

For each CSS selector or HTML pattern used:

| Selector / Pattern | Element | Fragility | Notes |
|---|---|---|---|
| (e.g., `#InmatesTable tr`) | Inmate rows | Low — explicit ID | |
| (e.g., `tds[3]` positional) | Booking date | HIGH — no header match | |
| (add rows as needed) | | | |

- [ ] **Selectors use semantic IDs/classes** (not positional index): ☐ Yes ☐ Partially ☐ No
- [ ] **Fallback selector exists if primary fails**: ☐ Yes ☐ No
- [ ] **HTML structure likely to change**: ☐ Low risk ☐ Medium ☐ High
- [ ] **Column order fixed or verified against headers**: ☐ Header-verified ☐ Positional (fragile) ☐ N/A

### 7.2 Token / Session Fragility

- [ ] **WebForms tokens (ViewState, EventValidation) re-fetched each run**: ☐ Yes ☐ No ☐ N/A
- [ ] **Anti-forgery tokens re-fetched each session**: ☐ Yes ☐ No ☐ N/A
- [ ] **AJAX endpoint URL hardcoded vs. dynamically discovered**: ☐ Hardcoded (fragile) ☐ Dynamic ☐ N/A
- [ ] **Session cookies expire between runs**: ☐ Yes (re-warm on each run) ☐ No ☐ Unknown

### 7.3 Failure Modes

- [ ] **What happens if the site returns 404**: _______________
- [ ] **What happens if HTML structure changes**: _______________
- [ ] **What happens if rate-limited (429/503)**: _______________
- [ ] **What happens if site is down**: _______________
- [ ] **Error detected and logged** (vs. silently writing garbage): ☐ Yes ☐ No
- [ ] **HTML guard / sanity check** (validates response is data, not error page): ☐ Yes ☐ No

---

## Section 8: Normalization Mapping

### 8.1 Field Mapping Outline

| `simple_*` field | Source raw field | Transform needed | Notes |
|---|---|---|---|
| `full_name` | | | |
| `last_name` | | extract_last | |
| `first_name` | | extract_first | |
| `dob` | | parse_date or const: null | |
| `gender` | | decode_sex_code or const: null | |
| `race` | | decode_race_code | |
| `booking_number` | | | |
| `anchor` | | booking_number or jail_id | |
| `booking_date` | | to_iso_datetime or const: null | |
| `first_seen_at` | `fetched_at` | to_iso_datetime | Always set this |
| `bond_amount` | | to_float | |
| `source_url` | | | |
| `agency` | | | |
| `facility` | | | |
| (add rows as needed) | | | |

### 8.2 Mapping YAML Checklist

- [ ] **YAML file created**: `mappings/<county>/<county>_<type>.yaml`
- [ ] **`primary_key` defined** with county + category + anchor (or booking_number): ☐ Yes
- [ ] **`county: const: <county_name>`** set: ☐ Yes
- [ ] **`category: const: Criminal`** (or appropriate) set: ☐ Yes
- [ ] **All `const: null` fields are intentional** (not placeholders): ☐ Yes
- [ ] **`first_seen_at: from: fetched_at`** or equivalent always set: ☐ Yes
- [ ] **`booking_date` derived or proxy documented** in YAML comment: ☐ Yes
- [ ] **`booking_date_confidence: const: <actual|proxy_fetched_at|file_date>`** set: ☐ Yes
- [ ] **YAML tested against 5+ sample raw docs**: ☐ Yes
- [ ] **Zero skips (no missing upsert key)** on test run: ☐ Yes
- [ ] **`run normalize_to_simple.py --county <county> --dry-run` output reviewed**: ☐ Yes

---

## Section 9: Implementation Checklist

### 9.1 Scraper Class

- [ ] Inherits from `AuditedScraper` (not just `BaseScraper`): ☐ Yes
- [ ] Uses `self.db` from parent class (not a new `MongoClient`): ☐ Yes
- [ ] Output collection name defined as class constant: ☐ Yes
- [ ] `SCRAPER_NAME` constant defined: ☐ Yes
- [ ] `fetch()` returns a generator (not a list): ☐ Yes
- [ ] Every raw doc has `scraped_at` set to `datetime.now(timezone.utc)`: ☐ Yes
- [ ] Every raw doc has `fetched_at` set: ☐ Yes
- [ ] Every raw doc has `first_seen_at` set to `fetched_at`: ☐ Yes
- [ ] `_ingested_at` set or left to normalizer: ☐ Set ☐ Normalizer handles it

### 9.2 HTTP Layer

- [ ] `requests.Session` created once per run (not per request): ☐ Yes
- [ ] Session warm-up GET performed if site requires cookies: ☐ Yes ☐ N/A
- [ ] All HTTP calls wrapped with `tenacity` retry (3 attempts, exponential backoff): ☐ Yes
- [ ] SSL verification enabled (`verify=True` or `verify=certifi.where()`): ☐ Yes
- [ ] Request timeout set (≥ 30s for slow county sites): ☐ Yes
- [ ] Request delay implemented between searches: ☐ Yes (interval: ___ s)
- [ ] `User-Agent` header set to browser-like string: ☐ Yes
- [ ] Referrer header set where required: ☐ Yes ☐ N/A
- [ ] Response status code checked before parsing: ☐ Yes
- [ ] HTML sanity check (validate it's a data page, not error/redirect): ☐ Yes

### 9.3 Parsing

- [ ] Parser: ☐ `html.parser` ☐ `lxml` ☐ `html5lib` (justify choice: ___)
- [ ] Column headers matched by text (not positional index): ☐ Yes ☐ N/A
- [ ] Money parsing strips `$`, `,`, `\xa0`, spaces: ☐ Yes
- [ ] Date parsing uses `dateutil.parser.parse()` with fallback: ☐ Yes
- [ ] Name parsing preserves compound last names (hyphenated, Spanish, etc.): ☐ Yes
- [ ] Encoding issues handled (`.get_text(separator=" ")` instead of `.text`): ☐ Yes
- [ ] Empty result page detected and handled: ☐ Yes
- [ ] "No results found" text detected: ☐ Yes
- [ ] Error / "Public Access Error" pages detected: ☐ Yes

### 9.4 Detail Pages

- [ ] Detail page URL extracted from list view: ☐ Yes ☐ N/A (no detail pages)
- [ ] Detail page fetched for every row or only when needed: ☐ Every row ☐ Conditional ☐ N/A
- [ ] `detail_fetched_at` stored as ISO string (not datetime object): ☐ Yes
- [ ] Detail URL normalized (stripped of volatile params like `navid`, `ts`): ☐ Yes

### 9.5 Pagination

- [ ] First page only (intentional): ☐ Yes (document why)
- [ ] Full pagination loop implemented: ☐ Yes
- [ ] "Next page" detection: _______________
- [ ] Max-page guard (prevents infinite loop): ☐ Yes (max: ___)

### 9.6 run_ingestion.py Registration

- [ ] Added to `SCRAPER_SPECS` dict with `"module:ClassName"` format: ☐ Yes
- [ ] Added to `scripts/run_pipeline.py` `DEFAULT_SOURCES`: ☐ Yes (or document why excluded)
- [ ] Tested via `python -m scripts.run_ingestion --source <name> --dry-run`: ☐ Yes

### 9.7 Config Files

- [ ] Config JSON created: `configs/<county>.json`: ☐ Yes ☐ N/A
- [ ] All URLs in config match URLs actually used in scraper: ☐ Yes ← verify for Fort Bend!
- [ ] Surname/names file created if needed: `configs/<county>_lastnames.txt`: ☐ Yes ☐ N/A

---

## Section 10: Quality Gates

### 10.1 Before Merging

- [ ] **Zero errors / exceptions on test run** (100 records): ☐ Yes
- [ ] **At least 50 records ingested per run** (or explain expected low volume): ☐ Yes
- [ ] **Upsert key never null** on all test records: ☐ Yes
- [ ] **`full_name` populated on ≥ 90% of records** (or gap documented): ☐ Yes ☐ Documented
- [ ] **`booking_date` populated on ≥ 70% of records** (or proxy documented): ☐ Yes ☐ Documented
- [ ] **No `datetime.utcnow()` calls** (use `datetime.now(timezone.utc)` instead): ☐ Yes
- [ ] **No copy-pasted booking age helpers** (import from `audited_scraper.py`): ☐ Yes
- [ ] **`requirements.txt` updated** if new packages added: ☐ Yes
- [ ] **`Dockerfile` updated** if system-level dependencies added: ☐ Yes

### 10.2 After First Production Run

- [ ] **Check `scrape_audit` collection** for this scraper's run record: ☐ Yes
- [ ] **Verify raw collection has expected document count**: ☐ Yes
- [ ] **Run normalizer and verify `simple_<county>` populated**: ☐ Yes
- [ ] **Run `sync_to_enrichment.py --dry-run`** and verify new records visible: ☐ Yes
- [ ] **No unexpected `booking_date_confidence: proxy_fetched_at`** on records where actual date is available: ☐ Yes
- [ ] **Monitor first 3 runs for site-change errors**: ☐ Scheduled ☐ Done

### 10.3 Documentation

- [ ] **`README.md` in `ingestion/` updated** with new county: ☐ Yes ☐ N/A
- [ ] **`SCRAPER_DISCOVERY_REPORT.md` updated** with new county section: ☐ Yes
- [ ] **This checklist archived** as `SCRAPER_DISCOVERY_<COUNTY>.md`: ☐ Yes
- [ ] **Website behavior matrix** in report updated: ☐ Yes
- [ ] **Env vars documented** in `scripts/run_twice_daily.sh` or README: ☐ Yes

---

## Section 11: Existing Scraper Audit (Open Issues Tracker)

Use this section when auditing an **existing** scraper (not a new one):

| Issue | File | Severity | Status | Owner |
|---|---|---|---|---|
| `playwright` not in requirements.txt | requirements.txt | 🔴 Critical | Open | — |
| Galveston `full_name` always null | galveston_p2c.yaml, galveston_p2c_fast.py | 🔴 Critical | Open | — |
| `selenium`/`webdriver-manager` unused | requirements.txt | 🟡 Medium | Open | — |
| No retry logic in any scraper | All ingestion/*.py | 🟡 Medium | Open | — |
| Brazoria no surname iteration | brazoria_jail.py / brazoria_ingest.py | 🟡 Medium | Open | — |
| Fort Bend no surname iteration | fortbend_jail.py / fortbend_ingest.py | 🟡 Medium | Open | — |
| Fort Bend `booking_date` is race value | fortbend_inmates.yaml | 🟡 Medium | Documented/Mitigated | — |
| `configs/fortbend.json` URL mismatch | fortbend.json vs fortbend_jail.py | 🟡 Medium | Open | — |
| Harris HCSO JailInfo not scraped | — | 🟡 Medium | Open | — |
| Galveston SSL verification disabled | galveston_p2c_fast.py | 🟡 Medium | Open | — |
| `_calculate_booking_age_category` duplicated 4×  | 4 scraper files | 🟢 Low | Open | — |
| `datetime.utcnow()` deprecated usage | Multiple files | 🟢 Low | Open | — |
| No `first_seen_at` in raw docs (some scrapers) | brazoria, galveston, jefferson | 🟢 Low | Open | — |
| All scrapers use `print()` instead of `logging` | All ingestion/*.py | 🟢 Low | Open | — |
| `detail_fetched_at` stored as datetime obj (Brazoria) | brazoria_jail.py | 🟢 Low | Open | — |
| `dropbox` in requirements.txt — possibly unused | requirements.txt | 🟢 Low | Open | — |
| Brazoria Tyler pagination not implemented (>25 results) | brazoria_jail.py | 🟢 Low | Open | — |

---

## Section 12: Quick Reference — Common Patterns

### ASP.NET WebForms Hidden Fields

```python
def _collect_hidden_fields(soup):
    return {
        inp["name"]: inp.get("value", "")
        for inp in soup.select("input[type=hidden]")
        if inp.get("name")
    }
```

### ASP.NET Core Anti-Forgery Token

```python
def _discover_antiforgery(soup, resp):
    # 1. hidden input
    tok = soup.find("input", {"name": "__RequestVerificationToken"})
    if tok: return tok["value"]
    # 2. meta tag
    meta = soup.find("meta", {"name": "RequestVerificationToken"})
    if meta: return meta.get("content", "")
    # 3. cookie
    return resp.cookies.get("__RequestVerificationToken", "")
```

### Tenacity Retry Wrapper

```python
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
import requests

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(requests.RequestException),
    reraise=True,
)
def _http_get(sess: requests.Session, url: str, **kwargs):
    r = sess.get(url, timeout=30, **kwargs)
    r.raise_for_status()
    return r
```

### Tyler PublicAccess Pagination

```python
def _has_next_page(soup) -> bool:
    nxt = soup.select_one("a[id$='_lnkbtnNextPage']:not([style*='display:none'])")
    return bool(nxt and nxt.text.strip())

def _next_page_postback(soup, current_fields) -> dict:
    nxt = soup.select_one("a[id$='_lnkbtnNextPage']")
    href = nxt.get("href", "")
    import re
    m = re.search(r"__doPostBack\('([^']+)','([^']*)'\)", href)
    fields = dict(current_fields)
    fields["__EVENTTARGET"] = m.group(1) if m else ""
    fields["__EVENTARGUMENT"] = m.group(2) if m else ""
    return fields
```

### Galveston P2C AJAX Payload Bump

```python
def _bump_rows_in_payload(payload: dict, max_rows: int = 5000) -> dict:
    return {k: (str(max_rows) if k.lower() in ("rows", "pagesize", "take") else v)
            for k, v in payload.items()}
```

### HTML Sanity Check

```python
def _looks_like_data_page(html: str, required_marker: str) -> bool:
    """Returns False if response is a redirect/error page, not data."""
    if len(html) < 200:
        return False
    if required_marker.lower() not in html.lower():
        return False
    return True
```

### Timestamp Best Practice

```python
from datetime import datetime, timezone

# Always timezone-aware:
now = datetime.now(timezone.utc)

# ISO format for MongoDB storage:
now_iso = now.isoformat()  # "2026-04-25T12:00:00+00:00"

# NEVER use: datetime.utcnow()  ← deprecated in Python 3.12
```

---

*End of checklist. Archive this file as `SCRAPER_DISCOVERY_<COUNTY>.md` before implementation.*
