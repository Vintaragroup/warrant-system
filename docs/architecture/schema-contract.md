# Schema Contract

**Date:** 2026-04-24
**Status:** Decided
**Affects:** `warrantdb-pipeline` (producer), `bail-bonds-dashboard` (consumer), `inmate-enrichment` (consumer via sync)

---

## Purpose

This document defines the binding field contract for `simple_<county>` collections — the normalized output of the pipeline that both the dashboard and the enrichment sync script consume. It also specifies bond amount coercion rules that apply in the pipeline normalizer.

This contract exists because:

- The pipeline's `SCHEMA_CONTRACT.md` documents fields from the producer's perspective
- The dashboard's `DATA_SCHEMA_AUDIT.md` documents expected fields from the consumer's perspective
- These were written independently with no shared authority
- Field mismatches silently produce wrong data, not errors

---

## Part 1 — Booking Date Contract

### Decision

`booking_date` (string, `YYYY-MM-DD` format) is the **contract field** between pipeline output and dashboard input for all booking date operations.

### Rationale

The dashboard derives its display booking date via a 5-field fallback chain at query time:

```
booking_date → booked_at → booking_date_iso → normalized_at → scraped_at
```

`booking_date` is checked first. The pipeline also stores `booking_datetime` (ISO8601 UTC) and `booking_date_v2` (YYYY-MM-DD), but neither of these appears in the dashboard's fallback chain. If only `booking_datetime` is present, the dashboard falls through to `normalized_at` or `scraped_at`, producing a wrong age bucket and time-window classification for every affected record.

The fix is in the pipeline normalizer, not the dashboard. The dashboard's fallback chain is intentionally resilient to older records that predate `booking_datetime` and must not be changed.

### Pipeline normalizer requirement

In `normalize_to_simple.py`, in the post-process step, `booking_date` must be guaranteed to be present whenever `booking_datetime` is present:

```python
# In the post-process block, after booking_datetime is derived:
if not doc.get("booking_date") and doc.get("booking_datetime"):
    doc["booking_date"] = doc["booking_datetime"][:10]  # "YYYY-MM-DD"
```

`booking_datetime` and `booking_date_v2` are not removed. They remain for systems that consume them directly. The backfill only sets `booking_date` when absent.

### Affected files

| File                                                 | Change                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `services/warrantdb-pipeline/normalize_to_simple.py` | Add `booking_date` backfill from `booking_datetime` in post-process block |

---

## Part 2 — Bond Amount Contract

### Decision

The pipeline normalizer is the **sole owner of bond amount coercion**. `bond_amount` in `simple_<county>` must be:

- A `float` ≥ 0, or
- `None` / absent (meaning bond data is unknown or not applicable)

It must never be a string, an object, or a formatted currency value (e.g., `"$5,000"`).

The enrichment eligibility gate must treat `None` / absent `bond_amount` as "no bond data available" and apply the `BOND_THRESHOLD` check only when a numeric value is confirmed present.

### Rationale

The enrichment service reads `bond_amount` from the `inmates` record (populated from `simple_*` by the sync script). It then falls back to the `bond` field. If `bond_amount` is null and `bond` is a string like `"$5,000.00"`, the coercion behavior is undefined at the TypeScript layer. The outcome (eligible or ineligible for enrichment) is non-deterministic — it depends on JavaScript's implicit type coercion rules at the comparison site. This affects provider API call volume and billing directly.

Placing coercion in the normalizer (Python) is simpler, testable in isolation, and ensures the downstream TypeScript code never receives a mixed type.

### Pipeline normalizer requirement

In `normalize_to_simple.py`, in the bond normalization block:

```python
def _coerce_bond_amount(doc: dict) -> float | None:
    ba = doc.get("bond_amount")
    if isinstance(ba, (int, float)):
        return float(ba)
    if ba is None and doc.get("bond"):
        raw = str(doc["bond"]).replace("$", "").replace(",", "").strip()
        try:
            return float(raw)
        except (ValueError, TypeError):
            return None
    return None

doc["bond_amount"] = _coerce_bond_amount(doc)
```

The raw `bond` field is preserved unchanged. Only `bond_amount` is overwritten with the coerced result.

### Enrichment gate requirement

In the enrichment service bond threshold check (in `shared/src/config.ts`, `watcher.ts`, or `sweep.ts` — wherever the gate is evaluated), add an explicit null guard:

```typescript
const rawBond = subject.bond_amount ?? subject.bond;
const bondNum =
  typeof rawBond === "number" ? rawBond : parseFloat(String(rawBond ?? ""));
const bondKnown = !isNaN(bondNum);

if (bondKnown && bondNum < BOND_THRESHOLD) {
  // skip: bond amount confirmed below threshold
}
// if !bondKnown: proceed; bond data unavailable, do not block
```

This means records with no bond data are **allowed through** the gate. Records with a confirmed bond amount below threshold are blocked. This is the more defensible behavior: failing open (enrich when uncertain) is preferable to failing closed (silently skip records that may be high-value).

### Affected files

| File                                                 | Change                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `services/warrantdb-pipeline/normalize_to_simple.py` | Add `_coerce_bond_amount` function and apply in post-process block |
| `services/inmate-enrichment/shared/src/config.ts`    | Add null-safe bond comparison logic                                |

---

## Part 3 — Guaranteed Output Fields

The following fields are **required** in every `simple_<county>` document emitted by the normalizer. Absent values must be `None`/null — not missing keys. This allows consumers to rely on key presence.

| Field                | Type                          | Required by                                             |
| -------------------- | ----------------------------- | ------------------------------------------------------- |
| `spn`                | `string \| null`              | Enrichment sync key; dashboard display                  |
| `full_name`          | `string`                      | Dashboard display; enrichment sync                      |
| `county`             | `string`                      | Dashboard collection routing; enrichment `county` field |
| `booking_date`       | `string (YYYY-MM-DD) \| null` | Dashboard time-bucket; enrichment window gate           |
| `bond_amount`        | `float \| null`               | Enrichment eligibility gate; dashboard display          |
| `status`             | `string \| null`              | Dashboard display                                       |
| `charge`             | `string \| null`              | Dashboard display                                       |
| `_upsert_key.county` | `string`                      | Canonical identity; dashboard union queries             |
| `_upsert_key.anchor` | `string`                      | Canonical identity                                      |

Fields not in this list are permitted but not guaranteed. Consumers must not assume their presence.

---

## Part 4 — County Slug Format

`county` values in `simple_<county>` output must use the lowercase slug format:

| County    | Correct slug |
| --------- | ------------ |
| Harris    | `harris`     |
| Brazoria  | `brazoria`   |
| Galveston | `galveston`  |
| Fort Bend | `fortbend`   |
| Jefferson | `jefferson`  |

The enrichment service does not validate county format. If a record arrives with `county = "Harris County"` or `county = "HARRIS"`, county-scoped routing will silently fail in any consumer that depends on slug matching (including the dashboard's `COUNTY_COLLECTIONS` list and the enrichment service's county-based logic).

The pipeline normalizer is responsible for enforcing slug format. No change to consumers is required.

---

## Implementation Order

1. `normalize_to_simple.py` — `booking_date` backfill (Part 1)
2. `normalize_to_simple.py` — `bond_amount` coercion (Part 2)
3. `inmate-enrichment` enrichment gate — null-safe bond guard (Part 2)
4. Validate county slug format consistency across all county mapping configs (Part 4)

Parts 1 and 2 are independent and can be implemented simultaneously in the same normalizer edit.

---

## Risks If Deferred

| Risk                                                                                        | Severity                                                 |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Dashboard assigns every new record to the wrong time bucket (falls to `normalized_at`)      | High — core dashboard view is wrong for all new records  |
| Enrichment gate makes non-deterministic eligibility decisions for string-format bond values | High — provider API billing is unpredictable             |
| Records with `county = "Harris County"` are invisible to the dashboard and enrichment       | Medium — silent data loss for malformed upstream records |
