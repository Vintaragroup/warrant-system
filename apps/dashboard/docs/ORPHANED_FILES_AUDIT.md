# Bail Bonds Dashboard Orphaned Files Audit

Date: 2026-04-24
Scope: unused or orphaned files, old script versions, production debug/test leftovers, and large commented-out code blocks

## Observations

- The clearest orphaned-file zone is the `backups/` directory, which contains archived step files rather than live code.
- The repo also has a few direct duplicate or abandoned component/script variants outside `backups/`.
- I did not find a high-confidence active production file whose main issue is a large commented-out code block.

## Reasoning

- I marked files as safe to delete when they are duplicate copies, explicit backups, or unused component variants with no references.
- I marked files as needing confirmation when they are unreferenced but still plausibly useful for rare admin, audit, or one-off data tasks.
- I explicitly did not mark the auth preview/showcase/design components as orphaned, because they are routed in the current auth route surface.

## Files Safe To Delete

### Archived step-by-step backup files

- `backups/CaseActionsPopover_step6_crm_quick.jsx`
- `backups/CaseDetail_step1.jsx`
- `backups/CaseDetail_step2_overview_checklist.jsx`
- `backups/CaseDetail_step2_tabs.jsx`
- `backups/CaseDetail_step3_workspaces.jsx`
- `backups/CaseDetail_step4_document_tools.jsx`
- `backups/CaseDetail_step5_crm_enhancements.jsx`
- `backups/CaseDetail_step7_activity_presets.jsx`
- `backups/CaseDetail_step8_query_tab.jsx`
- `backups/Cases_step0.jsx`
- `backups/Cases_step3_stats_ui.jsx`
- `backups/Cases_step6_case_actions_crm.jsx`
- `backups/Dashboard_step_refinements.jsx`
- `backups/Dashboard_step_updates_case_links.jsx`
- `backups/Reports_step1_initial_dashboard.jsx`
- `backups/Reports_step2_charts.jsx`
- `backups/hooks_cases_step4_documents.js`
- `backups/hooks_cases_step5_timeline.js`
- `backups/server_case_model_step3_attachments.js`
- `backups/server_cases_step3_stats.js`
- `backups/server_documents_step3_crud.js`

Reason:

- explicit archival naming pattern
- not imported anywhere as runtime code
- repo docs already describe `backups/` as legacy/archive-only material

### Duplicate or abandoned component variants

- `src/components/ui/user-avatar.jsx`
- `src/components/InlineMapLeaflet.jsx`

Reason:

- `src/components/ui/user-avatar.tsx` is the typed active version referenced by the app
- `InlineMapLeaflet.jsx` defines a component but no meaningful usage reference was found; the repo uses `InlineMapEmbed.jsx` instead

### Duplicate script copy

- `scripts/seed-county-data.js`

Reason:

- overlaps `server/scripts/seed-county-data.js`
- no package-script reference found for the root copy
- current server-owned script layout makes the server copy the better home

## Files Needing Confirmation

### Unreferenced but potentially useful manual scripts

- `scripts/seed-test-data.js`
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

Reason:

- no package-script or runtime startup reference found
- still plausible as one-off operations or audit utilities
- better archive/delete decision depends on whether the team still uses local data diagnostics outside the main npm scripts

### Keep, but do not classify as orphaned

- `server/scripts/backfill_bonds.js`

Reason:

- not unused; it is still conceptually part of the repo’s bond processing workflow
- current problem is that it is broken because `yargs` is missing from the server package dependency surface

## Old Versions Of Scripts

### Confirmed

- `scripts/seed-county-data.js`
  - superseded by `server/scripts/seed-county-data.js`

### Backup-history files

- all step-named files under `backups/`

These are effectively saved historical versions of components and server files.

## Test Or Debug Files Left In Production

### Strongest production-clutter signal

- the entire `backups/` directory

This is not test infrastructure; it is historical working copies stored inside the main repo.

### Not orphaned

- `src/config/enrichment.test.ts`

This is a legitimate test file within the configured test surface and should stay.

## Commented-Out Large Code Blocks

### No high-confidence active-code candidate found

I did not find a clearly active source file whose main issue is a large commented-out implementation block. The major dead-code problem in this repo is archived file copies, not commented-out blocks inside active files.

## Bottom Line

- Safest deletions are the `backups/` directory, `src/components/ui/user-avatar.jsx`, `src/components/InlineMapLeaflet.jsx`, and the root `scripts/seed-county-data.js`
- The remaining questionable scripts are mostly rare manual utilities and should be confirmed before removal
- `server/scripts/backfill_bonds.js` needs a dependency fix, not deletion