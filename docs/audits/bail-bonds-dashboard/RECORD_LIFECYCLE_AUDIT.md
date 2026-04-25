# Record Lifecycle Audit

## Scope

This audit traces one dashboard case record from its source collection through API transformation and any durable write-back paths.

Code paths used:

- `server/src/index.js`
- `server/src/routes/dashboard.js`
- `server/src/routes/cases.js`
- `server/src/models/Case.js`

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the lifecycle description below is grounded directly in runtime code.

## Observations

- The dashboard is not the primary scraper or canonical normalizer for county records.
- The main read path starts from Mongo `simple_*` collections such as `simple_harris`, `simple_galveston`, and the other county collections.
- Most dashboard transformations happen on read inside aggregation pipelines rather than by rewriting the source row.
- Durable mutation exists mainly in CRM and case-management paths that write to the application-side `Case` model and related collections.

## Reasoning

The controlling path for a single dashboard-visible record is not a background job or ETL pipeline inside this repo. It is a read/reshape layer over already-normalized county collections, with optional operator-driven write-backs in case-management routes. That means the lifecycle must be split into two phases: projection-on-read and explicit CRM mutation.

## Step-By-Step Pipeline

### 1. Initial data input source

The dashboard reads county records directly from Mongo collections:

- `simple_brazoria`
- `simple_fortbend`
- `simple_galveston`
- `simple_harris`
- `simple_jefferson`

These collections are treated as the initial input layer for dashboard reporting and browsing.

### 2. API entry into dashboard aggregation paths

`server/src/index.js` mounts the primary business routes:

- `/api/dashboard/*`
- `/api/cases/*`

The dashboard route layer does not first materialize records into an internal table. Instead, it queries the county `simple_*` collections directly via Mongoose's underlying Mongo connection.

### 3. Union across county collections

`server/src/routes/dashboard.js` defines a union strategy using:

- `COUNTY_COLLECTIONS`
- `BASE_COLLECTION = simple_brazoria`
- `unionAll(...)`
- `unionAllFast(...)`
- `unionBucketsFast(...)`

One record enters the visible dashboard stream by being selected from its source county collection, then combined into a cross-county aggregation through `$unionWith`.

### 4. Normalize-on-read field transformation

Before returning the record to a caller, the dashboard applies a set of computed transformations.

#### Booking date normalization

The route derives `booking_date_n` from several candidate fields in order:

- `booking_date`
- `booked_at`
- `booking_date_iso`
- `normalized_at`
- `scraped_at`

Then it aliases:

- `booking_date = booking_date_n`

#### Bond normalization

The route computes `bond_amount_n` using:

1. `bond_amount` if already numeric
2. numeric `bond`
3. numeric-looking `bond` strings
4. `null` for text such as `REFER TO MAGISTRATE`

Then it aliases:

- `bond_amount = bond_amount_n`

#### Derived bond metadata

The route derives:

- `bond_raw`
- `bond_status`
- `bond_sort_value`

These values are presentation and filtering helpers computed inside the read pipeline.

#### Date-time normalization

The route computes:

- `scraped_at_dt`
- `normalized_at_dt`
- `booking_dt`

`booking_dt` prioritizes the normalized booking day over legacy timestamp variants so recent-window classification matches dashboard expectations.

#### County canonicalization

The route lowercases and trims `county`, with a fallback derived from collection name if the field is absent.

#### Global filter mutation on the visible stream

The union pipeline excludes Harris civil rows globally:

- `{ county: 'harris', category: 'Civil' }`

That means some raw records exist in source collections but are intentionally removed from dashboard visibility.

### 5. Projection into dashboard responses

Once transformed, the record is projected through shared field sets like `P` in `server/src/routes/dashboard.js`.

Fields commonly exposed include:

- `_id`
- `county`
- `category`
- `full_name`
- `booking_date`
- `normalized_at`
- `bond_amount`
- `bond_raw`
- `bond_status`
- `bond_sort_value`
- `charge`
- `booking_number`
- `case_number`
- `spn`
- `agency`
- `facility`
- `race`
- `sex`
- `scraped_at`
- `time_bucket`
- `scraped_at_dt`
- `booking_dt`
- `normalized_at_dt`

### 6. Case-management overlay and CRM mutation path

`server/src/routes/cases.js` introduces the durable application-side mutation layer.

The `Case` schema in `server/src/models/Case.js` supports writeable CRM fields such as:

- `crm_stage`
- `crm_stage_history`
- `crm_details.qualificationNotes`
- `crm_details.documents`
- `crm_details.followUpAt`
- `crm_details.assignedTo`
- `crm_details.address`
- `crm_details.phone`
- `crm_details.attachments`
- `crm_details.acceptance.*`
- `crm_details.denial.*`
- `manual_tags`

The route helpers normalize operator-provided data before persistence.

#### Checklist normalization

`normalizeChecklist(...)` merges supplied checklist entries with the repo's required CRM checklist defaults.

#### Attachment normalization

`normalizeAttachments(...)` merges incoming attachment payloads with previous attachment state, carrying forward earlier metadata when the new payload is partial.

### 7. Enrichment request parameter shaping

The cases route can build enrichment parameters from a combination of:

- `caseDoc.full_name`
- operator overrides
- `crm_details.address`
- `crm_details.phone`

`buildEnrichmentParams(...)` splits names and produces a provider request shape containing:

- `fullName`
- `firstName`
- `lastName`
- `city`
- `stateCode`
- `postalCode`
- `addressLine1`
- `addressLine2`
- `phone`

This is a downstream transformation layer for enrichment requests, not the original source-of-truth case row.

## Field-Level Transformation Map

### Source fields consumed from `simple_*`

- `booking_date`
- `booked_at`
- `booking_date_iso`
- `normalized_at`
- `scraped_at`
- `bond_amount`
- `bond`
- `bond_label`
- `county`
- `category`
- `full_name`
- `charge`
- `booking_number`
- `case_number`
- `spn`
- `agency`
- `facility`
- `race`
- `sex`
- `time_bucket`

### Read-time computed fields

- `booking_date_n`: normalized day string from multiple possible source timestamps
- `booking_date`: aliased from `booking_date_n`
- `bond_amount_n`: numeric bond derived from mixed source fields
- `bond_amount`: aliased from `bond_amount_n`
- `bond_raw`: string preservation of original bond text/value
- `bond_status`: classification such as `numeric`, `refer_to_magistrate`, `summons`, `unsecured`, `unknown_text`
- `bond_sort_value`: ranking helper for UI sorts
- `scraped_at_dt`: parsed timestamp form of `scraped_at`
- `normalized_at_dt`: parsed timestamp form of `normalized_at`
- `booking_dt`: canonical sortable booking datetime
- `county`: lowercased and trimmed, with collection-name fallback

### Durable CRM fields on the application-side `Case` model

- `crm_stage`
- `crm_stage_history`
- `crm_details.documents`
- `crm_details.attachments`
- `crm_details.followUpAt`
- `crm_details.assignedTo`
- `crm_details.address`
- `crm_details.phone`
- `crm_details.acceptance.*`
- `crm_details.denial.*`
- `manual_tags`

### Enrichment request shaping fields

These are derived for outbound provider requests:

- `firstName`
- `lastName`
- `fullName`
- `city`
- `stateCode`
- `postalCode`
- `addressLine1`
- `addressLine2`
- `phone`

## Data Loss And Mutation Risks

### 1. Read-time normalization can mask original source ambiguity

The dashboard chooses a single `booking_date_n` and `bond_amount_n` from multiple possible raw fields. That is useful operationally, but it means consumers may only see the normalized projection and not realize which underlying source field actually won.

### 2. Harris civil records are intentionally suppressed

The union layer removes Harris civil rows globally. This is a deliberate business rule, but from a lifecycle perspective it is data loss at the dashboard visibility layer because existing source records are omitted before consumers ever see them.

### 3. Bond text can be collapsed into a classification

The route keeps `bond_raw`, but most higher-level logic will use `bond_amount`, `bond_status`, and `bond_sort_value`. If downstream consumers ignore `bond_raw`, semantically rich text values can become flattened into a small status vocabulary.

### 4. Collection-name fallback can rewrite county identity on read

If a row lacks a reliable `county`, the pipeline falls back to the collection name. That improves consistency, but it can hide upstream data quality issues and makes the dashboard's `county` field partly inferred rather than purely source-authored.

### 5. CRM overlay can diverge from raw county data

The `Case` model introduces operator-managed fields such as assignment, notes, attachments, address, and phone. Those are valuable, but they create a dual-state model: the raw county source row and the application's CRM overlay are not the same record anymore.

### 6. Attachment normalization favors merge-over-replace semantics

`normalizeAttachments(...)` carries forward earlier metadata when the new payload is partial. That avoids accidental erasure, but it also means stale attachment properties can persist if callers assume omitted fields will be cleared.

## Bottom Line

In this repo, a single case record primarily moves through a projection pipeline rather than a classic ingestion pipeline. The source row begins in `simple_*`, is normalized on read into a dashboard-facing shape, and may then accumulate CRM-side state in the application's `Case` model and related collections. The biggest lifecycle risks are projection hiding source ambiguity, intentional record suppression rules, and drift between raw county records and CRM overlays.