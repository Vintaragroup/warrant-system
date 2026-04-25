# Bail Bonds Dashboard Script Audit

Date: 2026-04-24
Scope: scripts related to scraping, data ingestion, scheduling, and batch jobs

## Observations

- The live background execution path is in the server queue layer, not in the root `scripts/` folder.
- `server/src/jobs/` contains the active workers that initialize with the API process when Redis is configured.
- Most root and `server/scripts/` files are utilities for smoke testing, validation, data seeding, and maintenance rather than recurring production jobs.

## Reasoning

- I marked queue workers and queue initialization as active because they are imported and started by the server runtime.
- I marked server smoke and validation scripts as active when they are wired into `package.json`.
- I marked scripts as deletion candidates only when they had duplicate copies, no package-script references, and no clear runtime/documented role.

## All Relevant Scripts And Purpose

### Active runtime job scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `server/src/jobs/index.js` | initializes background workers when `REDIS_URL` is present and workers are not disabled | imported and called from `server/src/index.js` | Active |
| `server/src/jobs/messaging.js` | BullMQ worker for outbound messaging jobs | started through `server/src/jobs/index.js` | Active |
| `server/src/jobs/checkins.js` | BullMQ worker for GPS/check-in jobs | started through `server/src/jobs/index.js` | Active |
| `server/src/jobs/queueFactory.js` | queue/worker factory used by background job layer | imported by job modules | Active support |
| `server/src/services/checkinsQueueService.js` | recurring scheduling logic for GPS/check-in work | active queue service used by job layer | Active support |

### Active server utility scripts

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `server/scripts/smoke-health.mjs` | unauthenticated API health smoke test | wired in `server/package.json` as `smoke:health` | Active |
| `server/scripts/smoke-dashboard.mjs` | authenticated dashboard smoke test | wired in `server/package.json` as `smoke:dashboard` | Active |
| `server/scripts/smoke-trends.mjs` | trends endpoint smoke test | wired in `server/package.json` as `smoke:trends` | Active |
| `server/scripts/test-windows.mjs` | window/bucket test harness | wired in `server/package.json` as `test:windows` | Active |
| `server/scripts/validate-windows.mjs` | validates API window counts against Mongo aggregation | wired in `server/package.json` as `validate:windows` | Active |
| `server/scripts/validate-openapi.js` | OpenAPI validation and bundle generation | wired in `server/package.json` as `lint:api` and `lint:api:bundle` | Active |
| `server/scripts/create-firebase-user.mjs` | creates Firebase users for testing/admin setup | wired in `server/package.json` as `firebase:create-user` | Active |

### Active but manual data and maintenance utilities

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `server/scripts/verify_backfill_run.js` | validates backfill run results from stored backfill output files | linked to bond backfill workflow | Manual utility |
| `server/scripts/seed-county-data.js` | seeds county sample collections in the server data model | current server-side seed path | Manual utility |
| `server/scripts/db_diagnostics.js` | database diagnostics and schema/index inspection | manual diagnostic utility | Manual utility |
| `server/scripts/list-firebase-users.mjs` | lists Firebase users for admin inspection | manual admin utility | Manual utility |
| `server/scripts/sample_warrantdb.py` | samples database documents to files | manual sampling/export utility | Manual utility |

### Root-level scripts and utilities

| Script | Purpose | Evidence | Status |
|---|---|---|---|
| `scripts/seed-county-data.js` | older root-level county seed script | duplicates server-side script name and intent | Candidate duplicate |
| `scripts/seed-test-data.js` | root-level test data seeding utility | no package-script or runtime reference found | Manual utility |
| `scripts/analyze_har.mjs` | HAR analysis utility | no runtime or package-script reference found | Manual utility |
| `scripts/sanitize_har.mjs` | HAR sanitization utility | no runtime or package-script reference found | Manual utility |
| `scripts/atlas_simple_audit.py` | Mongo/Atlas audit utility | no runtime or package-script reference found | Manual utility |
| `scripts/atlas_source_audit.py` | Mongo/Atlas source audit utility | no runtime or package-script reference found | Manual utility |
| `scripts/atlas_fieldmap_diff.py` | field-map diff utility | no runtime or package-script reference found | Manual utility |
| `scripts/atlas_categorical_field_audit.py` | categorical field audit utility | no runtime or package-script reference found | Manual utility |
| `scripts/eval_windows.py` | window evaluation utility | no runtime or package-script reference found | Manual utility |

## Duplicate Scripts Doing Similar Work

### Strong duplicate signal

- `scripts/seed-county-data.js`
- `server/scripts/seed-county-data.js`

These share the same name and apparent purpose. The server copy is the better fit for the current backend-owned data model and script organization.

### Related validation cluster

- `server/scripts/test-windows.mjs`
- `server/scripts/validate-windows.mjs`

These are not duplicates, but they occupy the same validation surface and should stay coordinated.

## Scripts No Longer Referenced Anywhere

### Strong unreferenced candidates

- `scripts/seed-county-data.js`
- `scripts/seed-test-data.js`
- `scripts/analyze_har.mjs`
- `scripts/sanitize_har.mjs`
- `scripts/atlas_simple_audit.py`
- `scripts/atlas_source_audit.py`
- `scripts/atlas_fieldmap_diff.py`
- `scripts/atlas_categorical_field_audit.py`
- `scripts/eval_windows.py`

### Likely unreferenced server utilities

- `server/scripts/db_diagnostics.js`
- `server/scripts/list-firebase-users.mjs`
- `server/scripts/sample_warrantdb.py`

These may still be useful for manual operations, but they are not wired into package scripts or runtime startup.

## Scripts That Are Partially Implemented Or Broken

### Broken

- `server/scripts/backfill_bonds.js`
  - imports `yargs`
  - `server/package.json` does not declare `yargs`
  - this is a concrete dependency break for anyone trying to run the backfill from the server package environment

### Structurally weak, but not broken by themselves

- `scripts/seed-county-data.js`
  - appears superseded by the server-side copy rather than actively maintained in parallel

## Clean List Of Active Scripts

### Active runtime job layer

- `server/src/jobs/index.js`
- `server/src/jobs/messaging.js`
- `server/src/jobs/checkins.js`
- `server/src/jobs/queueFactory.js`
- `server/src/services/checkinsQueueService.js`

### Active scripted utilities

- `server/scripts/smoke-health.mjs`
- `server/scripts/smoke-dashboard.mjs`
- `server/scripts/smoke-trends.mjs`
- `server/scripts/test-windows.mjs`
- `server/scripts/validate-windows.mjs`
- `server/scripts/validate-openapi.js`
- `server/scripts/create-firebase-user.mjs`
- `server/scripts/verify_backfill_run.js`
- `server/scripts/seed-county-data.js`

## Candidates For Deletion

### Highest-confidence deletion or archive candidates

- `scripts/seed-county-data.js`
- `scripts/seed-test-data.js`

### Review-for-archive candidates

- `scripts/analyze_har.mjs`
- `scripts/sanitize_har.mjs`
- `scripts/atlas_simple_audit.py`
- `scripts/atlas_source_audit.py`
- `scripts/atlas_fieldmap_diff.py`
- `scripts/atlas_categorical_field_audit.py`
- `scripts/eval_windows.py`
- `server/scripts/db_diagnostics.js`
- `server/scripts/list-firebase-users.mjs`
- `server/scripts/sample_warrantdb.py`

### Keep, but fix first

- `server/scripts/backfill_bonds.js`

This is not a deletion candidate. It looks useful, but it needs its missing dependency problem resolved.

## Bottom Line

- The active execution surface is the BullMQ job layer under `server/src/jobs` plus a small set of wired smoke/validation scripts.
- The clearest duplicate is the two `seed-county-data.js` files.
- The clearest broken script is `server/scripts/backfill_bonds.js` because its `yargs` dependency is missing from the server package.