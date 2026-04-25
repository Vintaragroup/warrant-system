# Record Lifecycle Audit

## Scope

This audit traces one inmate record from initial input through enrichment processing, MongoDB writes, field mutation, and downstream related-party/provider persistence.

Code paths used:

- `api/src/server.ts`
- `api/src/watcher.ts`
- `api/src/sweep.ts`
- `worker/src/index.ts`
- `worker/src/pipeline.ts`
- `shared/src/models.ts`
- `shared/src/config.ts`

No `.giga/rules` markdown files were discoverable in this repository during this audit, so the lifecycle description below is grounded directly in runtime code.

## Observations

- A record can enter enrichment three ways: manual API request, Mongo insert change stream, or scheduled sweep.
- The API and automation layers do not enrich inline; they create a BullMQ job and a companion `enrichment_jobs` Mongo document.
- The worker performs the actual field mutation on the inmate record.
- Raw provider payloads are stored separately with TTL expiry.
- Related-party records are written both on successful candidate selection and on some low-confidence failure paths.

## Reasoning

The controlling lifecycle is not in the API routes beyond job creation. The decisive logic lives in `worker/src/pipeline.ts`, where the inmate document, payload archive, and related-party outputs are mutated. That makes the worker pipeline the correct source of truth for field-level transformation analysis.

## Step-By-Step Pipeline

### 1. Initial data input and record selection

An inmate record already exists in the `inmates` collection before enrichment starts. The record is selected for enrichment through one of these paths:

1. Manual enqueue via `POST /api/enrichment/run` in `api/src/server.ts`.
2. Automatic enqueue on Mongo insert in `api/src/watcher.ts`.
3. Scheduled enqueue from `api/src/sweep.ts` for records marked with `enrichment_flag: true` and status in `NEW`, `READY`, or `FAILED`.

Each path resolves a subject key from `spn`, `subject_id`, or `subjectId`, then applies gate checks:

- ingestion timestamp must be within `ENRICHMENT_WINDOW_HOURS`
- bond must meet `BOND_THRESHOLD`
- no recent successful job within the idempotency window
- no active `NEW`, `READY`, or `RUNNING` job already present

### 2. Queue handoff and job document creation

If the record passes those gates, the API or automation layer enqueues a BullMQ job on queue `enrichment` with payload:

- `subjectId`
- `mode`
- optional `runOpts` overrides

At the same time, the system upserts or creates an `enrichment_jobs` document with:

- `jobId`
- `subjectId`
- initial `status`
- empty `steps`, `logs`, and `errors`
- `idempotencyKey`

### 3. Worker bootstrap and status mutation

`worker/src/index.ts` consumes the queued job, then upserts the matching `enrichment_jobs` record to `RUNNING` before calling `runPipeline(...)`.

After the pipeline returns:

- job status becomes `SUCCEEDED` or `PARTIAL`
- progress is set to `100`
- `Pipeline complete` is appended to logs
- the inmate record is updated again with `enrichment_status` and `enrichment_last_run_at`

If the pipeline throws, the job document is marked `FAILED` and the error string is appended.

### 4. Pre-provider field backfill on the inmate record

Inside `worker/src/pipeline.ts`, the worker first loads the inmate document and mutates location fields if missing.

Source fields examined:

- `address`
- `addr`
- existing `city`
- existing `state`
- existing `zip`

Derived fields written back to the inmate document:

- `city`
- `state`
- `country = 'US'`

This mutation is persisted immediately with `subject.save()`.

### 5. HCSO DOB lookup and jail-status mutation

If `dob` is missing and HCSO scraping is enabled, the pipeline calls `lookupDobBySpn(spn)`.

Side effects:

1. A raw HCSO payload is inserted into `raw_provider_payloads` with `provider = 'hcso'`, `step = 'hcso_dob'`, and TTL.
2. If HCSO indicates the subject is not in jail, the inmate record gets `hcso_status` fields such as:
   - `notInJail`
   - `asOf`
   - `message`
   - `source`
   - `notBondable`
   - `bondExceptionText`
   - `moreChargesPossible`
3. If HCSO returns a DOB, the inmate record gets `dob`.
4. The job step state is updated to `SUCCEEDED`, `SKIPPED`, or `UNRESOLVED`.

Each of those writes can happen in separate `subject.save()` calls.

### 6. Provider candidate search

Next, the worker attempts provider search.

Provider choice:

- prefer Pipl if enabled and the inmate has DOB, is within the allowed window, and meets bond threshold
- otherwise use PDL under the same gating conditions
- otherwise skip provider search

This step updates job metadata but does not directly mutate the inmate yet.

### 7. Candidate scoring and chosen match selection

The worker scores candidates from `pdl?.data?.matches` using:

- provider match score `@match`
- DOB agreement with the inmate record
- street agreement with inmate `address` or `addr`
- ZIP agreement

If no candidate reaches `0.7`, the worker marks the match as failed and enters a relationship-lift path.

If a candidate is chosen, the worker writes a `pdl` subdocument onto the inmate record containing:

- `asOf`
- `matchScore`
- `phones`
- `emails`
- `addresses`
- `usernames`
- `user_ids`

If the inmate still lacks `dob`, the chosen candidate DOB is also written back.

### 8. Low-confidence relationship lift on failed match

When candidate selection fails, the worker still inspects top provider relationships and may upsert `related_parties` rows.

Fields written on related-party upsert:

- `subjectId`
- `partyId`
- `name`
- `relationType`
- `confidence`
- `sources`

It also writes a `relationships_lifted` raw payload summary into `raw_provider_payloads` if names were lifted.

### 9. Reverse address, reverse phone, Whitepages, and social scan

Once a candidate exists, the worker performs more downstream enrichment.

Reverse address:

- takes up to three candidate addresses
- writes raw result into `raw_provider_payloads` with `provider = 'pdl'` and `step = 'reverse_address'`

Reverse phone:

- uses up to five chosen-candidate phones unless `do_not_call` is true
- if candidate phones are absent, falls back to normalized inmate `phones`
- writes raw result into `raw_provider_payloads` with `provider = 'pdl'` and `step = 'reverse_phone'`

Whitepages:

- executes on phone list if enabled
- writes raw result into `raw_provider_payloads` with `provider = 'whitepages'` and `step = 'whitepages'`

Social scan:

- runs against chosen candidate and inmate context if enabled
- writes raw result into `raw_provider_payloads` with `provider = 'openai'` and `step = 'social_scan'`

### 10. Final fact consolidation on the inmate record

The `rank_store` step consolidates data into the inmate document's `facts` subdocument.

Fields merged into `facts`:

- `phones`
- `emails`
- `addresses`
- `usernames`
- `user_ids`

The pipeline then sets:

- `enrichment_status = PARTIAL | SUCCEEDED`
- `enrichment_last_run_at = now`

and saves the inmate record again.

### 11. Final related-party upsert from selected candidate

If the chosen candidate has a username, the worker creates or updates one `related_parties` document using that username as the party name.

Fields updated:

- `name`
- `relationType`
- `confidence`
- `sources += ['pdl', 'openai']`
- `contacts.phones += phones`

## Field-Level Transformation Map

### Source inmate fields consumed

- identity: `spn`, `subject_id`, `subjectId`
- name data from the base inmate record passed into provider clients
- booking and ingestion timestamps used for enrichment eligibility
- bond fields: `bond_amount`, `bond`
- address fields: `address`, `addr`, `city`, `state`, `zip`
- contact fallback: `phones`
- policy flags: `do_not_call`

### Inmate fields mutated

- `city`: derived from `address` or `addr` when absent
- `state`: derived from `address` or `addr` when absent
- `country`: forced to `US` when absent
- `hcso_status.*`: jail-state and bond-exception summary from HCSO
- `dob`: from HCSO first, or chosen provider candidate if still missing
- `pdl`: overwritten with chosen-candidate projection
- `facts.phones`: merged unique phone list
- `facts.emails`: merged unique email list
- `facts.addresses`: merged address list flattened to `street` or raw object/string
- `facts.usernames`: merged unique username list
- `facts.user_ids`: merged unique user ID list
- `enrichment_status`: `PARTIAL` or `SUCCEEDED`
- `enrichment_last_run_at`: timestamp of pipeline completion

### Enrichment job fields mutated

- `status`
- `steps[].status`
- `steps[].startedAt`
- `steps[].finishedAt`
- `steps[].info`
- `progress`
- `logs`
- `errors`

### Raw provider payload writes

Inserted into `raw_provider_payloads`:

- HCSO DOB response
- reverse address response
- reverse phone response
- Whitepages response
- OpenAI social scan response
- relationship-lift summary on failed candidate selection

All raw payload rows are time-limited with `ttlExpiresAt`.

### Related-party writes

Inserted or updated in `related_parties`:

- provider-lifted relationship names when candidate selection fails
- username-derived associate record when candidate selection succeeds

## Data Loss And Mutation Risks

### 1. Partial-state writes across multiple saves

`worker/src/pipeline.ts` performs multiple sequential `subject.save()` operations. If a later step fails, the inmate document can retain location backfill, HCSO status, or DOB updates while the overall job ends `PARTIAL` or `FAILED`. This is operationally useful, but it means a single run is not atomic.

### 2. `hcso_status` can be overwritten inconsistently

The pipeline first writes a full `hcso_status` object when `notInJail` is returned, then later writes a merged object for bond exceptions and charge hints. Because the merge is shallow and staged, nested consistency depends on write order rather than a single canonical reducer.

### 3. `subject.pdl` is replaced, not merged

When a candidate is chosen, the code does `subject.set('pdl', pdlMap)`. Any pre-existing fields inside `pdl` that are not rebuilt into `pdlMap` are discarded on that run.

### 4. Address structure is flattened in `facts.addresses`

`facts.addresses` stores `addresses.map((a) => a?.street || a)`. That can collapse a structured address object down to only its street field, losing city, state, ZIP, and any provider metadata unless those values survive in the raw object fallback.

### 5. Candidate choice is heuristic and not durably audited as a full decision record

The selected candidate depends on boosted score calculations using DOB, street, and ZIP agreement. The final `matchScore` is saved, but the per-candidate scoring rationale is not persisted in detail, which limits later review of why one person was selected over another.

### 6. Raw traceability expires by TTL

`raw_provider_payloads` is indexed with TTL on `ttlExpiresAt`. That reduces storage cost, but it means the system's best forensic trail for provider inputs and outputs disappears after the configured retention window.

### 7. Failed-candidate paths can still materialize related parties

Even when the system cannot choose a high-confidence candidate, it may still upsert `related_parties` from provider relationships. That creates a path where low-confidence data becomes durable relationship state.

### 8. Duplicate model definitions increase schema drift risk

There are older API-local model files under `api/src/models/*`, while runtime imports in the active paths use `@inmate/shared`. The shared models appear to be the active schema, but the duplicated definitions increase maintenance risk and can mislead future changes.

## Bottom Line

The inmate enrichment lifecycle is queue-driven and mutation-heavy. The main record of truth remains the `inmates` document, but the worker incrementally enriches it over several writes, archives provider responses in TTL-backed collections, and emits relationship side effects into `related_parties`. The biggest risks are non-atomic mutation, address flattening, expiring audit payloads, and low-confidence related-party persistence.