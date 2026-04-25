# WarrantDB Pipeline Dependency Audit

Date: 2026-04-24
Scope: Python dependency manifests and imports across `api`, `ingestion`, `enrichment`, `pipeline`, `scripts`, `storage`, and repo-root utilities

## Clean Dependency List

Manifest found:

- `requirements.txt`

Declared dependencies:

- `fastapi==0.111.0`
- `uvicorn[standard]==0.30.5`
- `pydantic==2.8.2`
- `pymongo==4.7.3`
- `python-dotenv==1.0.1`
- `requests==2.32.3`
- `httpx==0.27.2`
- `beautifulsoup4==4.12.3`
- `lxml==5.3.0`
- `PyYAML==6.0.2`
- `openpyxl==3.1.5`
- `xlrd==2.0.1`
- `dropbox==12.0.2`
- `pdfminer.six==20250506`
- `python-dateutil==2.9.0.post0`
- `selenium==4.24.0`
- `webdriver-manager==4.0.2`

## Issues Found

### Used dependencies confirmed from imports

Confirmed in code or documented operational startup paths:

- `fastapi`
- `uvicorn[standard]`
- `pydantic`
- `pymongo`
- `python-dotenv`
- `requests`
- `httpx`
- `beautifulsoup4`
- `lxml`
- `PyYAML`
- `openpyxl`
- `xlrd`
- `dropbox`
- `pdfminer.six`
- `python-dateutil`

### Likely unused dependencies

No import references were found during this scan for:

- `selenium`
- `webdriver-manager`

Those may be leftovers from an older browser-automation approach, especially because current scraping code uses `requests`, `httpx`, and `playwright` rather than Selenium.

### Duplicate dependencies

No duplicate declarations were found in the manifest set reviewed.

There is only one dependency manifest in this repo, and it does not repeat packages.

### Potential version conflicts

No direct version conflict was found in the declared manifest.

The main dependency risk here is not conflicting versions; it is missing packages that are imported by code but absent from `requirements.txt`.

### Missing dependencies based on imports

The following imports were found in code but not in `requirements.txt`:

- `playwright`
  - imported by `enrichment/tdcj_enrich.py` as `from playwright.sync_api import sync_playwright`
- `certifi`
  - imported by `scripts/backfill_galveston_mugshots.py`
  - imported by `ingestion/galveston_p2c_fast.py`

These are the clearest missing dependencies in the repo.

## Suggested Fixes

1. Add `playwright` to `requirements.txt` if `enrichment/tdcj_enrich.py` is still supported.
2. Add `certifi` to `requirements.txt` because it is imported directly in active scripts.
3. Remove `selenium` and `webdriver-manager` if the repo has fully standardized on `playwright`, `requests`, and `httpx`.
4. If Selenium is still intentionally supported outside the audited files, document which script or workflow still requires it.

## Bottom Line

- The manifest is mostly aligned with the codebase.
- The real gaps are missing `playwright` and `certifi`.
- The clearest cleanup candidates are `selenium` and `webdriver-manager`, which showed no import usage in the audited code.