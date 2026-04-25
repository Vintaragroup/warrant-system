# Postal Code Cleanup Maintenance

## Overview

Added two utility scripts to help maintain postal code data quality:

### 1. `tools/scan_bad_postal.js`

Scans all county-specific collections for postal code issues:

- Empty strings
- Missing (null, undefined)
- Stray semicolons (';')

**Usage:**

```bash
node tools/scan_bad_postal.js
```

**Output:** Summary table showing collection name, total CRM records, and count of bad postal codes.

---

### 2. `tools/cleanup_postal_codes.js`

Finds records with bad postal codes and geocodes to extract valid ZIP codes.

**Features:**

- Scans for missing, empty, or ';' postal codes
- Geocodes address using Nominatim (OpenStreetMap) with fallback to US Census API
- Batch processing with rate limiting (500ms between batches)
- Dry-run mode (--dry-run flag) to preview changes without saving
- Works against specific county collections via --collection flag
- Optional limit on number of records processed

**Usage:**

Dry-run (preview changes):

```bash
node tools/cleanup_postal_codes.js --collection=simple_harris --dry-run --limit=100
```

Actual cleanup (no limit):

```bash
node tools/cleanup_postal_codes.js --collection=simple_harris
```

Cleanup all records (requires explicit collection):

```bash
node tools/cleanup_postal_codes.js --collection=simple_jefferson
```

**CLI Options:**

- `--dry-run`: Preview changes without updating database
- `--limit=N`: Process only first N records (default: all)
- `--collection=NAME`: Target specific collection (default: simple_harris)

**Output:**

- Total candidates processed
- Count of bad ZIPs found
- Count successfully geocoded
- Count updated in DB
- Error count and sample errors
- Sample outcomes showing SPN, old ZIP, new ZIP, geocoding provider

---

## Related Changes

As of Oct 23, 2025:

### UI Changes (Bail-Bonds-Dashboard)

- `src/pages/CaseDetail.jsx`:
  - ZIP from map geocoder auto-fills CRM and enrichment inputs when missing
  - Treats ';' as empty everywhere (auto-fixes from map)
  - Enrichment defaults pick valid ZIPs, ignore ';'
- `src/components/InlineMapEmbed.jsx`:
  - Returns ZIP from geocoded address via onResolvedAddress callback

### Server Changes (Dashboard API)

- `server/src/routes/cases.js`:
  - Sanitizes ';' to empty on CRM address PATCH operations
  - Prevents re-persisting bad postal codes

### Cleanup Script Improvements (Oct 23, 2025)

- `tools/cleanup_postal_codes.js` now also extracts and updates **state code** from geocoding
- Uses Census Geocoder to get full address components (state abbreviation + zip)
- Updates both `crm_details.address.postalCode` and `crm_details.address.stateCode` in a single operation

---

## Database Status (Oct 23, 2025)

Initial scan results:

```
simple_harris             | CRM:      1 | Bad ZIP:      0
simple_jefferson          | CRM:      0 | Bad ZIP:      0
simple_brazoria           | CRM:      0 | Bad ZIP:      0
simple_galveston          | CRM:      0 | Bad ZIP:      0
simple_fortbend           | CRM:      0 | Bad ZIP:      0
```

**Case: SPN 03306473 (Simple Harris)**

- Before: `postalCode: "77085;"` | `stateCode: ""`
- After: `postalCode: "77085"` | `stateCode: "TX"`
- Method: Census Geocoder on address "5619 LEWQUAY, HOUSTON, TX"

**Total bad postal codes cleaned: 1** ✓  
**Result: Record is now complete with ZIP and state code**
