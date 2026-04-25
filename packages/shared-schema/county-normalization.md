# County Normalization

**Scope:** `simple_<county>` collection name suffix, `county` field on all documents

---

## Canonical County Slugs

The `county` field on every `simple_*` and `inmates` document must be one of
the following lowercase slugs. No other value is valid.

| Slug        | Full name        | State | Active |
| ----------- | ---------------- | ----- | ------ |
| `harris`    | Harris County    | TX    | Yes    |
| `brazoria`  | Brazoria County  | TX    | Yes    |
| `galveston` | Galveston County | TX    | Yes    |
| `fortbend`  | Fort Bend County | TX    | Yes    |
| `jefferson` | Jefferson County | TX    | Yes    |

**Adding a new county:** Add a row to this table, create the corresponding
`configs/<slug>.json` in the pipeline, and ensure the normalizer sets `county`
to the new slug. Do not use the new slug in production until the entry is added here.

---

## Normalization Rules

1. **Always lowercase.** `Harris` → `harris`. No mixed case is stored.
2. **No spaces.** `Fort Bend` → `fortbend`. No spaces or hyphens in slugs.
3. **No state suffix.** `harris_tx` is not valid. The `county` field alone
   identifies the county; all counties in this system are in Texas.
4. **Collection name pattern is `simple_<slug>`.** The collection name uses
   exactly the slug from this table: `simple_harris`, `simple_fortbend`, etc.

---

## Pipeline Responsibility

The normalizer in `warrantdb-pipeline` is responsible for:

1. Setting `county` to the canonical slug for every record it produces.
2. Writing to the collection named `simple_<slug>`.

The pipeline must reject (or log and skip) any record where the county cannot
be determined.

---

## Enrichment Responsibility

The sync script reads from `simple_<slug>` collections. It uses the `county`
value from the document as-is — it does not re-normalize it. The `county` field
is part of the upsert key in `inmates`:

```
{ spn: <value>, county: <value> }
```

Because the sync key depends on the exact `county` string, a change to a county
slug for existing documents would result in duplicate `inmates` records. Do not
rename a slug retroactively without a backfill migration.

---

## Dashboard Responsibility

The dashboard uses `county` for display and filtering. It must accept any slug
from the canonical list. It must not rewrite or normalize `county` values when
saving CRM overlay fields.

---

## Temporarily Tolerated Aliases

Some older pipeline versions or raw scrapers produced non-canonical county values.
The normalizer must map these to the canonical slug before writing to `simple_*`.

| Non-canonical value | Canonical slug | Notes                       |
| ------------------- | -------------- | --------------------------- |
| `Harris`            | `harris`       | Capitalized variant         |
| `fort bend`         | `fortbend`     | Space variant               |
| `Fort Bend`         | `fortbend`     | Space + title case variant  |
| `fort_bend`         | `fortbend`     | Underscore variant          |
| `harris_county`     | `harris`       | County-suffix variant       |
| `galveston county`  | `galveston`    | County-suffix space variant |

Once a document is written to `simple_*` with a canonical slug, no alias should
persist in the stored document. The alias list above is for the normalizer's
input-mapping logic only.

---

## County Slug in Filenames and Config Keys

The slug is also used as:

- The key in `configs/` JSON files: `configs/harris.json`, `configs/brazoria.json`
- The `--source` argument pattern in pipeline scripts: `--source harris_inmate`
  (note: script source names may include a suffix like `_inmate` or `_email_roster`;
  the slug portion must match the canonical slug)

These usages must stay consistent with the slug table above.
