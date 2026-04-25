# Bail-Bonds-Dashboard Repository Structure Audit

Date: 2026-04-23
Scope: discovery and audit only for the `Bail-Bonds-Dashboard` repository

## Purpose

This document provides a workspace-oriented overview of the repository structure, the role of each major top-level area, the executable entry points, and directories or files that appear duplicated, mirrored, archival, or potentially redundant.

## Cleaned Folder Tree

This tree omits dependency and build-output noise such as `node_modules`, `dist`, `server/node_modules`, `server/dist`, and `.secrets`, while keeping the meaningful application, docs, and operational structure.

```text
Bail-Bonds-Dashboard/
├── .giga/
│   ├── rules/
│   └── specifications.json
├── .github/
├── .vscode/
├── backups/
│   ├── CaseActionsPopover_step6_crm_quick.jsx
│   ├── CaseDetail_step1.jsx
│   ├── CaseDetail_step2_overview_checklist.jsx
│   ├── CaseDetail_step2_tabs.jsx
│   ├── CaseDetail_step3_workspaces.jsx
│   ├── CaseDetail_step4_document_tools.jsx
│   ├── CaseDetail_step5_crm_enhancements.jsx
│   ├── CaseDetail_step7_activity_presets.jsx
│   ├── CaseDetail_step8_query_tab.jsx
│   ├── Cases_step0.jsx
│   ├── Cases_step3_stats_ui.jsx
│   ├── Cases_step6_case_actions_crm.jsx
│   ├── Dashboard_step_refinements.jsx
│   ├── Dashboard_step_updates_case_links.jsx
│   ├── Reports_step1_initial_dashboard.jsx
│   ├── Reports_step2_charts.jsx
│   ├── hooks_cases_step4_documents.js
│   ├── hooks_cases_step5_timeline.js
│   ├── server_case_model_step3_attachments.js
│   ├── server_cases_step3_stats.js
│   └── server_documents_step3_crud.js
├── docs/
│   ├── changes/
│   ├── progress/
│   ├── README.md
│   ├── FOLDER_STRUCTURE.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── DATA_FLOW.md
│   ├── authentication-integration.md
│   ├── auth-ui-integration-review.md
│   ├── checkins-integration-plan.md
│   ├── deployment-containerization.md
│   ├── production-deployment.md
│   ├── cicd-staging.md
│   ├── OPENAPI_EXTENSIONS.md
│   ├── PAYMENT_INTEGRATION_REQUIREMENTS.md
│   ├── payments-operations-sop.md
│   ├── payments-qa-checklist.md
│   ├── Release_Smoke_Checklist.md
│   ├── CRM_SUBVIEWS.md
│   ├── CRM_SUBVIEWS_COMPLETION.md
│   ├── Enrichment_Wiring_Status.md
│   ├── final-feature-readiness.md
│   ├── credentials-mapping.md
│   ├── requested_creds.example.md
│   ├── requested_creds.md
│   └── REPOSITORY_STRUCTURE_AUDIT.md
├── nginx/
│   └── default.conf
├── public/
│   ├── env.example.js
│   ├── env.js
│   └── vite.svg
├── scripts/
│   ├── analyze_har.mjs
│   ├── atlas_categorical_field_audit.py
│   ├── atlas_fieldmap_diff.py
│   ├── atlas_simple_audit.py
│   ├── atlas_source_audit.py
│   ├── eval_windows.py
│   ├── sanitize_har.mjs
│   ├── seed-county-data.js
│   ├── seed-test-data.js
│   ├── categorical_fields_report.csv
│   ├── categorical_fields_report.json
│   └── debug_reports/
├── server/
│   ├── .git/
│   ├── .vscode/
│   ├── scripts/
│   │   ├── backfill_bonds.js
│   │   ├── backfill_runs/
│   │   ├── backfill_summary.json
│   │   ├── create-firebase-user.mjs
│   │   ├── db_diagnostics.js
│   │   ├── diagnostics.json
│   │   ├── list-firebase-users.mjs
│   │   ├── sample_warrantdb.py
│   │   ├── seed-county-data.js
│   │   ├── smoke-dashboard.mjs
│   │   ├── smoke-health.mjs
│   │   ├── smoke-trends.mjs
│   │   ├── test-windows.mjs
│   │   ├── validate-firebase-secret.mjs
│   │   ├── validate-openapi.js
│   │   ├── validate-windows.mjs
│   │   └── verify_backfill_run.js
│   ├── src/
│   │   ├── config/
│   │   ├── jobs/
│   │   ├── lib/
│   │   │   ├── enrichment/
│   │   │   │   └── providers/
│   │   │   └── messaging/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   │   └── utils/
│   │   ├── services/
│   │   ├── db.js
│   │   ├── indexes.js
│   │   ├── index.js
│   │   ├── openapi.bundle.json
│   │   └── openapi.yaml
│   ├── tests/
│   │   ├── __mocks__/
│   │   ├── cases.crm_enrichment.test.js
│   │   ├── payments.refund.test.js
│   │   └── payments.routes.test.js
│   ├── uploads/
│   ├── warrantdb_samples_20250916_200937/
│   ├── server/
│   │   ├── .gitignore
│   │   ├── data/
│   │   │   └── backfill_runs/
│   │   └── scripts/
│   ├── Dockerfile
│   ├── README.md
│   ├── nodemon.json
│   ├── package.json
│   └── package-lock.json
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── auth/
│   │   ├── checkins/
│   │   ├── figma/
│   │   ├── payments/
│   │   └── ui/
│   ├── config/
│   ├── guidelines/
│   ├── hooks/
│   ├── layouts/
│   ├── lib/
│   ├── pages/
│   ├── styles/
│   ├── App.css
│   ├── App.jsx
│   ├── index.css
│   └── main.jsx
├── .dockerignore
├── .env.example
├── .gitignore
├── AGENTS.md
├── Bail-Bonds-Dashboard.code-workspace
├── docker-compose.dev.yml
├── docker-compose.override.yml
├── docker-compose.staging.yml
├── Dockerfile.web
├── eslint.config.js
├── index.html
├── package.json
├── package-lock.json
├── postcss.config.js
├── PROGRAM_EVALUATION_COMPREHENSIVE.md
├── README.md
├── render.yaml
├── SCHEMA_CONTRACT.md
├── Schema_Authentication.md
├── static.json
├── tailwind.config.js
├── tsconfig.json
├── vite.config.js
├── vitest.config.ts
├── vitest.setup.ts
├── WINDOW_CONTRACT.md
└── WINDOWS_V2_STATUS.md
```

## Top-Level Directory Purpose

- `.giga/`: Repository-specific workspace knowledge and rule files used to describe domain logic and architecture priorities.
- `.github/`: Repository automation and CI-related metadata.
- `.vscode/`: Workspace-level editor configuration and task definitions.
- `backups/`: Archived step-by-step snapshots of UI and server files; likely historical working copies rather than active runtime code.
- `docs/`: Main workspace-understanding and operational documentation surface. This is the best-fit knowledge base for architecture, deployment, readiness, integration, and release notes.
- `nginx/`: Reverse-proxy or static hosting configuration.
- `public/`: Static assets and runtime-config JavaScript injected into the frontend.
- `scripts/`: Root-level analysis, data audit, HAR processing, seeding, and one-off support tooling.
- `server/`: Embedded backend subproject with its own package, scripts, tests, Dockerfile, and even nested repo metadata.
- `src/`: Frontend application source, including components, pages, hooks, layout code, styling, and client-side utilities.

## Major Component Overview

- `src/`: React and Vite frontend application. Entry begins at `src/main.jsx`, route-level views live in `src/pages`, shared request/state logic lives in `src/hooks`, and UI composition lives in `src/components`.
- `src/components/auth/`: Main frontend auth and admin-management surface.
- `src/components/ui/`: Shared UI component library. Based on repo guidance and `.giga` rules, this directory includes notable business-facing components such as the user avatar system and sidebar state management.
- `server/src/`: Backend Express application. Route handlers are in `server/src/routes`, domain helpers in `server/src/lib`, models in `server/src/models`, and operational services in `server/src/services`.
- `server/src/lib/buckets.js`: Core backend time-window and time-bucket logic.
- `server/src/lib/roles.js`: Core backend role and authorization logic.
- `server/src/lib/enrichment/`: Backend enrichment workflow and provider integration surface.
- `server/scripts/`: Main backend CLI and maintenance surface for smoke tests, validators, Firebase tooling, diagnostics, and backfills.
- `scripts/`: Supplemental root-level audit and seeding scripts that sit outside the main backend package.
- `docs/`: Architecture and ops documentation hub, including deployment, auth, CRM, enrichment, release smoke, and data-flow materials.
- `backups/`: High-noise archival area that preserves intermediate or historical file versions.

## Executable Entry Points

### Frontend and workspace entry points

- `index.html`
- `src/main.jsx`
- `package.json` scripts:
  - `dev`
  - `dev:https`
  - `build`
  - `lint`
  - `preview`
  - `server:dev`
  - `server:start`
  - `server:firebase:create-user`
  - `validate:windows`
  - `smoke:dashboard`
  - `smoke:trends`
  - `test`
  - `test:watch`
  - `compose:dev:up`
  - `compose:dev:down`
  - `compose:staging:up`
  - `compose:staging:down`

### Root directly executable scripts

Detected from shebangs and CLI argument handling:

- `scripts/analyze_har.mjs`
- `scripts/sanitize_har.mjs`
- `scripts/eval_windows.py`
- `scripts/atlas_categorical_field_audit.py`
- `scripts/atlas_fieldmap_diff.py`
- `scripts/atlas_simple_audit.py`
- `scripts/atlas_source_audit.py`
- `scripts/seed-county-data.js`
- `scripts/seed-test-data.js`

### Backend runtime entry points

- `server/src/index.js`
- `server/package.json` scripts:
  - `dev`
  - `start`
  - `smoke:health`
  - `smoke:dashboard`
  - `smoke:trends`
  - `test:windows`
  - `validate:windows`
  - `lint:api`
  - `lint:api:bundle`
  - `firebase:create-user`

### Backend directly executable scripts

- `server/scripts/backfill_bonds.js`
- `server/scripts/create-firebase-user.mjs`
- `server/scripts/db_diagnostics.js`
- `server/scripts/list-firebase-users.mjs`
- `server/scripts/sample_warrantdb.py`
- `server/scripts/seed-county-data.js`
- `server/scripts/smoke-dashboard.mjs`
- `server/scripts/smoke-health.mjs`
- `server/scripts/smoke-trends.mjs`
- `server/scripts/test-windows.mjs`
- `server/scripts/validate-firebase-secret.mjs`
- `server/scripts/validate-openapi.js`
- `server/scripts/validate-windows.mjs`
- `server/scripts/verify_backfill_run.js`

### Deployment and container entry surfaces

- `docker-compose.dev.yml`
- `docker-compose.override.yml`
- `docker-compose.staging.yml`
- `Dockerfile.web`
- `server/Dockerfile`
- `render.yaml`
- `nginx/default.conf`

## Duplicate or Potentially Redundant Areas

### Clear archival duplication

- `backups/` is an explicit duplication zone containing saved iterations of components, hooks, and server files. It appears archival, not primary runtime code.

### Embedded subproject duplication

- `server/` contains its own `package.json`, `package-lock.json`, `.gitignore`, `.vscode`, Dockerfile, and even `.git` metadata. This makes it a nested subproject with duplicated project infrastructure inside the top-level repo.

### Nested server subtree

- `server/server/` appears redundant or at least structurally suspicious. The main backend already has `server/scripts/` and backend data folders, while `server/server/` contains another `data/` and `scripts/` path.

### Duplicate or mirrored executable names

- `scripts/seed-county-data.js` and `server/scripts/seed-county-data.js` share the same filename and likely overlapping intent.

### Artifact duplication

- `server/scripts/backfill_summary.json` and mirrored content under the nested `server/server` subtree suggest generated outputs are retained in more than one location.
- Root `scripts/` contains generated report artifacts like `categorical_fields_report.csv` and `categorical_fields_report.json`, which add noise alongside executable code.

### Intentional frontend/backend mirrors that still create maintenance risk

- `src/lib/buckets.js` and `server/src/lib/buckets.js`
- `src/hooks/dashboard.js` and `server/src/routes/dashboard.js`
- `src/hooks/checkins.js` and `server/src/routes/checkins.js`
- `src/hooks/messages.js` and `server/src/routes/messages.js`
- `src/hooks/cases.js` and `server/src/routes/cases.js`

These are not duplicates in the strict sense, but they represent mirrored concepts across client and server that can drift if not maintained together.

### Normal two-package duplication

- Root and backend each carry their own package files, env templates, Docker-related files, and ignore files. This is expected for a frontend-plus-backend workspace, but it increases maintenance surface area.

## Key Audit Notes

- The main structural complexity comes from three layers at once: the active frontend app, the embedded backend subproject, and the archival `backups/` layer.
- The most suspicious redundancy is `server/server/`, because it looks like a second nested operational subtree inside the backend project.
- The best documentation surface for workspace understanding in this repository is the root `docs/` directory.
- This audit is discovery-only. Redundant-looking files should not be deleted without checking imports, scripts, tasks, Docker references, and historical operational workflows.