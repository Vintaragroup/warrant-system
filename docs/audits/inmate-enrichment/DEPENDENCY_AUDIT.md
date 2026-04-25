# Inmate Enrichment Dependency Audit

Date: 2026-04-24
Scope: root workspace manifest, workspace package manifests, and import usage in `api`, `worker`, `shared`, `web`, `tests`, and `tools`

## Clean Dependency List

### Root `package.json`

Dev dependencies:

- `@types/jest` `^29.5.12`
- `jest` `^29.7.0`
- `ts-jest` `^29.2.5`

### `api/package.json`

Dependencies:

- `@inmate/shared` `*`
- `axios` `^1.7.7`
- `bullmq` `^5.12.6`
- `cors` `^2.8.5`
- `cron` `^3.3.1`
- `dotenv` `^16.4.5`
- `express` `^4.19.2`
- `ioredis` `^5.4.1`
- `mongoose` `^8.6.0`
- `morgan` `^1.10.0`
- `swagger-ui-express` `^5.0.1`
- `zod` `^3.23.8`

Dev dependencies:

- `@types/cors` `^2.8.19`
- `@types/express` `^4.17.21`
- `@types/morgan` `^1.9.10`
- `@types/node` `^20.11.30`
- `@types/swagger-ui-express` `^4.1.8`
- `ts-node-dev` `^2.0.0`
- `typescript` `^5.5.4`

### `worker/package.json`

Dependencies:

- `@inmate/shared` `*`
- `axios` `^1.7.7`
- `bullmq` `^5.12.6`
- `dotenv` `^16.4.5`
- `ioredis` `^5.4.1`
- `mongoose` `^8.6.0`
- `openai` `^4.57.0`

Dev dependencies:

- `@types/node` `^20.11.30`
- `ts-node-dev` `^2.0.0`
- `typescript` `^5.5.4`

### `shared/package.json`

Dependencies:

- `axios` `^1.7.7`
- `bullmq` `^5.12.6`
- `dayjs` `^1.11.13`
- `dotenv` `^16.4.5`
- `ioredis` `^5.4.1`
- `mongoose` `^8.6.0`
- `p-retry` `^6.2.0`
- `p-timeout` `^6.1.2`
- `tslib` `^2.6.3`
- `uuid` `^9.0.1`
- `zod` `^3.23.8`

Dev dependencies:

- `@types/node` `^20.11.30`
- `typescript` `^5.5.4`

### `web/package.json`

Dependencies:

- `react` `^18.3.1`
- `react-dom` `^18.3.1`

Dev dependencies:

- `@types/react` `^18.2.66`
- `@types/react-dom` `^18.2.22`
- `typescript` `^5.5.4`
- `vite` `^5.4.0`

## Issues Found

### Likely unused dependencies

Based on direct imports found in source:

- `api/package.json`
  - `dotenv`: no direct import found under `api/src`; environment loading is handled in `shared/src/config.ts`
  - `zod`: no direct import found under `api/src`
- `worker/package.json`
  - `dotenv`: no direct import found under `worker/src`; environment loading is handled in `shared/src/config.ts`
  - `mongoose`: no direct import found under `worker/src`
- `shared/package.json`
  - `axios`: no direct import found under `shared/src`
  - `bullmq`: no direct import found under `shared/src`
  - `ioredis`: no direct import found under `shared/src`
  - `p-retry`: no direct import found under `shared/src`
  - `p-timeout`: no direct import found under `shared/src`
  - `uuid`: no direct import found under `shared/src`
  - `zod`: no direct import found under `shared/src`

### Missing or undeclared dependencies

Root-level tooling under `tools/` directly imports packages that are not declared in the root manifest:

- `mongodb`: used by `tools/backfill_location.js`, `tools/enrich_related_parties_pipl.js`, and `tools/upsert_name_relations.js`
- `mongoose`: used by many root `tools/*.js`
- `dotenv`: used by many root `tools/*.js`
- `dayjs`: used by multiple root `tools/*.js`
- `axios`: used by `tools/validate_related_phones.js`

These scripts likely work today only because npm workspaces hoist dependencies into the root `node_modules`. That is operationally fragile: the root package does not declare the runtime dependencies its own scripts import.

### Duplicate dependencies

The same runtime packages are repeated across multiple workspace manifests:

- `axios` in `api`, `worker`, and `shared`
- `bullmq` in `api`, `worker`, and `shared`
- `dotenv` in `api`, `worker`, and `shared`
- `ioredis` in `api`, `worker`, and `shared`
- `mongoose` in `api`, `worker`, and `shared`
- `typescript` and `@types/node` repeated across `api`, `worker`, `shared`, and `web`
- `ts-node-dev` repeated across `api` and `worker`

These are version-aligned today, so this is not a current breakage, but it does increase maintenance overhead.

### Potential version conflicts

No active version conflict was found in the manifests reviewed.

The duplicated packages listed above all use aligned versions across workspaces, which is good. The main risk here is future drift rather than a present conflict.

## Suggested Fixes

1. Move root `tools/` into a dedicated workspace package, or declare their runtime dependencies in the root `package.json` so the scripts are not relying on hoisting.
2. Remove likely-unused direct dependencies from `api`, `worker`, and `shared` after one install-and-test pass.
3. Consider centralizing shared runtime dependencies in fewer workspace manifests if those packages are intentionally consumed through `@inmate/shared`.
4. Keep duplicated dependency versions synchronized if you retain the current multi-manifest layout.

## Bottom Line

- The repo does not show a hard version conflict.
- The biggest real problem is undeclared root tooling dependencies relying on hoisted installs.
- The next cleanup target is likely-unused package sprawl in `shared`, plus `dotenv` and `zod` in `api`, and `dotenv` and `mongoose` in `worker`.