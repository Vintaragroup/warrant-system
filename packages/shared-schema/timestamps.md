# Timestamp Fields

**Scope:** All collections — `simple_<county>`, `inmates`

---

## Canonical Timestamp Fields

Two fields represent booking time. Both are required by contract. They carry
different formats because different consumers need different granularities.

| Field              | Format                                   | Required                           | Owner    |
| ------------------ | ---------------------------------------- | ---------------------------------- | -------- |
| `booking_datetime` | ISO 8601 string (`YYYY-MM-DDTHH:mm:ssZ`) | Required when source provides time | pipeline |
| `booking_date`     | Date string (`YYYY-MM-DD`)               | Always required                    | pipeline |

### Rule: `booking_date` is always present

`booking_date` is the dashboard-compatible date field. The dashboard's UI and
query logic uses this field for date-range filtering, 72-hour booking window
checks, and display. It must always be present.

**Backfill rule:** If the source record provides `booking_datetime` but not
`booking_date`, the pipeline normalizer must derive `booking_date` by taking
the first 10 characters of `booking_datetime`.

```python
# Python — pipeline normalizer
if not doc.get("booking_date") and doc.get("booking_datetime"):
    doc["booking_date"] = doc["booking_datetime"][:10]
```

```typescript
// TypeScript — enrichment sync script
if (!doc.booking_date && doc.booking_datetime) {
  doc.booking_date = doc.booking_datetime.slice(0, 10);
}
```

### Rule: `booking_datetime` is preferred when available

`booking_datetime` is the full precision timestamp. It is used for:

- `_ingested_at` initialization in the `inmates` collection
- Sorting and deduplication within a single day's records
- Audit and provenance

If the source only provides a date (no time component), `booking_datetime` may
be null. The pipeline must not fabricate a time component.

---

## Internal Timestamp Fields

These fields are set by each service's own write path and must not be
sourced from another service:

| Field                      | Format           | Set by                 | Rule                                                           |
| -------------------------- | ---------------- | ---------------------- | -------------------------------------------------------------- |
| `_normalized_at`           | ISO 8601         | pipeline normalizer    | Set on every write (insert or update)                          |
| `_ingested_at`             | ISO 8601         | enrichment sync script | Set once on first insert via `$setOnInsert`; never overwritten |
| `_sync_updated_at`         | ISO 8601         | enrichment sync script | Updated on every sync upsert                                   |
| `_enriched_at`             | ISO 8601 \| null | enrichment worker      | Set when a provider enrichment run completes successfully      |
| `_enrichment_attempted_at` | ISO 8601 \| null | enrichment worker      | Set on every enrichment attempt (success or failure)           |

---

## `_ingested_at` Derivation

When the sync script inserts a new `inmates` document, it sets `_ingested_at`
using the best available timestamp from the source `simple_*` document:

```
_ingested_at = booking_datetime   (if non-null)
             | booking_date + "T00:00:00Z"   (fallback)
```

This preserves the original booking time for audit purposes, separate from when
the enrichment service first saw the record.

---

## Format Rules

1. All stored timestamps are **strings**, not BSON `Date` objects. This avoids
   timezone conversion surprises when the value is serialized to JSON for the
   dashboard API.
2. All ISO 8601 strings use UTC (`Z` suffix). No local timezone offsets.
3. `booking_date` is always `YYYY-MM-DD` exactly 10 characters. No time component,
   no timezone suffix.
4. No service stores a Unix epoch integer for these fields.

---

## Temporarily Tolerated Aliases

| Alias         | Canonical field    | Where it appears              | Action                                                     |
| ------------- | ------------------ | ----------------------------- | ---------------------------------------------------------- |
| `booking_ts`  | `booking_datetime` | Older enrichment tool scripts | Read both; write canonical only                            |
| `created_at`  | `_normalized_at`   | Some Brazoria raw records     | Present on raw record; normalizer maps to `_normalized_at` |
| `intake_date` | `booking_date`     | Some Fort Bend raw records    | Present on raw record; normalizer maps to `booking_date`   |

---

## Dashboard Fallback Chain (informational)

The dashboard currently uses this fallback chain to display a booking date:

```
booking_date → booking_datetime[:10] → _ingested_at[:10]
```

The first field in the chain that is non-null wins. Because `booking_date` is now
required by pipeline contract, the fallback to `booking_datetime` and `_ingested_at`
should never trigger for documents normalized after this contract was adopted.
The fallback chain remains in dashboard code for compatibility with pre-contract documents.
