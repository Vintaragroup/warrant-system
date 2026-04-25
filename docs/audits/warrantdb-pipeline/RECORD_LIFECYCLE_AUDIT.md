# Record Lifecycle Audit

## Scope

This audit traces one county record through the pipeline repository from source scraping through Mongo writes and normalization into `simple_*` collections.

Code paths used:

- `scripts/run_pipeline.py`
- `scripts/run_ingestion.py`
- `ingestion/base_scraper.py`
- `ingestion/brazoria_jail.py`
- `ingestion/brazoria_ingest.py`
- `normalize_to_simple.py`
- `storage/mongo_client.py`
- `storage/schemas.py`

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the lifecycle description below is grounded directly in runtime code.

## Observations

- The repo is the true ingestion and normalization layer for county records.
- A single pipeline run is orchestrated as `ingest -> normalize -> report`.
- Raw writes land first in Mongo collections through scraper-specific logic.
- The normalizer then reads raw documents, applies county mapping rules, post-processes the normalized result, and upserts into `simple_<county>`.

## Reasoning

The controlling lifecycle starts in `scripts/run_pipeline.py`, but the decisive record mutations happen in `scripts/run_ingestion.py`, `ingestion/base_scraper.py`, and `normalize_to_simple.py`. That is where the raw document identity, upsert keys, normalization rules, and post-mapping cleanup determine the final record shape consumed by downstream systems.

## Step-By-Step Pipeline

### 1. Initial source trigger

The top-level orchestrator in `scripts/run_pipeline.py` executes three stages by default:

1. ingestion
2. normalization
3. reporting

For one record, the ingestion stage begins by running:

- `python -m scripts.run_ingestion --source <source>`

### 2. Source-specific scraper selection

`scripts/run_ingestion.py` maps the source name to a concrete scraper class in `SCRAPER_SPECS`, for example:

- `harris_inmate`
- `galveston_p2c_fast`
- `brazoria_jail`
- `fortbend_jail`
- `jefferson_jail`
- `harris_email_roster`

The script opens Mongo with `storage.mongo_client.get_db()`, instantiates the scraper, and executes one of two paths:

- `fetch()` iterator path
- `run()` path for self-managed scrapers

### 3. Raw record ingestion and primary Mongo write

For scrapers exposing `fetch()`, each yielded document is examined for `_collection`.

#### If `_collection == 'persons'`

The record is sent through `BaseScraper.upsert_person(doc)`.

Upsert key precedence:

1. `_ext_id`
2. `identifiers.booking[0]`
3. `(full_name, dob)`

Mongo write behavior:

- collection: `persons`
- operation: `update_one(..., upsert=True)`
- write shape: `{"$set": doc, "$currentDate": {"updated_at": True}}`

This means the raw person record is either inserted or overwritten by field replacement under `$set`.

#### If `_collection != 'persons'`

The record is inserted directly into the named collection.

If `person_id` is missing and a person row was just written, the script injects `person_id = last_person_id` before insert.

### 4. Scraper-specific raw mutation before write

Some scrapers perform significant mutation before the raw Mongo write.

For Brazoria, `ingestion/brazoria_jail.py` and `ingestion/brazoria_ingest.py` show the pattern clearly:

- search results are scraped from the source system
- detail pages may be fetched and merged into the row
- booking age categories are derived
- `_upserts(...)` persists the rows into Mongo

So one record is often already a merged product of list-page data, detail-page data, and scraper-side categorization before normalization starts.

### 5. Normalization stage reads raw records in batches

`normalize_to_simple.py` opens the raw collection and iterates documents with `iter_raw(...)` in ascending `_id` order.

The normalizer loads a county mapping file and applies the mapping engine to each raw document. The intended output collection name becomes:

- `simple_<county>`

### 6. Mapping and normalized document construction

For each raw record, the normalizer produces a normalized document using county-specific mapping rules.

Although the exact field map depends on the county YAML, the runtime shape is subsequently expected to include values such as:

- `full_name`
- `booking_date`
- `bond`
- `bond_amount`
- `bond_label`
- `case_number`
- `charge`
- `status`
- `county`
- `_upsert_key`

### 7. Upsert-key construction for normalized records

`build_upsert_key_or_none(...)` constructs the normalized record identity from mapping-defined primary key fields.

If `anchor` is missing, the normalizer synthesizes a fallback anchor as:

- `full_name||booking_date`

If required key fields are still missing, the record is skipped.

### 8. Post-process mutation before simple upsert

`postprocess_simple_doc(...)` applies several repo-wide mutations after mapping.

#### Anchor normalization

`_normalize_anchor_with_case_number(...)` can replace the `_upsert_key.anchor` value with a numeric prefix derived from `case_number`, especially for counties like Harris.

#### Bond field normalization

`_normalize_bond_fields(...)` reconciles:

- `bond`
- `bond_amount`
- `bond_label`

Rules include:

- numeric `bond` backfills `bond_amount`
- textual `bond` values like `REFER TO MAGISTRATE` become `bond_label`
- `bond_amount` is set to `None` for recognized textual-bond cases when absent
- missing `bond_label` is forced to an empty string

#### Legacy time bucket recomputation

`_ensure_time_bucket(...)` recomputes `time_bucket` strictly from `booking_date` and removes it if `booking_date` is missing.

#### Ingest lag derivation

If `booking_date` and `normalized_at` are available, the normalizer computes:

- `ingest_lag_days`
- `ingest_lag_hours`

#### Booking datetime derivation

`_maybe_derive_booking_datetime(...)` derives new fields when absent:

- `booking_datetime`
- `booking_derivation_source`
- `booking_date_v2`

Source precedence:

1. `first_seen_at`
2. `updated_at`
3. legacy `booking_date`

#### Time bucket v2 derivation

The same post-process flow computes `time_bucket_v2` from `booking_datetime` using newer bucket rules.

### 9. Final normalized write into `simple_<county>`

After mapping and post-processing, the normalizer upserts the document into the county's `simple_*` collection using the normalized key.

This is the durable record later consumed by the dashboard repository.

### 10. Reporting stage

After normalization, `scripts/run_pipeline.py` runs the reporting step. That stage summarizes simple-collection deltas rather than changing the record lifecycle described above.

## Field-Level Transformation Map

### Raw scraper-side fields commonly produced

- source identity fields such as `_ext_id`
- `full_name`
- `dob`
- `identifiers.booking`
- source detail payload merged into row fields
- collection hint `_collection`
- scraper timestamps and source URLs

### Raw write-time mutations

- `updated_at` is always current-dated on `persons` upsert
- `person_id` may be injected into non-person event documents when absent
- detail-page fields may be merged into a list-page row before persistence

### Normalized fields constructed or reconciled

- `_upsert_key.*`
- `anchor`
- `full_name`
- `booking_date`
- `case_number`
- `bond`
- `bond_amount`
- `bond_label`
- `charge`
- `status`
- `county`
- `tags`

### Post-process derived fields

- `time_bucket`
- `ingest_lag_days`
- `ingest_lag_hours`
- `booking_datetime`
- `booking_derivation_source`
- `booking_date_v2`
- `time_bucket_v2`

## Data Loss And Mutation Risks

### 1. Raw person upserts are replacement-style at field level

`BaseScraper.upsert_person(...)` uses `$set: doc`. If a new scraper run omits a field that had been present on an earlier version of the record and that field is not explicitly preserved elsewhere, the latest write can effectively narrow the stored shape.

### 2. Upsert identity can drift when fallback keys are used

When `_ext_id` and booking identifiers are missing, the raw person upsert falls back to `(full_name, dob)`. That is convenient but collision-prone for common names or incomplete DOB data.

### 3. Normalized anchor can change after mapping

`_normalize_anchor_with_case_number(...)` may rewrite `_upsert_key.anchor` from a mapped value to a numeric prefix of `case_number`. That improves consistency, but it changes record identity after the initial mapping stage and can affect deduplication behavior.

### 4. Textual bond semantics are compressed into label rules

`_normalize_bond_fields(...)` converts certain string `bond` values into `bond_label` and may set `bond_amount = None`. This is intentional, but downstream consumers that only inspect `bond_amount` will lose some of the original textual nuance.

### 5. Legacy `time_bucket` is recomputed and may be removed

The normalizer ignores any prior bucket meaning and recomputes `time_bucket` strictly from `booking_date`. If `booking_date` is missing, the field is deleted. That removes stale values, but it also discards upstream bucket classifications.

### 6. Derived booking datetime may be based on fallback timestamps

`booking_datetime` is derived from `first_seen_at`, then `updated_at`, then legacy `booking_date`. For records without a true booking timestamp, the system can end up classifying recency using operational timestamps rather than a source-authored booking event.

### 7. Records can be skipped entirely if normalized keys are incomplete

If the normalizer cannot build a valid `_upsert_key`, the record is skipped. That protects collection integrity, but it is a hard loss path for otherwise partially useful records.

## Bottom Line

This repo owns the real ingestion lifecycle. A single record starts in a county scraper, is written into raw Mongo collections, then is normalized and post-processed into `simple_<county>` for downstream consumption. The major risks are identity fallback collisions, post-mapping key rewrites, bond-semantic flattening, and recency fields derived from fallback timestamps rather than true booking events.