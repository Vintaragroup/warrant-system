# Bond Amount Normalization

**Scope:** `bond_amount` field on `simple_<county>` and `inmates` documents

---

## Canonical Type

```
bond_amount: float | null
```

- `bond_amount` is always a **number** (float) or **null** after normalization.
- It is **never** a string after leaving the pipeline normalizer.
- It is **never** negative. A zero value (`0.0`) is valid and means no bond was set.
- `null` means the bond amount is unknown or not applicable (e.g. held without bond).

---

## Pipeline Responsibility

The pipeline normalizer is the **only** place where string-to-number coercion
happens. All downstream consumers (enrichment service, dashboard) must receive
a `float | null` and must not perform their own coercion.

### Coercion function (Python)

```python
import re

def _coerce_bond_amount(raw) -> float | None:
    """
    Coerce a raw bond value from any source format to float or None.
    This function runs in the pipeline normalizer only.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw >= 0 else None
    if isinstance(raw, str):
        # Remove currency symbols, commas, and whitespace
        cleaned = re.sub(r'[$,\s]', '', raw.strip())
        if not cleaned or cleaned.lower() in ('n/a', 'none', 'unknown', '-', ''):
            return None
        try:
            value = float(cleaned)
            return value if value >= 0 else None
        except ValueError:
            return None
    return None
```

---

## Enrichment Service Responsibility

The enrichment worker reads `bond_amount` from `inmates` (which was synced from
`simple_*`). Before using `bond_amount` in any comparison or computation, the
worker must guard against null:

### Null guard (TypeScript)

```typescript
// In the bond threshold gate — worker/src/pipeline.ts or equivalent
const bondAmount = subject.bond_amount;
if (bondAmount === null || bondAmount === undefined) {
  // Cannot determine bondability — set to skipped or pending
  return { bondable: null, reason: "bond_amount_unknown" };
}
if (bondAmount < config.bondThreshold) {
  return { bondable: false, reason: "below_threshold" };
}
```

Do not treat `null` as `0`. A null bond amount is unknown, not zero.

---

## Dashboard Responsibility

The dashboard displays `bond_amount` to agents. Rules:

1. Render `null` as `—` or `Unknown`, not as `$0.00`.
2. Do not re-coerce or parse `bond_amount` from string. If a document has a
   string `bond_amount`, it is a pre-contract document and should be treated
   as unknown (same as null).
3. The dashboard must not write `bond_amount` back to `inmates`. Bond amount
   is pipeline data; if it needs correction, the correction goes through
   a pipeline re-run.

---

## Raw Values and Aliases

### Common raw formats from county sources

| Raw value     | Coerced result | Notes                                         |
| ------------- | -------------- | --------------------------------------------- |
| `"$1,500.00"` | `1500.0`       | Standard US currency string                   |
| `"1500"`      | `1500.0`       | Plain numeric string                          |
| `"N/A"`       | `null`         | Source does not set bond                      |
| `"No Bond"`   | `null`         | Held without bond — maps to null, not 0       |
| `0`           | `0.0`          | Zero bond is valid (released on PR / PR bond) |
| `null`        | `null`         | Already null                                  |
| `""`          | `null`         | Empty string                                  |

### Temporarily tolerated aliases

| Alias         | Canonical field | Notes                                                       |
| ------------- | --------------- | ----------------------------------------------------------- |
| `bond`        | `bond_amount`   | Appears on raw pre-normalization records from some scrapers |
| `total_bond`  | `bond_amount`   | Appears in some older Fort Bend raw records                 |
| `bail_amount` | `bond_amount`   | Appears in some Brazoria raw records                        |

The normalizer must map these aliases to `bond_amount` and coerce the value.
The alias field may remain on the raw record but must not be the only source
of truth in the normalized document.

---

## Edge Cases

| Case                                        | Handling                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Multiple charges with separate bond amounts | Sum all numeric amounts; if any is unknown use total or null as appropriate        |
| Bond amount changes after rebooking         | Pipeline re-run updates `simple_*`; sync script propagates to `inmates` via `$set` |
| Negative bond amount in source              | Treat as null — negative values are data errors                                    |
| Bond amount `0`                             | Valid — represents a PR bond or zero-dollar bond; must not be treated as null      |
