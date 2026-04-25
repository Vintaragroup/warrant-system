# `inmates` Collection Schema

**Owner:** `inmate-enrichment`
**Write authority:** enrichment service only
**Collection name:** `inmates` (configurable via `IE_SUBJECTS_COLLECTION` / `SUBJECTS_COLLECTION`)

---

## Purpose

`inmates` is the enrichment service's working collection. It is populated by
the sync script (which upserts from `simple_<county>`) and then enriched with
provider data (PDL, Pipl, Whitepages, HCSO). The dashboard reads from this
collection via the enrichment API proxy — it never writes to it directly.

---

## Field Ownership Zones

### Zone 1 — Pipeline-originated fields (read-only after sync)

These fields are copied from `simple_<county>` at sync time and must not be
overwritten by any enrichment step:

| Field | Type | Source |
|---|---|---|
| `spn` | `string` | `simple_*` |
| `full_name` | `string \| null` | `simple_*` |
| `county` | `string` | `simple_*` |
| `booking_date` | `string` (YYYY-MM-DD) | `simple_*` |
| `booking_datetime` | `string` (ISO 8601) \| `null` | `simple_*` |
| `bond_amount` | `number \| null` | `simple_*` |
| `status` | `string \| null` | `simple_*` |
| `charge` | `string \| null` | `simple_*` |
| `_source` | `string` | `simple_*` |
| `_upsert_key` | `object` | `simple_*` |
| `_normalized_at` | `string` (ISO 8601) | `simple_*` |

---

### Zone 2 — Enrichment lifecycle fields (set by enrichment service)

These fields are created by the sync script on first insert and updated by
the enrichment worker:

| Field | Type | Set by | Notes |
|---|---|---|---|
| `enrichment_status` | `string` | enrichment worker | `pending` \| `in_progress` \| `enriched` \| `failed` \| `skipped` |
| `enrichment_providers` | `string[]` | enrichment worker | List of providers that have been called (e.g. `['pdl', 'hcso']`) |
| `_ingested_at` | `string` (ISO 8601) | sync script | Set once on first insert; never updated. Maps from `booking_datetime` if present, else `booking_date` + `T00:00:00Z`. |
| `_enriched_at` | `string` (ISO 8601) \| `null` | enrichment worker | Last time provider enrichment completed successfully |
| `_enrichment_attempted_at` | `string` (ISO 8601) \| `null` | enrichment worker | Last time enrichment was attempted (including failed attempts) |
| `_sync_updated_at` | `string` (ISO 8601) | sync script | Updated every time the sync script touches this document |

**Lifecycle field rules:**

- `_ingested_at` is set **only on first insert** via `$setOnInsert`. It is never
  overwritten on subsequent syncs.
- `enrichment_status` is initialized to `pending` on first insert via `$setOnInsert`.
  The enrichment worker is the only code that changes it after that.
- `_sync_updated_at` is updated on every sync upsert, including re-syncs.

---

### Zone 3 — Provider data (set by enrichment worker, namespaced)

Provider results are stored under a top-level namespace key for each provider.
No provider key is merged into the root document — enriched data lives under
its provider namespace.

| Field | Type | Notes |
|---|---|---|
| `pdl` | `object \| null` | Full PDL response for this subject |
| `pipl` | `object \| null` | Full Pipl response for this subject |
| `whitepages` | `object \| null` | Full Whitepages Pro response |
| `hcso` | `object \| null` | DOB and basic inmate record from HCSO |

---

### Zone 4 — Derived fields (computed by enrichment service, stored for performance)

These fields are written by the enrichment worker after candidate scoring and
must not be sourced from the pipeline:

| Field | Type | Notes |
|---|---|---|
| `date_of_birth` | `string` (YYYY-MM-DD) \| `null` | Best DOB from HCSO or provider data |
| `age` | `number \| null` | Computed from `date_of_birth` at enrichment time |
| `related_parties` | `object[]` | Scored related-party records (kin, contacts) |
| `bondable` | `boolean \| null` | Bondability assessment result |
| `bondability_reason` | `string \| null` | Human-readable reason for bondability result |
| `candidate_score` | `number \| null` | Best provider match confidence (0–1) |

---

### Zone 5 — Dashboard CRM overlay fields (set by dashboard, read-only for enrichment)

These fields are written by the dashboard server when agents add notes,
assign bond agents, or log actions. The enrichment service must never write
these fields.

| Field | Type | Owner |
|---|---|---|
| `bond_agent` | `string \| null` | dashboard |
| `case_notes` | `string[]` | dashboard |
| `assigned_at` | `string` (ISO 8601) \| `null` | dashboard |
| `flagged` | `boolean` | dashboard |
| `flag_reason` | `string \| null` | dashboard |

**These fields are defined here for completeness only.** The enrichment service
treats them as opaque. If the dashboard writes them via a direct Mongo update,
the enrichment worker must use `$set` for its own fields to avoid overwriting them.

---

## Temporarily Tolerated Aliases

| Alias | Canonical field | Notes |
|---|---|---|
| `dob` | `date_of_birth` | Some tools and scripts use `dob`; the enrichment worker reads both |
| `subjects_collection` env var | `SUBJECTS_COLLECTION` env var | Same runtime var; both accepted |
| `booking_ts` | `booking_datetime` | Appears in some older enrichment tool scripts |

---

## Primary Index

The enrichment service is responsible for maintaining this index on `inmates`:

| Index | Fields | Type |
|---|---|---|
| Primary upsert key | `spn`, `county` | unique compound |
| Enrichment queue queries | `enrichment_status`, `_ingested_at` | compound ascending |
| Bond threshold filter | `bond_amount` | ascending |
| Sync recency | `_sync_updated_at` | descending |

---

## Upsert Key

The sync script upserts from `simple_*` into `inmates` using:

```
{ spn: <value>, county: <value> }
```

This key is identical to the `_upsert_key.fields` declared in `simple_*`.
