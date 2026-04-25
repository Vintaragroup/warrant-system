# Data Schema Audit

## Scope

This audit extracts the effective MongoDB schema used by the runtime code, not just the baseline Mongoose declarations.

Code paths reviewed:

- `shared/src/models.ts`
- `api/src/server.ts`
- `api/src/watcher.ts`
- `api/src/sweep.ts`
- `worker/src/index.ts`
- `worker/src/pipeline.ts`
- selected maintenance scripts under `tools/`

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the schema description below is grounded directly in code.

## Observations

- The primary collections are `inmates`, `enrichment_jobs`, `related_parties`, and `raw_provider_payloads`.
- `shared/src/models.ts` defines the baseline shape, but the effective schema is widened by dynamic writes in the worker and maintenance scripts.
- `inmates` is explicitly `strict: false`, so it is the highest-risk collection for schema drift.

## Reasoning

The authoritative schema here is the union of:

1. declared model fields in `shared/src/models.ts`
2. fields written by `subject.set(...)`, `updateOne(...)`, `create(...)`, and `save()` in the worker and API layers
3. extra write paths from repo maintenance scripts

## Collections

- `inmates`
- `enrichment_jobs`
- `related_parties`
- `raw_provider_payloads`

## Field Inventory

### `inmates`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `spn` | string | upstream source record; queried in API/worker | one of three subject identifiers |
| `subject_id` | string | upstream source record; queried in API/worker | legacy alias |
| `subjectId` | string | upstream source record; queried in API/worker | camelCase alias |
| `first_name` | string | upstream source; `tools/upsert_name_relations.js` | manually writable |
| `middle_name` | string | upstream source; `tools/upsert_name_relations.js` | manually writable |
| `last_name` | string | upstream source; `tools/upsert_name_relations.js` | manually writable |
| `age` | number | upstream source | declared in model |
| `dob` | mixed | upstream source; HCSO lookup; provider candidate | written in `worker/src/pipeline.ts` |
| `city` | string | upstream source; derived from address | written in worker and maintenance backfill |
| `state` | string | upstream source; derived from address | written in worker and maintenance backfill |
| `country` | string | derived constant | set to `US` when missing |
| `county` | string | upstream source | declared in model |
| `address` | mixed | upstream source | read by worker; not declared but used |
| `addr` | mixed | upstream source | legacy alias; read by worker |
| `zip` | string | upstream source | read during location derivation |
| `phones` | string[] | upstream source | fallback source for reverse-phone flow |
| `do_not_call` | boolean | upstream source or operator flag | read during phone enrichment |
| `bond_amount` | number | upstream source | used for eligibility gating |
| `bond` | mixed | upstream source | used as numeric fallback for eligibility gating |
| `enrichment_flag` | boolean | upstream source or operator workflow | used by sweep path |
| `enrichment_status` | enum string | API/worker | `NEW`, `READY`, `RUNNING`, `PARTIAL`, `FAILED`, `SUCCEEDED`, `CANCELLED` |
| `enrichment_last_run_at` | date | worker | set on completion or dob-only exit |
| `scraped_at` | date | upstream source | candidate timestamp |
| `_ingested_at` | date | upstream source | candidate timestamp |
| `fetched_at` | date | upstream source | candidate timestamp |
| `migrated_at` | date | upstream source | candidate timestamp |
| `first_seen_at` | date | upstream source | candidate timestamp |
| `inserted_at` | date | upstream source | candidate timestamp |
| `detail_fetched_at` | date | upstream source | candidate timestamp |
| `facts.phones` | string[] | chosen provider candidate, reverse phone, API ad hoc summaries | merged set |
| `facts.addresses` | string[] | chosen provider candidate, API ad hoc summaries | flattened strings |
| `facts.emails` | string[] | chosen provider candidate, API ad hoc summaries | merged set |
| `facts.usernames` | string[] | chosen provider candidate | merged set |
| `facts.user_ids` | string[] | chosen provider candidate | merged set |
| `hcso_status.notInJail` | boolean | HCSO provider | worker write |
| `hcso_status.asOf` | string | HCSO provider | worker write |
| `hcso_status.message` | string | HCSO provider | worker write |
| `hcso_status.source` | string | worker constant | usually `hcso` |
| `hcso_status.notBondable` | boolean | HCSO provider | worker write |
| `hcso_status.bondExceptionText` | string | HCSO provider | worker write |
| `hcso_status.moreChargesPossible` | boolean | HCSO provider | worker write |
| `pdl.asOf` | string | worker | chosen candidate projection |
| `pdl.matchScore` | number | worker candidate scoring | chosen candidate projection |
| `pdl.phones` | array | provider candidate | raw candidate subarray |
| `pdl.emails` | array | provider candidate | raw candidate subarray |
| `pdl.addresses` | array | provider candidate | raw candidate subarray |
| `pdl.usernames` | array | provider candidate | raw candidate subarray |
| `pdl.user_ids` | array | provider candidate | raw candidate subarray |
| `pipl.asOf` | string | API pipl summary path | ad hoc summary projection |
| `pipl.matchScore` | number | API pipl summary path | ad hoc summary projection |
| `pipl.phones` | array | API pipl summary path | ad hoc summary projection |
| `pipl.emails` | array | API pipl summary path | ad hoc summary projection |
| `pipl.addresses` | array | API pipl summary path | ad hoc summary projection |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `enrichment_jobs`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `jobId` | string | BullMQ job id | unique index |
| `subjectId` | string | API/watcher/sweep enqueue payload | canonical per job doc |
| `status` | enum string | API, worker, cancel route | `NEW`, `READY`, `RUNNING`, `PARTIAL`, `FAILED`, `SUCCEEDED`, `CANCELLED` |
| `steps[].name` | string | worker step tracker | fixed step names plus maintenance detail |
| `steps[].status` | enum string | worker step tracker | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `UNRESOLVED` |
| `steps[].startedAt` | date | worker step tracker | optional |
| `steps[].finishedAt` | date | worker step tracker | optional |
| `steps[].info` | mixed | worker step tracker | freeform payload |
| `progress` | number | API and worker | usually `0` then `100` |
| `logs` | string[] | worker | appends `Pipeline complete` |
| `errors` | string[] | worker | appends thrown errors |
| `idempotencyKey` | string | API and worker | currently `${subjectId}_v1` or `${subjectId}:v1` |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `related_parties`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `subjectId` | string | worker or maintenance scripts | target inmate identifier |
| `partyId` | string | `buildPartyId(...)` | deterministic hash/id |
| `name` | string | provider relationship names, username, manual scripts | durable display name |
| `relationType` | enum string | worker heuristics or scripts | `family`, `household`, `associate`, `unknown` |
| `relationLabel` | string | provider relation label | optional human-readable label |
| `confidence` | number | worker scoring or scripts | heuristic confidence |
| `evidence[]` | object[] | declared schema only | no active writes found in main pipeline |
| `evidence[].type` | string | potential future/provider evidence | declared only |
| `evidence[].value` | string | potential future/provider evidence | declared only |
| `evidence[].weight` | number | potential future/provider evidence | declared only |
| `evidence[].provider` | string | potential future/provider evidence | declared only |
| `contacts.phones` | string[] | worker and maintenance scripts | `$addToSet` |
| `contacts.emails` | string[] | maintenance scripts and API pipl relation pull | `$addToSet` |
| `addresses` | string[] | maintenance scripts and API pipl relation pull | `$addToSet` |
| `sources` | string[] | worker and scripts | provider provenance |
| `audits[]` | object[] | declared schema only in core pipeline | no main writes confirmed |
| `audits[].at` | date | declared schema | default only |
| `audits[].step` | string | declared schema | default only |
| `audits[].provider` | string | declared schema | default only |
| `audits[].personsCount` | number | declared schema | default only |
| `audits[].match` | number | declared schema | default only |
| `audits[].accepted` | boolean | declared schema | default only |
| `audits[].acceptance` | string | declared schema | default only |
| `audits[].matchMin` | number | declared schema | default only |
| `audits[].requireUnique` | boolean | declared schema | default only |
| `audits[].lastNameAgrees` | boolean | declared schema | default only |
| `audits[].queriedName` | string | declared schema | default only |
| `audits[].city` | string | declared schema | default only |
| `audits[].state` | string | declared schema | default only |
| `audits[].gainedData` | boolean | declared schema | default only |
| `audits[].netNewPhones` | number | declared schema | default only |
| `audits[].netNewEmails` | number | declared schema | default only |
| `audits[].netNewAddresses` | number | declared schema | default only |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

### `raw_provider_payloads`

| Field | Inferred Type | Source | Notes |
|---|---|---|---|
| `jobId` | string | worker and API ad hoc provider routes | optional for ad hoc entries |
| `subjectId` | string | worker, API ad hoc provider routes | optional on some maintenance writes |
| `provider` | string | worker/API/scripts | `hcso`, `pipl`, `pdl`, `whitepages`, `openai` |
| `step` | string | worker/API/scripts | e.g. `hcso_dob`, `reverse_phone`, `pipl_ad_hoc` |
| `payload` | mixed | provider response/request summary | intentionally flexible |
| `ttlExpiresAt` | date | writer code | TTL expiry timestamp |
| `createdAt` | date | Mongoose timestamps | implicit |
| `updatedAt` | date | Mongoose timestamps | implicit |

## Naming And Structure Inconsistencies

| Issue | Severity | Details |
|---|---|---|
| `spn` vs `subject_id` vs `subjectId` | high | the same identity is stored under three names across the same collection |
| `address` vs `addr` | high | duplicate address aliases with no canonical winner |
| `dob` typed as mixed | medium | written from multiple providers with no enforced representation |
| `bond_amount` vs `bond` | medium | eligibility checks treat both as possible numeric sources |
| `pdl` and `pipl` payload subdocs use overlapping but non-identical shapes | medium | provider summaries are not normalized to one contract |
| `facts.addresses` stores strings while `pdl.addresses` stores raw arrays | medium | canonical address structure is inconsistent |
| `idempotencyKey` format differs (`_v1` vs `:v1`) | low | two string conventions for the same concept |
| duplicate local model files under `api/src/models/*` | low | schema declarations can drift from active shared models |

## Canonical Schema Proposal

### `subjects`

Use a single canonical subject collection contract even if the physical collection remains `inmates`.

```json
{
  "subjectId": "string",
  "identifiers": {
    "spn": "string|null",
    "legacySubjectId": "string|null"
  },
  "name": {
    "first": "string|null",
    "middle": "string|null",
    "last": "string|null"
  },
  "demographics": {
    "dob": "string|null",
    "age": "number|null"
  },
  "location": {
    "addressLine": "string|null",
    "city": "string|null",
    "state": "string|null",
    "postalCode": "string|null",
    "country": "string|null",
    "county": "string|null"
  },
  "booking": {
    "bondAmount": "number|null",
    "bondLabel": "string|null"
  },
  "enrichment": {
    "flag": "boolean",
    "status": "NEW|READY|RUNNING|PARTIAL|FAILED|SUCCEEDED|CANCELLED",
    "lastRunAt": "date|null"
  },
  "providerStatus": {
    "hcso": {
      "notInJail": "boolean|null",
      "asOf": "string|null",
      "message": "string|null",
      "notBondable": "boolean|null",
      "bondExceptionText": "string|null",
      "moreChargesPossible": "boolean|null"
    }
  },
  "providerProfiles": {
    "pipl": {
      "asOf": "string|null",
      "matchScore": "number|null",
      "phones": ["string"],
      "emails": ["string"],
      "addresses": ["string"],
      "usernames": ["string"],
      "userIds": ["string"]
    },
    "pdl": {
      "asOf": "string|null",
      "matchScore": "number|null",
      "phones": ["string"],
      "emails": ["string"],
      "addresses": ["string"],
      "usernames": ["string"],
      "userIds": ["string"]
    }
  },
  "facts": {
    "phones": ["string"],
    "emails": ["string"],
    "addresses": ["string"],
    "usernames": ["string"],
    "userIds": ["string"]
  },
  "sourceTimestamps": {
    "scrapedAt": "date|null",
    "ingestedAt": "date|null",
    "fetchedAt": "date|null",
    "migratedAt": "date|null",
    "firstSeenAt": "date|null",
    "insertedAt": "date|null",
    "detailFetchedAt": "date|null"
  },
  "createdAt": "date",
  "updatedAt": "date"
}
```

### `enrichment_jobs`

Keep this collection, but normalize `idempotencyKey` to one format and keep `steps[].info` provider-specific rather than top-level.

### `related_parties`

Keep `subjectId`, `partyId`, `relationType`, `confidence`, `sources`, and `contacts` as the core schema. Move any ad hoc audit details into a consistently written `audits[]` contract or remove the field from the baseline until it is actively used.

### `raw_provider_payloads`

Keep this collection intentionally flexible, but require the tuple:

- `subjectId`
- `jobId`
- `provider`
- `step`
- `payload`
- `ttlExpiresAt`

for all writes except clearly documented global diagnostics.

## Recommended Normalization Changes

1. Pick `subjectId` as the only canonical subject key in new code and relegate `spn` and `subject_id` to `identifiers`.
2. Replace `address` and `addr` with one canonical `location.addressLine` or structured address object.
3. Normalize `dob` to one string format, ideally `YYYY-MM-DD`.
4. Normalize provider summary documents so `pipl` and `pdl` share the same field names and array element types.
5. Stop storing raw provider address objects under provider profiles if downstream facts are string-normalized.
6. Standardize `idempotencyKey` generation to one convention.