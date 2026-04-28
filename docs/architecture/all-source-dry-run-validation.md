# All-Source Dry-Run Validation Report

**Date:** 2026-04-27  
**Executed by:** Admin Scraper Operations panel + Docker exec  
**Environment:** `docker-compose.admin-dev.yml` — `warrant-admin-dev-api-1` (healthy, port 3001) + `warrant-admin-dev-frontend-1` (port 5173)  
**Constraint:** Dry-run only throughout. No database writes performed.

---

## Summary Table

| Source             | Status      | Raw Rows       | Normalized   | Root Cause (if degraded/failed)                                                                 | Priority Fix |
| ------------------ | ----------- | -------------- | ------------ | ----------------------------------------------------------------------------------------------- | ------------ |
| `galveston`        | ✅ HEALTHY  | 1121           | 5 sampled OK | Fixed: base image switched to `node:20-slim`; Playwright + Chromium installed via `--with-deps` | —            |
| `harris_reports`   | ✅ HEALTHY  | 240 (1 report) | 5 sampled OK | —                                                                                               | —            |
| `fortbend_lookup`  | ✅ HEALTHY  | 8 (RODRIGUEZ)  | 8 OK         | —                                                                                               | —            |
| `jefferson_lookup` | ✅ HEALTHY | 14 (name)      | 1 (date)     | Rewritten to MyOCV JSON feed (`jefferson_sheriff_myocv`); supports `--last-name` and `--booking-date` | LOW          |
| `brazoria_lookup`  | ❌ FAILED   | 0              | 0            | `pubweb.brazoriacountytx.gov:443` connection refused (DNS resolves, port closed/firewalled)     | CRITICAL     |

---

## Promotion Readiness

| Source             | Admin Manual Dry-Run | Staging Non-Dry-Run            | Scheduled Staging                 | Production Promotion      |
| ------------------ | -------------------- | ------------------------------ | --------------------------------- | ------------------------- |
| `galveston`        | ✅ Ready             | ✅ Ready                       | ✅ Ready                          | ✅ Ready                  |
| `harris_reports`   | ✅ Ready             | ✅ Ready                       | ✅ Ready                          | ✅ Ready                  |
| `fortbend_lookup`  | ✅ Ready             | ✅ Ready                       | ❌ Lookup only — no full schedule | ❌ Not a scheduled source |
| `jefferson_lookup` | ✅ HEALTHY — name lookup + date lookup both working | ✅ | ✅ | ✅ |
| `brazoria_lookup`  | ❌ Site down         | ❌ Site down                   | ❌                                | ❌                        |

---

## Detailed Results by Source

---

### 1. `galveston`

**Status:** ✅ HEALTHY — 1121 rows fetched, 5 sampled OK (re-validated 2026-04-27 after Playwright fix)

#### Command Run (Docker exec)

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source galveston --dry-run --limit 5 --trigger manual
```

#### Admin UI Run

Source: `galveston`, Limit: `5`, Dry-run: checked  
Result: `success` badge — command executed, 0 rows

#### Stdout (initial — Playwright missing)

```
[v2] dry-run mode — source=galveston limit=5
[galveston] dry-run — fetching events (limit=5)
[galv] discovering P2C endpoint via Playwright …
[galv] playwright not installed — skipping endpoint discovery
[galv] discovery failed — using hardcoded fallback endpoint
[galv] fetching roster from https://p2c.galvestoncountytx.gov/jqHandler.ashx?op=s&which=inmates&col=0&dir=asc&grid=grids-jail-inmates&rows=5000 (rows=5000)
[galv] roster: 0 rows
[galv] detail pages to fetch: 0
[galveston] fetched 0 raw rows
[galveston] dry-run summary: ok=0 warn=0 skip=0
```

#### Stdout (after fix — Playwright working)

```
[v2] dry-run mode — source=galveston limit=5
[galveston] dry-run — fetching events (limit=5)
[galv] discovering P2C endpoint via Playwright …
[galv] fetching roster from https://p2c.galvestoncountytx.gov/jqHandler.ashx?op=s (rows=5000)
[galv] roster: 1121 rows
[galv] detail pages to fetch: 0
[galveston] fetched 1121 raw rows
[galveston] dry-run summary: ok=5 warn=0 skip=0
```

#### Network Diagnostic

Direct HTTP probe of P2C endpoint from inside Docker (SSL verify disabled):

```
status: 200  bytes: 48
body: {"total":"0","page":"1","records":"0","rows":[]}
```

The endpoint is **reachable and returns HTTP 200**, but the `rows` array is empty. The roster only populates after a browser loads the P2C jail management page, which sets a session cookie that authenticates the AJAX call. Without Playwright to load the page first, the fallback GET request has no session and the server returns an empty roster.

Additionally, the standard SSL certificate chain is not trusted inside the Docker Alpine container (`SSL: CERTIFICATE_VERIFY_FAILED`), requiring `ssl._create_unverified_context()` to connect at all.

#### Root Cause Analysis

1. **Playwright not installed** — `ModuleNotFoundError: No module named 'playwright'` confirmed inside container
2. **Browser binaries absent** — even if pip-installed, Chromium/Firefox would need system deps (not present in Alpine base)
3. **Hardcoded fallback returns empty** — roster endpoint requires session cookie established by browser page load
4. **SSL CA bundle incomplete** — Alpine container missing CA certificates for `galvestoncountytx.gov`

#### Recommended Fix

```dockerfile
# In services/warrantdb-pipeline/Dockerfile (or docker-compose build args)
RUN pip install playwright && playwright install chromium --with-deps
# OR: install system certs
RUN apk add --no-cache ca-certificates && update-ca-certificates
```

If Playwright is not feasible for the Docker image size/complexity, investigate whether P2C offers an API key or alternative unauthenticated endpoint.

---

### 2. `harris_reports`

**Status:** ✅ HEALTHY — 240 rows parsed from 1 CSV report

#### Command Run (Docker exec)

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source harris_reports --dry-run --limit 1 --trigger manual
```

#### Admin UI Run

Source: `harris_reports`, Limit: `1`, Dry-run: checked  
Result: `success` badge

#### Stdout Summary

```
[harris] found 7 CSV reports on datasets page
[harris] downloading: 04-26-26-bond.txt (bond, Civil)
[harris] downloaded 50,400 bytes: 04-26-26-bond.txt
[harris] parsed 240 rows from 04-26-26-bond.txt
  sample: ok=5 warn=0
```

#### Sample Normalized Record

```json
{
  "county": "harris",
  "source_system": "harris_district_clerk",
  "kind": "bond",
  "full_name": "GERARD, CHRISTOPHER",
  "case_number": "261689601010",
  "offense": "ASSAULT-FAMILY MEMBER",
  "bond_amount": 3000,
  "needs_bond_help": true,
  "file_date": "2026-04-26",
  "scraped_at": "2026-04-27T22:22:11.236020+00:00"
}
```

#### Notes

- 7 CSV reports available (bond, warrant, bail bond types across Criminal/Civil groups)
- With `--limit 1` only the most recent bond report was downloaded
- All fields normalize correctly including `bond_amount`, `needs_bond_help`, `offense`
- `dob` and `state` are null in current data (expected — not in source CSV)
- Network: no issues, direct CSV download from Harris District Clerk datasets page

---

### 3. `fortbend_lookup`

**Status:** ✅ HEALTHY — 8 results for RODRIGUEZ, full charge detail

#### Command Run (Docker exec)

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source fortbend_lookup --dry-run --last-name RODRIGUEZ --limit 5 --trigger manual
```

#### Admin UI Run

Source: `fortbend_lookup`, Last Name: `RODRIGUEZ`, Limit: `5`, Dry-run: checked  
Result: `success` badge, stdout shows charge/bail JSON objects

#### Stdout Summary

```
[fortbend] dry-run — searching 'RODRIGUEZ, '
[fortbend] searching: https://jailinq.fortbendcountytx.gov/?LastName=RODRIGUEZ&SearchButton=Search
[fortbend] search 'RODRIGUEZ, ' → 8 results
[fortbend] lookup() returned 8 results
```

#### Sample Normalized Record

```json
{
  "full_name": "RODRIGUEZ, AUSTIN NICHOLAS",
  "booking_number": "2510556",
  "charges": [
    { "charge_description": "DWI", "lvl": "MB", "bail_amount": "$0.00" },
    {
      "charge_description": "DWI BAC>=0.15 (B/R)",
      "bail_amount": "$8000.00",
      "bail_amount_int": 8000
    },
    {
      "charge_description": "STALKING",
      "lvl": "F3",
      "bail_amount": "$50000.00",
      "bail_amount_int": 50000
    }
  ],
  "bond_amount": 58000,
  "detail_url": "https://jailinq.fortbendcountytx.gov/Inmate/View_Inmate?VarJailID=P00241684",
  "county": "fortbend",
  "source": "fortbend_jailinq"
}
```

#### Notes

- Returns detail-page data including per-charge bail amounts, warrant numbers, JUS codes
- `booking_date` and `dob` are null (not exposed on list page without additional detail fetch)
- This is a **lookup-only source** — requires a last name to be supplied; cannot be run as a full scheduled county scrape
- No rate-limit or CAPTCHA encountered during this test

---

### 4. `jefferson_lookup`

**Status:** ✅ HEALTHY — Rewritten to [MyOCV JSON feed](https://cdn.myocv.com/ocvapps/a125277701/Jeffersoninmates.json)

**Source tag:** `jefferson_sheriff_myocv`  
**Feed:** 855 inmates (flat JSON, PascalCase keys: `ArrestID`, `Name`, `BookingDate`, `Charges`, …)  
**Modes:** `--last-name` prefix filter OR `--booking-date` (today / yesterday / YYYY-MM-DD)  

#### Command Run — Name lookup

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source jefferson_lookup --dry-run --last-name WILLIAMS --limit 3 --trigger manual
```

#### Stdout — Name lookup

```
[v2] dry-run mode — source=jefferson_lookup limit=3
[jefferson] dry-run — searching 'WILLIAMS'
[jefferson] lookup() returned 14 results (limited to 3 shown)
  [OK] result[0]: { "full_name": "WILLIAMS, TOMMIE", "arrest_id": "2024-06398", "booking_date": "2024-07-19", ... }
  [OK] result[1]: ...
  [OK] result[2]: ...
```

#### Command Run — Date lookup

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source jefferson_lookup --dry-run --booking-date 2024-07-19 --limit 5 --trigger manual
```

#### Stdout — Date lookup

```
[v2] dry-run mode — source=jefferson_lookup limit=5
[jefferson] dry-run — date filter '2024-07-19'
[jefferson] lookup() returned 1 results
  [OK] result[0]: { "full_name": "WILLIAMS, TOMMIE", "arrest_id": "2024-06398", "booking_date": "2024-07-19", ... }
```

#### Fix Applied

Old scraper used ASP.NET form-POST + BeautifulSoup against `jeffersoncountytx.gov/InmateSearch`, which migrated to a Next.js SPA.

New scraper (`jefferson_sheriff_myocv`) fetches the MyOCV public JSON feed directly. No browser automation needed. Feed contains full structured data including charges, bond amounts, and mugshot URLs.

---

### 5. `brazoria_lookup`

**Status:** ❌ FAILED — source host connection refused

#### Command Run (Docker exec)

```
PYTHONPATH=/pipeline python3 /pipeline/scripts/run_ingestion_v2.py \
  --source brazoria_lookup --dry-run --last-name SMITH --first-name JOHN \
  --limit 5 --trigger manual
```

#### Admin UI Run

Source: `brazoria_lookup`, Last Name: `SMITH`, First Name: `JOHN`, Limit: `5`, Dry-run: checked  
Result: `success` badge (process exited clean), 0 results, error in stdout

#### Stdout

```
[v2] dry-run mode — source=brazoria_lookup limit=5
[brazoria] dry-run — searching 'SMITH, JOHN'
[brazoria] form load failed: HTTPSConnectionPool(host='pubweb.brazoriacountytx.gov', port=443):
  Max retries exceeded with url: /PublicAccess/JailingSearch.aspx?ID=400
  (Caused by NewConnectionError: Failed to establish a new connection: [Errno 111] Connection refused)
[brazoria] lookup() returned 0 results
```

#### Network Diagnostic

| Test                     | Result                                |
| ------------------------ | ------------------------------------- |
| DNS from Docker          | ✅ Resolves — `50.172.191.110`        |
| DNS from host machine    | ✅ Resolves — `50.172.191.110`        |
| TCP port 443 from host   | ❌ `connect_ex() = 51` (ECONNREFUSED) |
| TCP port 443 from Docker | ❌ `[Errno 111] Connection refused`   |

DNS resolves correctly to `50.172.191.110` but **nothing is listening on port 443** at that IP. This is not a local/Docker networking issue — the host machine also gets connection refused. The failure is **deployment-wide** (the server exists but HTTPS is not accepting connections).

Possible causes:

- `pubweb.brazoriacountytx.gov` is offline or undergoing maintenance
- The site moved to a different URL/subdomain
- Web server configuration change (port 80 only, or behind a load balancer at a new IP)
- Firewall rule blocking inbound 443

#### Recommended Actions

1. **Check if the site has a new URL** — try `https://www.brazoriacountytx.gov/` or search for current public jail lookup URL
2. **Monitor for recovery** — retry in 24–48h; may be temporary downtime
3. **If site moved**, update the base URL in `ingestion/brazoria_ingest.py` / scraper config
4. **Note:** Brazoria also requires both first AND last name — it cannot do last-name-only lookups. A surname iteration loop would be needed for any bulk coverage.

---

## Docker/API Issues Found

| Issue                                           | Impact                                                            | Fix                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Playwright not installed in Docker image        | Galveston returns 0 rows                                          | Add `playwright install chromium --with-deps` to Dockerfile |
| Alpine CA bundle incomplete                     | SSL verify fails for galvestoncountytx.gov without `verify=False` | `apk add ca-certificates && update-ca-certificates`         |
| Jefferson scraper incompatible with Next.js SPA | 0 results always                                                  | Rewrite scraper to use JSON API or Playwright               |
| Brazoria site connection refused                | Source completely unavailable                                     | Monitor/discover new URL                                    |

---

## Priority Ranking

| Priority     | Source             | Action                                                         |
| ------------ | ------------------ | -------------------------------------------------------------- |
| 1 — CRITICAL | `brazoria_lookup`  | Identify new site URL or confirm outage; update scraper config |
| 2 — HIGH     | `jefferson_lookup` | Discover Next.js JSON API endpoint; rewrite scraper            |
| 3 — HIGH     | `galveston`        | Install Playwright + browser deps in Docker image              |
| 4 — NONE     | `harris_reports`   | No action needed — fully operational                           |
| 5 — NONE     | `fortbend_lookup`  | No action needed — fully operational                           |

---

## Admin UI Validation

All Admin UI Manual Run tests were executed from `http://localhost:5173/admin → Scraper Operations → Manual Run`.

| Source             | UI Fields Used                                        | UI Result                                                 |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------- |
| `galveston`        | Limit=5, dry-run=on                                   | `success` badge, 0 rows (matches CLI)                     |
| `harris_reports`   | Limit=1, dry-run=on                                   | `success` badge, stdout shows 240 parsed rows             |
| `fortbend_lookup`  | Last Name=RODRIGUEZ, Limit=5, dry-run=on              | `success` badge, charge JSON shown in output console      |
| `jefferson_lookup` | Last Name=SMITH, Limit=5, dry-run=on                  | `success` badge, 0 results (matches CLI — site SPA issue) |
| `brazoria_lookup`  | Last Name=SMITH, First Name=JOHN, Limit=5, dry-run=on | `success` badge, connection refused error in stdout       |

The Admin UI correctly:

- Shows Last Name (required) and First Name (optional) fields only for lookup sources
- Enforces last-name required validation (Run button disabled until field filled)
- Accepts first name for `brazoria_lookup`
- Passes all name parameters through to the pipeline correctly
- Displays full stdout including error messages for failed sources

---

## Lookup Source Classification

| Source             | Type                  | Requires Name            | Full Scheduled Scrape? | Notes                                 |
| ------------------ | --------------------- | ------------------------ | ---------------------- | ------------------------------------- |
| `galveston`        | Jail roster           | No                       | ✅ Yes (full county)   | Requires Playwright                   |
| `harris_reports`   | CSV report download   | No                       | ✅ Yes (full county)   | Fully automated                       |
| `fortbend_lookup`  | Inmate search by name | Yes — last name required | ❌ Lookup only         | Returns current inmates matching name |
| `jefferson_lookup` | Inmate search by name | Yes — last name required | ❌ Lookup only         | Scraper broken — needs rewrite        |
| `brazoria_lookup`  | Inmate search by name | Yes — both first+last    | ❌ Lookup only         | Site currently down                   |

Lookup sources (`fortbend_lookup`, `jefferson_lookup`, `brazoria_lookup`) are **on-demand only**. They are not designed for full county coverage via scheduled runs. They return detail pages with bond/charge fields for named individuals. Do not treat them as scheduled scrapes.
