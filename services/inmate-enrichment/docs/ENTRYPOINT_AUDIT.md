# Inmate Enrichment Entry Point Audit

Date: 2026-04-24
Scope: executable entry points, scheduler paths, container startup paths, and conflicting or likely-stale execution surfaces in `Inmate_enrichment`

## Primary Conclusion

The primary entry path for this workspace is:

1. Root script in `package.json`: `npm run stack:up`
2. Script implementation: `tools/ensure_stack.js`
3. Container orchestration: `docker-compose.yml`
4. Runtime services:
   - API container command: `node api/dist/index.js`
   - Worker container command: `node worker/dist/index.js`

This is the most complete and intended startup path because it:

- brings up Mongo, Redis, API, and worker together
- waits for Redis connectivity
- waits for API health
- is the path documented in `README.md`
- is also wired into the workspace task `api: up (stack:up)` in `.vscode/tasks.json`

## All Identified Entry Points

### Root package scripts

Defined in `package.json`:

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

### Service runtime entry files

- `api/src/index.ts`
  - main Express API process
  - serves `/health`, `/api/*`, and Swagger docs
- `worker/src/index.ts`
  - main BullMQ worker process
  - consumes queue jobs and runs the enrichment pipeline
- `web/index.html`
  - frontend entry shell for the Vite app

### Package-local script entry points

Defined in workspace package manifests:

#### `api/package.json`

- `build`: `tsc -p tsconfig.json`
- `dev`: `ts-node-dev --respawn --transpile-only src/index.ts`
- `test`: `jest`
- `lint`: `eslint .`

#### `worker/package.json`

- `build`: `tsc -p tsconfig.json`
- `dev`: `ts-node-dev --respawn --transpile-only src/index.ts`
- `test`: `jest`
- `lint`: `eslint .`

#### `shared/package.json`

- `build`: `tsc -p tsconfig.json`
- `dev`: `tsc -w -p tsconfig.json`
- `test`: `jest`
- `lint`: `eslint .`

#### `web/package.json`

- `dev`: `vite`
- `build`: `vite build`
- `preview`: `vite preview`

### Directly executed operational scripts

Root operational tooling under `tools/`:

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

### Tests as execution surfaces

- `jest.config.js`
- `tests/hcso_dob_parse.test.ts`
- `tests/hcso_status_parse.test.ts`
- `tests/match_normalize.test.ts`
- `tests/scoring.test.ts`
- `tests/timestamps.test.ts`

### Docker and container entry points

#### `docker-compose.yml`

Defines container startup for:

- `mongo`
- `redis`
- `api`
- `worker`
- `mongo-setup`

Container command and entrypoint surfaces:

- `api/Dockerfile`
  - `CMD ["node", "api/dist/index.js"]`
- `worker/Dockerfile`
  - `CMD ["node", "worker/dist/index.js"]`
- `docker-compose.yml`
  - `mongo-setup` uses an inline `entrypoint` bash command to initialize the Mongo replica set

### Workspace task entry points

Defined in `.vscode/tasks.json`:

- `Start docker compose (api, worker, redis, mongo)`
- `Docker compose up`
- `Docker compose up after fixes`
- `Docker compose up after clean rewrite`
- `api: up (stack:up)`
- `api: rebuild (stack:rebuild)`

## Schedulers, Cron Jobs, and Automatic Triggers

### In-app cron scheduler

- `api/src/sweep.ts`
  - uses `cron.CronJob`
  - schedules periodic auto-enrichment using `config.autoEnrichSweepCron`

Related configuration:

- `shared/src/config.ts`
  - default `AUTO_ENRICH_SWEEP_CRON` is `*/5 * * * *`

### Change-stream trigger

- `api/src/watcher.ts`
  - MongoDB change stream watches new subject inserts
  - auto-enqueues enrichment when records satisfy the 72-hour and bond rules

This is not cron-based, but it is a live automatic execution path.

### Queue-driven worker path

- `api/src/server.ts`
  - creates BullMQ queue `enrichment`
- `worker/src/index.ts`
  - creates BullMQ worker and `QueueEvents`
  - executes jobs through `runPipeline`

## 1. Which Entry Point Is the Primary One?

The primary entry point is `npm run stack:up` from the repo root.

Why this is primary:

- It is documented in `README.md` as the single-command startup path.
- It is wrapped by `tools/ensure_stack.js`, which does more than raw compose startup.
- It brings up the entire required stack rather than only one service.
- It performs readiness checks for Redis and API health.
- The workspace task `api: up (stack:up)` points at it directly.

The next-most-primary runtime file behind that wrapper is `api/src/index.ts`, because it starts the API process that exposes the visible service surface.

## 2. Which Ones Are Outdated or Unused?

### Strong likely stale or redundant path

- `tools/run_hcso_batch.js`
- `tools/run_hcso_batch.ts`

These appear to be overlapping versions of the same operational tool. Without evidence that both are intentionally used in different contexts, this is the clearest likely outdated-or-superseded pair.

### Likely older startup paths now secondary to `stack:up`

- Workspace tasks that run plain `docker compose up -d`:
  - `.vscode/tasks.json` → `Start docker compose (api, worker, redis, mongo)`
  - `.vscode/tasks.json` → `Docker compose up`
  - `.vscode/tasks.json` → `Docker compose up after fixes`
  - `.vscode/tasks.json` → `Docker compose up after clean rewrite`

These are not necessarily unused, but they are clearly weaker than `npm run stack:up` because they skip the explicit readiness checks in `tools/ensure_stack.js`.

### Duplicate task definitions

- `.vscode/tasks.json` contains repeated `api: rebuild (stack:rebuild)` entries.

This is not a runtime code path issue by itself, but it is a stale workspace-task duplication signal.

### Tooling likely active but specialized

Many `tools/report_*` and HCSO scripts look like niche operator utilities rather than outdated code. They should be treated as active unless usage data says otherwise.

## 3. Are There Conflicting Execution Paths?

Yes.

### Conflict A: raw compose vs health-aware wrapper

There are two competing ways to start the stack:

- direct `docker compose up -d`
- `npm run stack:up` → `tools/ensure_stack.js`

These conflict operationally because the second one is health-aware and the first one is not. Someone using the direct compose tasks may think the system is ready before Redis or API health is actually available.

### Conflict B: direct service dev vs compose-managed service runtime

There are separate service-local dev entry points:

- `api/package.json` → `dev`
- `worker/package.json` → `dev`
- `web/package.json` → `dev`

These can conflict with container-managed startup from `docker-compose.yml` if used simultaneously, especially around ports, local env values, Redis hostnames, and whether services connect to Docker-internal names or localhost.

### Conflict C: automatic enqueue paths overlap

There are two automatic enrichment entry mechanisms:

- change stream path in `api/src/watcher.ts`
- cron sweep path in `api/src/sweep.ts`

These are complementary by design, but they are still overlapping execution paths that can enqueue work for the same subjects unless idempotency and active-job checks behave correctly.

### Conflict D: duplicate HCSO batch runner implementations

- `tools/run_hcso_batch.js`
- `tools/run_hcso_batch.ts`

These are conflicting operator entry points for what appears to be the same task and should be consolidated or clearly differentiated.

## Bottom Line

- Primary entry point: `npm run stack:up`
- Primary visible runtime file: `api/src/index.ts`
- Primary background execution file: `worker/src/index.ts`
- Primary automatic scheduler: `api/src/sweep.ts`
- Main conflicting paths: raw compose tasks vs `stack:up`, direct local service dev vs compose runtime, and the dual `run_hcso_batch` implementations

## Recommendation

If this repo is being cleaned up later, the first places to review are:

1. `tools/run_hcso_batch.js` vs `tools/run_hcso_batch.ts`
2. duplicate `api: rebuild (stack:rebuild)` task entries in `.vscode/tasks.json`
3. whether raw `docker compose up -d` workspace tasks should be replaced with `npm run stack:up`