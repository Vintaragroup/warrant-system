# WarrantDB Pipeline Orphaned Files Audit

Date: 2026-04-24
Scope: unused or orphaned files, old script versions, production debug/test leftovers, and large commented-out code blocks

## Observations

- This repo has the most real orphaned-file clutter of the three workspaces.
- The dominant problem is committed debug output, dumps, and historical maintenance scripts around older Harris and Galveston workflows.
- I did not find a high-confidence active production file whose main issue is a large commented-out implementation block.

## Reasoning

- I marked files as safe to delete when they are clearly generated artifacts, debug leftovers, or isolated test files outside the active test surface.
- I marked files as needing confirmation when they are stale or specialized utilities that may still carry historical operational value.
- I did not mark `Dockerfile.disabled` as safe to delete because the repo’s current Docker path is already inconsistent and that file is still the only working Docker recipe present.

## Files Safe To Delete

### Debug and test leftovers

- `debug/testing/debug_jefferson.py`
- `debug/testing/simplified_jefferson_test.py`
- `debug/field_inventory_.err`
- `debug/field_inventory_.txt`
- `debug/field_inventory_20250910T182119Z.txt`
- `debug/roster_dump.json`
- `debug/sniff.json`
- `debug_dumps/.DS_Store`

Reason:

- isolated test/debug artifacts
- not part of README, RUNBOOK, SCHEDULING, workflows, or runtime imports
- committed outputs rather than maintained source

### Generated or local dump artifacts

- `brazoria_dump.json`
- `brazoria.jsonl`
- `harris_baseline.json`

Reason:

- look like generated analysis or dump outputs rather than source-of-truth program files

## Files Needing Confirmation

### Historical or specialized maintenance scripts

- `scripts/rebucket_simple_harris.py`
- `scripts/migrate_galveston_data.py`
- `scripts/enrich_galveston_details.py`
- `scripts/run_twice_daily.sh`
- `scripts/baseline_booking_metrics.py`
- `scripts/compare_roster_county.py`
- `scripts/jefferson_pdf_recent_bonds.py`
- `scripts/person_address_sync_harris.py`
- `scripts/derive_jefferson_prefixes.py`
- `scripts/backfill_galveston_mugshots.py`
- `scripts/field_inventory.js`
- `scripts/run_rebucket.sh`
- `make_jeff_lastnames_from_simple.js`
- `test_mongo.py`

Reason:

- no strong current scheduling or runtime ownership
- still plausible as operator-maintained one-off scripts
- several appear historical, but not all are safe to remove without checking how often the team performs manual maintenance

### Dump and archive directories

- `dump_local/warrantdb/`
- `debug_dumps/brazoria/`
- `debug_dumps/fortbend/`

Reason:

- likely local or debugging artifacts
- safe for source-control cleanup if they are not intentionally kept as archival samples
- confirm before deletion if the team uses them as reference fixtures

### Keep, but fix or replace instead of deleting

- `Dockerfile.disabled`
  - not safe to delete until the repo has a real active Dockerfile strategy

- `scripts/run_pipeline.py`
  - not orphaned, but currently contains a stale normalizer module path that should be fixed rather than removed

## Old Versions Of Scripts

### Strongest old-version signal

- `scripts/rebucket_simple_harris.py`
- `scripts/rebucket_simple_harris_v2.py`

The v2 script is the more current candidate. The older one should only stay if there is a deliberate rollback or compatibility reason.

### Historical migration script

- `scripts/migrate_galveston_data.py`

This looks like a one-time migration path rather than an active part of the current repo workflow.

## Test Or Debug Files Left In Production

### Confirmed clutter

- `debug/testing/*`
- `debug/field_inventory*.txt`
- `debug/field_inventory_.err`
- `debug/roster_dump.json`
- `debug/sniff.json`
- root data dump artifacts like `brazoria_dump.json` and `brazoria.jsonl`

These are the strongest production-clutter cleanup targets in this workspace.

## Commented-Out Large Code Blocks

### No high-confidence active-code candidate found

I did not find a clearly active source file where the main issue is a large commented-out block of dead implementation. The cleanup surface here is mostly stale scripts and committed debug artifacts, not commented-out code.

## Bottom Line

- Safest deletions are the committed debug/test leftovers and generated dump files
- Most older script candidates in this repo need confirmation rather than blind removal
- The repo’s actual cleanup priority is source-control artifact clutter first, then stale maintenance wrappers