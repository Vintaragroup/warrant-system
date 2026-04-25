# Data Schema Audit

## Scope

This audit extracts the effective MongoDB schema used by the pipeline repository across raw ingestion and normalized output.

Code paths reviewed:

- `scripts/run_pipeline.py`
- `scripts/run_ingestion.py`
- `ingestion/base_scraper.py`
- selected `ingestion/*.py` scrapers and wrappers
- `normalize_to_simple.py`
- `storage/schemas.py`
- existing `SCHEMA_CONTRACT.md`

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the schema description below is grounded directly in code and existing repo contracts.

## Observations

- This repo owns both raw Mongo collections and normalized `simple_*` output collections.
- The schema is not one single document shape; it is a pipeline of raw person/event records, county-specific raw collections, and normalized cross-county case documents.
- `normalize_to_simple.py` is the decisive point where canonical output fields are attached and rewritten.

## Reasoning

The effective schema is the union of:

1. raw write shapes emitted by scrapers
2. `persons` upsert behavior in `ingestion/base_scraper.py`
3. normalized output fields produced and post-processed in `normalize_to_simple.py`
4. contract fields already formalized in `SCHEMA_CONTRACT.md`

## Collections

- `persons`
- county raw collections such as `harris_bond`, Brazoria raw output, Jefferson raw output, and other mapping-backed sources
- non-person event collections emitted by scrapers via `_collection`
- normalized collections `simple_<county>` such as `simple_harris`

## Field Inventory

### `persons`

The `persons` collection is the generic raw identity store used by `BaseScraper.upsert_person(...)`.

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `_ext_id` | string | scraper output | preferred upsert key |
| `full_name` | string | scraper output | fallback upsert key |
| `dob` | string or null | scraper output | fallback upsert key |
| `aka` | string[] | `storage/schemas.py` person model | alternate names |
| `identifiers` | object | scraper output | id buckets |
| `identifiers.booking[]` | string[] | scraper output | secondary upsert key |
| `contact` | object | scraper output | raw contact info |
| `links` | object[] | scraper output | provenance or relationship links |
| `created_at` | date | scraper output or pydantic default | raw create time |
| `updated_at` | date | Mongo `$currentDate` in base scraper | always touched on upsert |
| other scraper-specific raw fields | mixed | scraper output | allowed because write is `$set: doc` |

### Generic non-person raw event collections

Any scraper yielding `_collection != 'persons'` inserts the raw document directly into that collection.

Common fields inferred from `storage/schemas.py` and ingestion behavior:

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `person_id` | string or objectId-like string | injected by `run_ingestion.py` when absent | links event to last inserted person |
| `county` | string | scraper output | county slug/name |
| `facility` | string | scraper output | custody facility |
| `booking_number` | string | scraper output | booking identifier |
| `status` | string | scraper output | event status |
| `booked_at` | date or string | scraper output | booking time |
| `released_at` | date or string | scraper output | release time |
| `source_url` | string | scraper output | provenance |
| `scraped_at` | date | pydantic default or scraper output | scrape time |
| `charges[]` | object[] | scraper output | raw charges |
| `bonds[]` | object[] | scraper output | raw bond array |
| `number` | string | scraper output | warrant number |
| `offense` | string | scraper output | warrant offense |
| `issuing_agency` | string | scraper output | warrant origin |
| `issued_date` | string | scraper output | warrant issue date |
| `bond` | object | scraper output | warrant bond object |

### County raw collections

The exact raw schema varies by source. The Harris raw bond feed is the clearest formalized example from the repo field inventory and contract docs.

#### `harris_bond`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `_id` | objectId | Mongo | raw document id |
| `group` | string | Harris source | group/category |
| `case_number` | string | Harris source | raw case number |
| `spn` | string | Harris source | subject identifier |
| `address.line1` | string | Harris source | raw address |
| `address.city` | string | Harris source | raw address |
| `address.zip` | string | Harris source | raw address |
| `bond_amount` | number | Harris source | numeric bond amount |
| `bond_note` | string | Harris source | raw bond note |
| `court_group` | string | Harris source | raw court group |
| `court_no` | string | Harris source | raw court number |
| `file_date` | string | Harris source | feed file date |
| `first_middle` | string | Harris source | source name fragment |
| `first_seen_at` | string or datetime | Harris ingest | first seen timestamp |
| `first_seen_file_date` | string | Harris ingest | first seen file date |
| `history[]` | object[] | Harris ingest | feed history over time |
| `last_seen_file_date` | string | Harris ingest | last seen date |
| `name` | string | Harris source | display name |
| `needs_bond_help` | boolean | Harris ingest or post-process | heuristic field |
| `offense` | string | Harris source | offense |
| `race_code` | string | Harris source | demographic raw code |
| `scraped_at` | string or datetime | Harris ingest | scrape timestamp |
| `sex_code` | string | Harris source | demographic raw code |
| `source` | string | Harris ingest | provenance |
| `source_filename_date` | string | Harris ingest | provenance |
| `source_url` | string | Harris ingest | provenance |
| `updated_at` | string or datetime | Harris ingest | update timestamp |
| `booking_age_category` | string | Harris ingest | legacy age bucket |
| `booking_priority` | number | Harris ingest | legacy priority |

Other county raw collections follow the same pattern: scraper-owned, source-shaped fields with minimal normalization before storage.

### `simple_<county>` normalized collections

`normalize_to_simple.py` and `SCHEMA_CONTRACT.md` together define the effective canonical output.

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `_upsert_key.county` | string | mapping primary key + normalizer | canonical identity component |
| `_upsert_key.category` | string | mapping primary key + normalizer | canonical identity component |
| `_upsert_key.anchor` | string | mapping primary key, possibly rewritten from `case_number` | canonical identity component |
| `county` | string | mapping output | normalized county slug |
| `category` | string | mapping output | docket group |
| `case_number` | string | mapping output and post-process normalization | normalized case number |
| `full_name` | string | mapping output | display name |
| `booking_date` | string `YYYY-MM-DD` | mapping output | legacy booking date field |
| `booking_datetime` | string ISO8601 UTC or date-like string | derived in post-process | canonical booking instant |
| `booking_date_v2` | string `YYYY-MM-DD` | derived from `booking_datetime` | canonical display/grouping date |
| `booking_derivation_source` | string enum-like | derived in post-process | `first_seen_at`, `updated_at`, or `legacy_booking_date` |
| `time_bucket` | string | recomputed from `booking_date` | legacy age bucket |
| `time_bucket_v2` | string | derived from `booking_datetime` | `0_24h`, `24_48h`, `48_72h`, `3d_7d`, `7d_30d`, `30d_60d`, `60d_plus` |
| `bond_amount` | number or null | mapping output or post-process backfill | canonical numeric bond |
| `bond` | mixed | mapping output | transitional raw-ish bond field |
| `bond_label` | string | mapping output or post-process | canonical textual bond meaning |
| `bond_note` | string | mapping output | optional raw note |
| `needs_bond_help` | boolean | mapping or post-process heuristics | business heuristic |
| `booking_priority` | number | legacy ingest logic | business heuristic |
| `booking_age_category` | string | legacy ingest logic | legacy heuristic bucket |
| `charge` | string | mapping output | normalized charge |
| `status` | string | mapping output | normalized status |
| `race` | string | mapping output | normalized demographic |
| `age` | number or string coerced by mapping | mapping output | normalized demographic |
| `sex` | string | mapping output | normalized demographic |
| `scraped_at` | string or date | raw-to-normalized carry-through | source metadata |
| `normalized_at` | string or date | normalizer run | normalization timestamp |
| `tags` | string[] | post-process and anomaly logic | includes `future_date_candidate` etc. |
| `history` | object[] | raw carry-through in some counties | not guaranteed cross-county |
| `phones_source` | string | supplemental phone import processes | provenance |
| `phones_updated_at` | string or date | supplemental phone import processes | provenance timestamp |
| `phone_nbr1` | string | supplemental roster import | optional phone slot |
| `phone_nbr2` | string | supplemental roster import | optional phone slot |
| `phone_nbr3` | string | supplemental roster import | optional phone slot |
| `ingest_lag_days` | number | post-process derivation | computed from `booking_date` and `normalized_at` |
| `ingest_lag_hours` | number | post-process derivation | computed from `booking_date` and `normalized_at` |
| `source` | string | raw carry-through | provenance |
| `source_url` | string | raw carry-through | provenance |
| `source_filename_date` | string | raw carry-through | provenance |

## Naming And Structure Inconsistencies

| Issue | Severity | Details |
|---|---|---|
| raw collections are source-specific and loosely shaped | high | there is no enforced shared raw schema beyond scraper conventions |
| `bond`, `bond_amount`, and `bond_label` coexist | high | one concept is represented three ways |
| `booking_date` vs `booking_datetime` vs `booking_date_v2` | high | legacy and canonical booking fields coexist during migration |
| `time_bucket` vs `time_bucket_v2` | medium | both legacy and v2 buckets are stored |
| `updated_at` and `normalized_at` and `scraped_at` vary between string and date-like forms | medium | temporal typing is not fully normalized in raw layers |
| `persons` upsert key falls back to `(full_name, dob)` | medium | identity can collide for common names/incomplete DOB |
| raw event collections inherit `person_id` opportunistically from the last inserted person | medium | relationship binding depends on ingestion order in the generic path |
| county-specific raw collections differ substantially | low | expected operationally, but it prevents a single raw contract |

## Canonical Schema Proposal

### Raw identity layer: `persons`

```json
{
  "personId": "objectId",
  "externalId": "string|null",
  "fullName": "string",
  "dob": "string|null",
  "aliases": ["string"],
  "identifiers": {
    "booking": ["string"],
    "sourceIds": ["string"]
  },
  "contact": {
    "phones": ["string"],
    "emails": ["string"],
    "address": "object|null"
  },
  "links": ["object"],
  "createdAt": "date|null",
  "updatedAt": "date"
}
```

### Raw county layer

Do not force one universal raw payload schema, but require a common envelope:

```json
{
  "sourceCounty": "string",
  "sourceType": "string",
  "sourceUrl": "string|null",
  "scrapedAt": "date|string|null",
  "sourcePayload": "object",
  "personId": "string|null"
}
```

County-specific fields can remain nested under `sourcePayload` instead of being flattened unpredictably.

### Normalized output layer: `simple_<county>`

```json
{
  "upsertKey": {
    "county": "string",
    "category": "string",
    "anchor": "string"
  },
  "identity": {
    "caseNumber": "string|null",
    "spn": "string|null",
    "fullName": "string|null"
  },
  "classification": {
    "county": "string",
    "category": "string",
    "status": "string|null",
    "charge": "string|null"
  },
  "booking": {
    "legacyDate": "string|null",
    "datetime": "string|null",
    "date": "string|null",
    "derivationSource": "string|null",
    "timeBucketLegacy": "string|null",
    "timeBucket": "0_24h|24_48h|48_72h|3d_7d|7d_30d|30d_60d|60d_plus|null"
  },
  "bond": {
    "amount": "number|null",
    "label": "string|null",
    "raw": "string|null",
    "needsHelp": "boolean|null"
  },
  "demographics": {
    "race": "string|null",
    "sex": "string|null",
    "age": "number|null"
  },
  "phones": {
    "primary": "string|null",
    "secondary": "string|null",
    "tertiary": "string|null",
    "source": "string|null",
    "updatedAt": "string|null"
  },
  "metrics": {
    "ingestLagDays": "number|null",
    "ingestLagHours": "number|null"
  },
  "provenance": {
    "source": "string|null",
    "sourceUrl": "string|null",
    "sourceFilenameDate": "string|null",
    "scrapedAt": "string|null",
    "normalizedAt": "string|null"
  },
  "tags": ["string"]
}
```

## Recommended Normalization Changes

1. Standardize all stored normalized datetimes to BSON `Date` instead of mixed string/date conventions.
2. Treat `bond.amount`, `bond.label`, and `bond.raw` as the long-term contract and deprecate the root `bond` mixed field.
3. Finish migration from `booking_date` and `time_bucket` to `booking_date_v2` and `time_bucket_v2`.
4. Stop flattening county-specific raw payloads into arbitrary top-level raw collections where possible; prefer a common raw envelope.
5. Replace the opportunistic `last_person_id` attachment in generic event inserts with explicit scraper-side person linkage.