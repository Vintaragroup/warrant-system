# Dashboard: Per-Charge Bond Breakdown

**Added:** 2026-04-29  
**Status:** Live (read-only, no ingestion changes)  
**Collections:** `v2_galveston_events`, `v2_harris_reports`, `v2_lookup_results`

---

## Overview

A "Top Charges by Bond Value" panel on the dashboard that shows which charge types are driving total bond value, with per-charge breakdown across all v2 staging collections.

---

## Endpoint Contract

### `GET /api/dashboard/charge-bonds`

**Query parameters:**

| Param    | Default | Allowed values                     | Description                     |
| -------- | ------- | ---------------------------------- | ------------------------------- |
| `window` | `7d`    | `24h`, `48h`, `72h`, `3d_7d`, `7d` | Date window (legacy date logic) |
| `county` | `all`   | `all` or any county name           | Optional county filter          |
| `limit`  | `20`    | `1–100`                            | Max charge rows returned        |

**Response shape:**

```json
{
  "window": "7d",
  "county": "all",
  "items": [
    {
      "charge": "POSS CS PG 1/1-B <1G",
      "totalBond": 270000,
      "avgBond": 11739,
      "count": 23,
      "countyBreakdown": {
        "brazoria": 0,
        "fortbend": 0,
        "galveston": 7,
        "harris": 0,
        "jefferson": 16
      }
    }
  ]
}
```

Items are sorted by `totalBond` descending. `avgBond` is computed server-side as `Math.round(totalBond / count)`.

---

## Aggregation Rules

### Date Window

Uses the same legacy calendar-day booking_date logic as `/per-county`. The pipeline:

1. Runs `unionAllFast(coarseMatch, project, { needBond: true, needBooking: true })` across all v2 collections
2. Applies `$match { booking_date: ... }` after normalization

Window → booking_date filter:

| Window  | Filter                                                   |
| ------- | -------------------------------------------------------- |
| `24h`   | `{ booking_date: todayYmd }`                             |
| `48h`   | `{ booking_date: yesterdayYmd }`                         |
| `72h`   | `{ booking_date: twoDaysYmd }`                           |
| `3d_7d` | `{ booking_date: { $gte: since7Ymd, $lte: since3Ymd } }` |
| `7d`    | `{ booking_date: { $gte: since7Ymd } }`                  |

`since7Ymd` = today minus 6 days (inclusive 7-day range).

### Charge Source Logic

Field shapes vary by collection. The `_chargeRows` expansion handles three cases:

**Priority 1 — `charges[]` array present:**

- Description: `charges[].description` → `charges[].charge` → `charges[].charge_description` (first non-null)
- Bond: `charges[].bond_amount` (numeric) → `charges[].bail_amount_int` (numeric) → parse `charges[].bond` string (regex: `\$[\d,]+(?:\.\d+)?`)

**Priority 2 — no `charges[]` but `charge_description` exists at top level:**

- Description: `charge_description`
- Bond: top-level `bond_amount`

**Skip:** records with neither `charges[]` nor `charge_description`.

### Field Shape by Collection

| Collection            | Description field                | Bond field                                               |
| --------------------- | -------------------------------- | -------------------------------------------------------- |
| `v2_galveston_events` | `charges[].charge`               | `charges[].bond` text e.g. `"CASH OR SURETY $60,000.00"` |
| `v2_lookup_results`   | `charges[].charge_description`   | `charges[].bail_amount_int` (numeric int)                |
| `v2_harris_reports`   | `charge_description` (top-level) | `bond_amount` (top-level numeric)                        |

Descriptions are normalized to `UPPER CASE` with whitespace trimmed before grouping.

### Bond Calculation

- Numeric values: used as-is
- Text strings (Galveston format): regex extracts `$X,XXX.XX` → strip `$` and commas → `$convert` to `double`
- Ignore: `null`, `"N/A"`, `"DENIED $0.00"` → 0
- Non-numeric / unrecognized strings: 0 (never included in totalBond sum)

### Sorting / Limit

Sorted by `totalBond` descending. Default limit 20, max 100 via `?limit=`.

---

## Caching

Uses the existing in-memory `withCache` helper with `DASH_CACHE_TTL_MS` (default 30 seconds). Cache key: `chargeBonds:{window}:{county}:{limit}`.

---

## Hook

`useChargeBonds` in `apps/dashboard/src/hooks/dashboard.js`:

```js
useChargeBonds({ window = '7d', county = 'all', limit = 20 })
```

Returns `{ data, isLoading, error }` via React Query. `staleTime: 60_000`.

---

## Frontend Panel

**Location:** Below "County Bond Value" panel, above "Inmate Snapshot".

**Features:**

- Table: Charge | Total Bond | Avg Bond | Count
- Horizontal bar visualization (relative to top charge's `totalBond`)
- County filter dropdown (all counties / per-county)
- Window selector: `24h | 48h | 72h | 7d` (independent from main `valueWindow`)
- Shows top 10 by default; "View all N charges" toggle for full list

**State:**

- `chargeWindow` (string, default `'7d'`)
- `chargeCounty` (string, default `'all'`)
- `showAllCharges` (boolean, default `false`)

---

## Validation Results (2026-04-29)

### API — all counties, 7d window

```
window=7d  county=all  items=10 (top results)
MURDER                                    $1,000,000  avg $333,333  n=3  galv=2
SEX ABUSE OF CHILD CONTINUOUS: VICTIM…   $  800,000  avg $400,000  n=2  galv=2
MAN DEL CS PG 1 >=4G<200G                $  550,000  avg $183,333  n=3  galv=3
AGG ASSAULT W/DEADLY WEAPON              $  470,000  avg $ 52,222  n=9  galv=8
POSS CS PG 1/1-B >=1G<4G                 $  450,000  avg $ 75,000  n=6  galv=6
```

### API — Galveston only, 7d window

```
Galveston 7d: 10 charges, top-10 totalBond=$4,195,000
SEX ABUSE OF CHILD CONTINUOUS: VICTIM…   $  800,000  n=2
MAN DEL CS PG 1 >=4G<200G                $  550,000  n=3
MURDER                                    $  500,000  n=2
AGG ASSAULT W/DEADLY WEAPON              $  470,000  n=8
POSS CS PG 1/1-B >=1G<4G                 $  450,000  n=6
```

### Mongo Sanity Check (Python direct aggregation)

Direct Python aggregation over `v2_galveston_events` (106 docs in 7d window) matches API exactly:

```
Docs in 7d: 106
SEX ABUSE OF CHILD CONTINUOUS...     $   800,000  n=2   ✅ matches API
MAN DEL CS PG 1 >=4G<200G           $   550,000  n=3   ✅
MURDER                               $   500,000  n=2   ✅
AGG ASSAULT W/DEADLY WEAPON         $   470,000  n=8   ✅
POSS CS PG 1/1-B >=1G<4G            $   450,000  n=6   ✅
```

---

## Constraints

- Read-only — no writes to MongoDB
- Does not modify existing KPI semantics
- Does not expose PII beyond already-displayed charge descriptions
- Does not modify ingestion
- `DISABLE_TIME_BUCKET_V2=true` in admin-dev → always uses legacy date-range path
