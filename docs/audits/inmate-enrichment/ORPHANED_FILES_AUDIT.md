# Inmate Enrichment Orphaned Files Audit

Date: 2026-04-24
Scope: unused or orphaned files, old script versions, production debug/test leftovers, and large commented-out code blocks

## Observations

- The active runtime surface is narrow: API, worker, watcher, sweep, and a subset of `tools/`.
- Most suspected orphaned files in this repo are one-off operator utilities rather than clearly abandoned application code.
- I did not find a high-confidence active production file whose main issue is a large commented-out code block.

## Reasoning

- I marked a file as safe to delete only when it had a strong duplicate or superseded-file signal.
- I marked files as needing confirmation when they were unreferenced in package scripts and runtime imports but still looked like intentional operator utilities.
- I treated `tests/` as expected dev surface, not production clutter.

## Files Safe To Delete

### Strong duplicate / old-version signal

- `tools/run_hcso_batch.ts`

Reason:

- overlaps the active JavaScript version `tools/run_hcso_batch.js`
- no package-script reference found
- no runtime import or Compose reference found
- the surrounding `tools/` surface is otherwise JavaScript-first

## Files Needing Confirmation

### Likely orphaned manual utilities

- `tools/pipl_ad_hoc.js`
- `tools/find_address.js`
- `tools/inspect_dob_fields.js`
- `tools/dump_hcso_snippets.js`

Reason:

- no meaningful runtime or package-script reference found
- look intentionally kept as operator diagnostics or ad hoc investigation tools
- safe to archive if the team no longer does manual HCSO/Pipl investigation from the repo

### Utility scripts that are specialized, not obviously dead

- `tools/report_dob_backfill.js`
- `tools/report_first10_status.js`
- `tools/report_last10_dob_only.js`

Reason:

- niche reporting utilities around the current job model
- not primary runtime code, but not clearly stale enough for automatic deletion

## Old Versions Of Scripts

### Confirmed

- `tools/run_hcso_batch.ts`
  - older or alternate implementation of the same HCSO batch runner already present as `tools/run_hcso_batch.js`

## Test Or Debug Files Left In Production

### No high-confidence production-clutter deletion target found

- `tests/` is expected and intentionally part of the repo
- no committed test/debug file outside normal test or utility areas stood out as a strong safe-delete candidate

## Commented-Out Large Code Blocks

### No high-confidence candidate found

I did not find a clearly active source file whose main issue is a large commented-out implementation block. The repo has ordinary inline comments and utility notes, but not obvious dead code blocks large enough to call out as cleanup targets.

## Bottom Line

- Safest delete: `tools/run_hcso_batch.ts`
- Most other suspicious files in this repo are manual operator tools, not clear trash
- This repo has much less true orphaned-file sprawl than the other two workspaces