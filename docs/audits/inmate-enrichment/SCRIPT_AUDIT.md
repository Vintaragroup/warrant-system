# Inmate Enrichment Script Audit

Date: 2026-04-24
Scope: scripts related to scraping, data ingestion, scheduling, and batch jobs

## Observations

- The active runtime path is centered on the API queue producer, the worker pipeline, and two automatic triggers: the Mongo change-stream watcher and the cron sweep.
- Most files under `tools/` are operator-run utilities, not part of the default runtime.
- Only a small number of tool scripts are wired into `package.json` or clearly aligned with the current API endpoints.

## Reasoning

- I treated a script as active when it was referenced by `package.json`, imported by runtime code, or matched the current documented/implemented API workflow.
- I treated a script as a deletion candidate only when it overlapped another script, had no meaningful reference surface, or targeted behavior now covered by the application itself.
- I treated a script as broken when its implementation no longer matched the current API contract or current execution path.

## All Relevant Scripts And Purpose

### Active runtime and scheduler scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `api/src/server.ts` | API queue producer for enrichment runs and targeted related-party pulls | owns `/api/enrichment/run` and related endpoints | Active |
| `worker/src/index.ts` | BullMQ worker entrypoint that consumes enrichment jobs | runtime worker process in Docker and package scripts | Active |
| `worker/src/pipeline.ts` | main enrichment pipeline including HCSO DOB, provider search, scoring, and storage | called by `worker/src/index.ts` | Active |
| `api/src/watcher.ts` | automatic change-stream trigger for new qualifying subjects | imported by API server startup path | Active |
| `api/src/sweep.ts` | cron-driven sweep for auto-enrichment | imported by API server startup path; uses `AUTO_ENRICH_SWEEP_CRON` | Active |

### Active operator and batch scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `tools/ensure_stack.js` | health-aware stack startup and recovery wrapper around Docker Compose | root `package.json` `stack:up` and `stack:rebuild` | Active |
| `tools/smoke.js` | smoke test for `/health` and small enrichment run | root `package.json` `smoke` | Active |
| `tools/validate_related_phones.js` | validates related-party phones against Whitepages/local API expectations | root `package.json` `phones:validate` | Active |
| `tools/enqueue_micro_batch.js` | enqueues a small recent prospect batch through `/api/enrichment/run` | current API path usage matches `api/src/server.ts` | Active |
| `tools/enqueue_unresolved_72h.js` | scans recent unresolved inmates and enqueues `dob-only` jobs in chunks | current API path usage matches `api/src/server.ts` | Active |
| `tools/run_hcso_batch.js` | JS operator batch runner for recent missing-DOB HCSO candidates | current API path usage matches `api/src/server.ts` | Active |
| `tools/run_hcso_all_booking_72h.js` | batch run across all recent booking-window HCSO candidates | part of current HCSO batch tooling family | Active utility |
| `tools/run_hcso_first10_booking.js` | small HCSO booking-window batch runner for first 10 candidates | part of current HCSO batch tooling family | Active utility |
| `tools/run_hcso_for_spn.js` | single-SPN HCSO trigger utility | current HCSO operator utility | Active utility |
| `tools/report_dob_batch_by_suffix.js` | reports status of `dob-only` jobs by batch suffix | matches current job id pattern from `/api/enrichment/run` | Active utility |
| `tools/report_72h_completion.js` | reports recent booking-window completion coverage | aligned with current 72h operational model | Active utility |
| `tools/report_dob_coverage_72h.js` | reports HCSO DOB coverage over recent booking-window subjects | aligned with current HCSO workflow | Active utility |
| `tools/report_not_in_jail_recent.js` | reports recent HCSO `notInJail` outcomes | aligned with current `hcso_status` flow in worker pipeline | Active utility |
| `tools/report_first10_status.js` | quick status snapshot for a small recent batch | aligned with current job status model | Active utility |
| `tools/report_last10_dob_only.js` | quick status snapshot for recent `dob-only` jobs | aligned with current job status model | Active utility |
| `tools/enrich_related_parties_pipl.js` | targeted Pipl enrichment and upsert for related parties | still compatible with `related_parties` collection and Pipl usage | Active utility |
| `tools/upsert_name_relations.js` | related-party/upsert helper around name-based relations | still fits current related-party data model | Active utility |

### Specialized data cleanup or inspection scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `tools/backfill_location.js` | backfills city/state/country-style location fields | one-off data repair utility | Manual utility |
| `tools/cleanup_postal_codes.js` | fixes postal-code formatting | one-off cleanup utility | Manual utility |
| `tools/scan_bad_postal.js` | scans for suspect postal data | one-off inspection utility | Manual utility |
| `tools/find_bad_postal.js` | finds records with suspect postal data | overlaps with other postal diagnostics | Manual utility |
| `tools/find_address.js` | address lookup/debug utility | manual inspection | Manual utility |
| `tools/inspect_dob_fields.js` | inspects DOB field state across records | manual inspection | Manual utility |
| `tools/print_inmate_info.js` | prints record details for a subject | manual inspection | Manual utility |
| `tools/report_dob_backfill.js` | reporting utility for DOB backfill outcomes | manual reporting | Manual utility |
| `tools/dump_hcso_snippets.js` | dumps HCSO HTML snippets for debugging | HCSO parser debugging | Manual utility |
| `tools/audit_time_basis_72h.js` | audits time-basis interpretation for booking-window logic | manual diagnostic | Manual utility |
| `tools/pipl_ad_hoc.js` | ad hoc external Pipl query tool | no runtime reference; developer/operator convenience | Manual utility |

### Overlap or uncertain scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `tools/run_hcso_batch.ts` | TypeScript version of HCSO batch enqueue tool | overlaps `tools/run_hcso_batch.js`; no package script or clear runtime reference | Candidate duplicate |

## Duplicate Scripts Doing Similar Work

### Strong duplicate signal

- `tools/run_hcso_batch.js`
- `tools/run_hcso_batch.ts`

These appear to implement the same operator task. The JavaScript file is immediately runnable and aligned with the current local tooling style. The TypeScript copy has no corresponding package script or documented invocation surface.

### Reporting overlap cluster

- `tools/report_first10_status.js`
- `tools/report_last10_dob_only.js`
- `tools/report_dob_batch_by_suffix.js`

These are not exact duplicates, but they cover the same job-status reporting area and could be consolidated later.

### Postal cleanup overlap cluster

- `tools/scan_bad_postal.js`
- `tools/find_bad_postal.js`
- `tools/cleanup_postal_codes.js`

These target the same cleanup domain and should be reviewed together before adding new postal tools.

## Scripts No Longer Referenced Anywhere

### Strongest candidate

- `tools/run_hcso_batch.ts`

I found no package script, runtime import, Compose reference, or documentation path that requires the TypeScript copy.

### Weak unreferenced candidates

- `tools/pipl_ad_hoc.js`
- `tools/find_address.js`
- `tools/inspect_dob_fields.js`

These appear to be ad hoc diagnostics rather than active runtime paths. They are not automatically wired, but they may still be intentionally kept for operator debugging.

## Scripts That Are Partially Implemented Or Broken

### Broken or mismatched

- `tools/run_hcso_batch.ts`
  - Functionally overlaps the JavaScript version and is not wired into the repo’s normal execution path.
  - The repo’s operational tool surface is otherwise JavaScript in `tools/`, so this looks like a superseded copy rather than an active maintained entrypoint.

### Operationally fragile, but not deletion candidates

- `tools/ensure_stack.js`
  - Active, but the current Docker stack helper has a Redis host-port assumption that can fail against the current Compose setup.
  - Keep it, but treat it as a script needing maintenance, not deletion.

## Clean List Of Active Scripts

### Primary active execution paths

- `api/src/server.ts`
- `api/src/watcher.ts`
- `api/src/sweep.ts`
- `worker/src/index.ts`
- `worker/src/pipeline.ts`

### Active operator and batch scripts

- `tools/ensure_stack.js`
- `tools/smoke.js`
- `tools/validate_related_phones.js`
- `tools/enqueue_micro_batch.js`
- `tools/enqueue_unresolved_72h.js`
- `tools/run_hcso_batch.js`
- `tools/run_hcso_all_booking_72h.js`
- `tools/run_hcso_first10_booking.js`
- `tools/run_hcso_for_spn.js`
- `tools/report_dob_batch_by_suffix.js`
- `tools/report_72h_completion.js`
- `tools/report_dob_coverage_72h.js`
- `tools/report_not_in_jail_recent.js`
- `tools/report_first10_status.js`
- `tools/report_last10_dob_only.js`
- `tools/enrich_related_parties_pipl.js`
- `tools/upsert_name_relations.js`

## Candidates For Deletion

### Highest-confidence deletion candidate

- `tools/run_hcso_batch.ts`

### Review before deletion

- `tools/pipl_ad_hoc.js`
- `tools/find_address.js`
- `tools/inspect_dob_fields.js`

These look unused in the current operational path, but they are better treated as archive-or-delete review items rather than immediate removals.

## Bottom Line

- The active execution core is small and centered on the API queue producer, worker pipeline, watcher, and sweep.
- The `tools/` directory contains many operator utilities, but only a subset are clearly active.
- The clearest cleanup action is removing or archiving `tools/run_hcso_batch.ts` in favor of the JavaScript batch runner.