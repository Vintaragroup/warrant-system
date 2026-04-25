# Inmate Enrichment Repository Structure Audit

Date: 2026-04-23
Scope: discovery and audit only for the `Inmate_enrichment` repository

## Purpose

This document provides a workspace-oriented overview of the monorepo structure, the role of each top-level area, the main executable entry points, and files or directories that appear duplicated, mirrored, generated, or potentially redundant.

## Cleaned Folder Tree

This tree omits `.git`, `node_modules`, and build output directories while keeping the meaningful source, tooling, docs, and runtime-support areas.

```text
Inmate_enrichment/
├── .devcontainer/
│   └── devcontainer.json
├── .giga/
│   ├── rules/
│   └── specifications.json
├── .github/
│   └── copilot-instructions.md
├── .vscode/
│   ├── extensions.json
│   └── tasks.json
├── api/
│   ├── src/
│   │   └── models/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── docs/
│   ├── API_Endpoint_Map.md
│   ├── Case_UI_Refinement_Plan.md
│   ├── CONTRACTS.md
│   ├── CRM_SUGGESTIONS.md
│   ├── Dashboard_Enrichment_UI_Contract.md
│   ├── Dashboard_Proxy_Wiring.md
│   ├── Enrichment_Progress_and_Recovery.md
│   ├── Full_Results_Expanders_and_Filters.md
│   ├── Incident_Runbook.md
│   ├── OPTION_B_UI_PROVIDER_WIRING.md
│   ├── Postal_Code_Cleanup.md
│   ├── Production_Prep_Checklist.md
│   ├── Related_Parties_API.md
│   ├── REPOSITORY_STRUCTURE_AUDIT.md
│   ├── run_commands.md
│   ├── SPN_02865254_Wiring_Check.md
│   ├── Working_Notes.md
│   └── Workspace_Guide.md
├── reports/
│   ├── dob_sweep_24h_1000.json
│   ├── prospects-24h-1000.json
│   ├── prospects-24h-500.json
│   └── prospects-72h-1000.json
├── shared/
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
├── tests/
│   ├── hcso_dob_parse.test.ts
│   ├── hcso_status_parse.test.ts
│   ├── match_normalize.test.ts
│   ├── scoring.test.ts
│   └── timestamps.test.ts
├── tools/
│   ├── postman/
│   ├── audit_time_basis_72h.js
│   ├── backfill_location.js
│   ├── cleanup_postal_codes.js
│   ├── dump_hcso_snippets.js
│   ├── enqueue_micro_batch.js
│   ├── enqueue_unresolved_72h.js
│   ├── enrich_related_parties_pipl.js
│   ├── ensure_stack.js
│   ├── find_address.js
│   ├── find_bad_postal.js
│   ├── inspect_dob_fields.js
│   ├── pipl_ad_hoc.js
│   ├── print_inmate_info.js
│   ├── report_72h_completion.js
│   ├── report_dob_backfill.js
│   ├── report_dob_batch_by_suffix.js
│   ├── report_dob_coverage_72h.js
│   ├── report_first10_status.js
│   ├── report_last10_dob_only.js
│   ├── report_not_in_jail_recent.js
│   ├── requests.http
│   ├── run_hcso_all_booking_72h.js
│   ├── run_hcso_batch.js
│   ├── run_hcso_batch.ts
│   ├── run_hcso_first10_booking.js
│   ├── run_hcso_for_spn.js
│   ├── scan_bad_postal.js
│   ├── smoke.js
│   ├── upsert_name_relations.js
│   └── validate_related_phones.js
├── uploads/
├── web/
│   ├── src/
│   ├── index.html
│   └── package.json
├── worker/
│   ├── src/
│   │   └── providers/
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── .env
├── .env.sample
├── .gitignore
├── AGENTS.md
├── cookiejar
├── docker-compose.yml
├── Enrichment_Dashboard.code-workspace
├── jest.config.js
├── package-lock.json
├── package.json
├── README.md
└── tsconfig.base.json
```

## Top-Level Directory Purpose

- `.devcontainer/`: Codespaces and dev container setup for running the repo in a standardized environment.
- `.giga/`: Repository-specific domain rules and workspace context describing enrichment logic, providers, scoring, and relationships.
- `.github/`: Repository automation and development instructions.
- `.vscode/`: Workspace editor configuration and task setup.
- `api/`: Express and TypeScript API service that exposes enrichment routes, docs, and queue-triggering endpoints.
- `docs/`: Main workspace-understanding and operations documentation surface for the monorepo.
- `reports/`: Generated report artifacts and output snapshots, not primary application source.
- `shared/`: Shared TypeScript library used across the API, worker, and potentially the web app.
- `tests/`: Jest tests covering scoring, parsing, normalization, and timestamp logic.
- `tools/`: Main operational CLI and utility surface for stack control, HCSO runs, reporting, queueing, ad hoc enrichment, and cleanup tasks.
- `uploads/`: Runtime upload or drop area.
- `web/`: Minimal React and Vite dashboard frontend.
- `worker/`: Background worker service that consumes queue jobs and runs the enrichment pipeline.

## Major Component Overview

- `api/`: Main server-side API entry layer. `api/src/index.ts` starts the Express app, exposes Swagger/OpenAPI docs, and coordinates with the queue-backed enrichment workflow.
- `worker/`: Queue consumer and pipeline executor. Based on the repo guidance and local rules, the core enrichment flow is centered on the worker pipeline and provider integrations, especially HCSO processing.
- `shared/`: Shared contracts and algorithms. This is where common normalization and relationship scoring logic live for cross-service use.
- `web/`: Frontend dashboard for running and inspecting enrichment workflows.
- `tools/`: Largest set of executable support scripts. This folder drives most manual operations, audits, and one-off remediation work.
- `docs/`: Best documentation location for workspace understanding, architecture, recovery, production prep, and cross-repo wiring.
- `tests/`: Focused verification layer for the parsing and scoring logic called out by the enrichment workflow.
- `reports/`: Stored JSON result outputs from audits and sweeps.

## Executable Entry Points

### Monorepo package scripts

Defined in root `package.json`:

- `build`
- `dev`
- `test`
- `lint`
- `stack:up`
- `stack:rebuild`
- `stack:down`
- `stack:status`
- `stack:logs`
- `stack:restart`
- `phones:validate`
- `smoke`

### Primary runtime entry points

- `api/src/index.ts`
- `worker/src/index.ts`
- `web/index.html`
- `docker-compose.yml`

### Operational and utility scripts

CLI-shaped or clearly executable tools under `tools/`:

- `tools/ensure_stack.js`
- `tools/smoke.js`
- `tools/validate_related_phones.js`
- `tools/enqueue_micro_batch.js`
- `tools/enqueue_unresolved_72h.js`
- `tools/enrich_related_parties_pipl.js`
- `tools/pipl_ad_hoc.js`
- `tools/backfill_location.js`
- `tools/cleanup_postal_codes.js`
- `tools/dump_hcso_snippets.js`
- `tools/find_address.js`
- `tools/find_bad_postal.js`
- `tools/inspect_dob_fields.js`
- `tools/print_inmate_info.js`
- `tools/report_72h_completion.js`
- `tools/report_dob_backfill.js`
- `tools/report_dob_batch_by_suffix.js`
- `tools/report_dob_coverage_72h.js`
- `tools/report_first10_status.js`
- `tools/report_last10_dob_only.js`
- `tools/report_not_in_jail_recent.js`
- `tools/run_hcso_all_booking_72h.js`
- `tools/run_hcso_batch.js`
- `tools/run_hcso_batch.ts`
- `tools/run_hcso_first10_booking.js`
- `tools/run_hcso_for_spn.js`
- `tools/scan_bad_postal.js`
- `tools/upsert_name_relations.js`

### Test entry surfaces

- `jest.config.js`
- `tests/`

## Duplicate or Potentially Redundant Areas

### Expected monorepo duplication

- `package.json` files exist at the root and in `api/`, `shared/`, `web/`, and `worker/`.
- `tsconfig.json` files exist in `api/`, `shared/`, and `worker/`.
- `Dockerfile` exists in both `api/` and `worker/`.

These are normal for a small workspace-based monorepo and not an issue by themselves.

### Repeated index entry filenames

- `api/src/index.ts`
- `shared/src/index.ts`
- `worker/src/index.ts`

These are standard per-package entry files and are expected, but they do mean the workspace has multiple same-name entry files.

### Strongest likely redundancy signal

- `tools/run_hcso_batch.js`
- `tools/run_hcso_batch.ts`

This pair suggests both JavaScript and TypeScript versions of the same operational tool and is the clearest candidate for consolidation review.

### Tool sprawl in adjacent reporting areas

- Multiple `report_*` scripts in `tools/` target overlapping HCSO, DOB, and 72-hour coverage concerns.
- These may all be intentional, but they represent a likely cleanup or consolidation area if the tool surface is ever simplified.

### Artifact and runtime-support areas

- `reports/` contains generated JSON outputs rather than active source.
- `cookiejar` and `uploads/` are runtime-support artifacts and not core application code.

## Key Audit Notes

- The repo is structurally clean for a monorepo: API, worker, shared library, frontend, tests, docs, and operations tooling are clearly separated.
- The biggest source of maintenance complexity is not duplicated application code but the breadth of one-off scripts in `tools/`.
- The clearest likely redundancy is the dual `run_hcso_batch` implementation in both JavaScript and TypeScript.
- The best documentation surface for workspace understanding in this repo is the root `docs/` directory.
- This audit is discovery-only. Potentially redundant files should not be removed without checking tasks, imports, Docker references, and historical operational usage.