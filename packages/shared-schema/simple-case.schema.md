# `simple_<county>` Collection Schema

**Owner:** `warrantdb-pipeline`
**Write authority:** pipeline normalizer only
**Collection name pattern:** `simple_harris`, `simple_brazoria`, `simple_galveston`, `simple_fortbend`, `simple_jefferson`

---

## Purpose

`simple_<county>` is the pipeline's normalized output collection. Every county
scraper produces raw records; the normalizer transforms them into this canonical
shape. The enrichment service reads from these collections during the sync step
(see `docs/architecture/simple-to-enrichment-handoff.md`). No other service writes here.

---

## Guaranteed Output Fields

Every document written by the normalizer **must** contain these fields. If a value
cannot be determined, the field must be present with a `null` value — it must never
be absent.

| Field              | Type                          | Notes                                                                                            |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `spn`              | `string`                      | Harris County SPN or equivalent county booking ID. Primary shared identifier. Must be non-empty. |
| `full_name`        | `string \| null`              | Normalized full name. Null if source does not provide one.                                       |
| `county`           | `string`                      | Lowercase slug. See [county-normalization.md](./county-normalization.md).                        |
| `booking_date`     | `string` (YYYY-MM-DD)         | Dashboard-compatible date. Required. See [timestamps.md](./timestamps.md).                       |
| `booking_datetime` | `string` (ISO 8601) \| `null` | Full timestamp when available. Canonical timestamp field.                                        |
| `bond_amount`      | `number \| null`              | Always numeric after normalization. See [bond-normalization.md](./bond-normalization.md).        |
| `status`           | `string \| null`              | Booking or bond status string from source. Raw value, not normalized.                            |
| `charge`           | `string \| null`              | Primary charge description. Null if source does not provide one.                                 |
| `_upsert_key`      | `object`                      | Composite upsert metadata (see below).                                                           |
| `_normalized_at`   | `string` (ISO 8601)           | Timestamp when the normalizer wrote this document. Set by pipeline only.                         |
| `_source`          | `string`                      | Identifies the scraper that produced the raw record (e.g. `harris_inmate`, `brazoria_direct`).   |

---

## `_upsert_key` Sub-object

The `_upsert_key` object records the fields used as the upsert key when the
normalizer wrote this document. It exists so the enrichment sync script can
reproduce the same key without reimplementing the county-specific logic.

```json
{
  "_upsert_key": {
    "fields": ["spn", "county"],
    "value": "1234567:harris"
  }
}
```

| Sub-field | Type       | Notes                                            |
| --------- | ---------- | ------------------------------------------------ |
| `fields`  | `string[]` | Field names that form the composite key          |
| `value`   | `string`   | Concatenated value used as the actual unique key |

---

## Temporarily Tolerated Aliases

These field names appear in documents written by older pipeline versions or
specific county scrapers. The normalizer must backfill the canonical field
if the alias is present but the canonical field is absent. The alias may remain
on the document — do not strip it.

| Alias                     | Canonical field | Notes                                                                             |
| ------------------------- | --------------- | --------------------------------------------------------------------------------- |
| `booking_datetime` (only) | `booking_date`  | If `booking_date` is absent, backfill from `booking_datetime` using `[:10]` slice |
| `dob`                     | `date_of_birth` | `dob` appears in some Harris scrapers; `date_of_birth` is preferred               |
| `name`                    | `full_name`     | Older Brazoria records use `name`                                                 |
| `offense`                 | `charge`        | Some Fort Bend records use `offense`                                              |
| `bond`                    | `bond_amount`   | Some raw records use `bond` before normalization                                  |

---

## Fields Owned Exclusively by the Pipeline

The following fields are set by the pipeline and must **never** be overwritten
by another service:

- `_normalized_at`
- `_source`
- `_upsert_key`

If the enrichment sync script upserts a document into `inmates`, it copies the
fields above verbatim from `simple_*` without modification.

---

## Fields Not Present in `simple_*`

The following fields belong to other collections and must not appear in `simple_*`:

| Field                  | Where it belongs               |
| ---------------------- | ------------------------------ |
| `enrichment_status`    | `inmates` (enrichment service) |
| `enrichment_providers` | `inmates` (enrichment service) |
| `_enriched_at`         | `inmates` (enrichment service) |
| `bond_agent`           | CRM overlay (dashboard)        |
| `case_notes`           | CRM overlay (dashboard)        |

---

## Indexes

The pipeline is responsible for maintaining these indexes on each `simple_<county>`
collection:

| Index                | Fields          | Type            |
| -------------------- | --------------- | --------------- |
| Primary upsert index | `spn`, `county` | unique compound |
| Date range queries   | `booking_date`  | ascending       |
| Status filter        | `status`        | ascending       |
