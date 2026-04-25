# Inmate Enrichment Package.json Audit

Date: 2026-04-24
Scope: root `package.json` plus workspace manifests in `api`, `worker`, `shared`, and `web`, compared against actual imports in `api/src`, `worker/src`, `shared/src`, `web/src`, and root `tools/`

## Observations

- This repo has five `package.json` files: root, `api`, `worker`, `shared`, and `web`.
- No declared package in these manifests is currently confirmed as formally deprecated by the npm registry.
- The main package hygiene issue is not deprecation or version conflict. It is manifest drift between declared workspace dependencies and actual imports, especially at the root `tools/` level.

## Declared Dependencies And DevDependencies

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
- `dotenv` `^16.4.5`
- `ioredis` `^5.4.1`
- `mongoose` `^8.6.0`
- `p-retry` `^6.2.0`
- `p-timeout` `^6.1.2`
- `zod` `^3.23.8`
- `dayjs` `^1.11.13`
- `uuid` `^9.0.1`
- `tslib` `^2.6.3`

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

## Comparison Against Actual Imports

### Root `tools/`

Root scripts directly import packages that are not declared in the root manifest:

- `mongodb`
- `mongoose`
- `dotenv`
- `dayjs`
- `axios`

This means the root script surface currently relies on workspace-hoisted dependencies instead of its own manifest.

### `api/src`

Confirmed imports found for:

- `axios`
- `bullmq`
- `cors`
- `cron`
- `express`
- `ioredis`
- `mongoose`
- `morgan`
- `swagger-ui-express`

No direct import found during this audit for:

- `dotenv`
- `zod`

### `worker/src`

Confirmed imports found for:

- `axios`
- `bullmq`
- `ioredis`
- `openai`

No direct import found during this audit for:

- `dotenv`
- `mongoose`

### `shared/src`

Confirmed imports found for:

- `dotenv`
- `mongoose`
- `dayjs`

No direct import found during this audit for:

- `axios`
- `bullmq`
- `ioredis`
- `p-retry`
- `p-timeout`
- `zod`
- `uuid`
- `tslib`

### `web/src`

Confirmed imports found for:

- `react`
- `react-dom`

## Unused Packages

Likely unused based on current direct imports:

- `api/package.json`
  - `dotenv`
  - `zod`
- `worker/package.json`
  - `dotenv`
  - `mongoose`
- `shared/package.json`
  - `axios`
  - `bullmq`
  - `ioredis`
  - `p-retry`
  - `p-timeout`
  - `zod`
  - `uuid`
  - `tslib`

Root manifest gap:

- the root package is missing runtime dependencies needed by its own `tools/*.js` scripts, so the cleaner result is not just removal. It also requires declaration fixes.

## Deprecated Packages

- No declared package in the reviewed `package.json` files is confirmed as formally deprecated by npm at audit time.

## Version Conflicts

- No active version conflict was found.
- Repeated packages such as `axios`, `bullmq`, `dotenv`, `ioredis`, `mongoose`, `typescript`, and `@types/node` are version-aligned across workspaces.
- The risk is future drift, not a current mismatch.

## Cleaned And Optimized Dependency List

### Recommended root `package.json`

Keep:

- `@types/jest`
- `jest`
- `ts-jest`

Add if root `tools/` stay in place:

- `axios`
- `dayjs`
- `dotenv`
- `mongodb`
- `mongoose`

### Recommended `api/package.json`

Keep:

- `@inmate/shared`
- `axios`
- `bullmq`
- `cors`
- `cron`
- `express`
- `ioredis`
- `mongoose`
- `morgan`
- `swagger-ui-express`

Remove if no hidden usage exists outside the audited files:

- `dotenv`
- `zod`

### Recommended `worker/package.json`

Keep:

- `@inmate/shared`
- `axios`
- `bullmq`
- `ioredis`
- `openai`

Remove if no hidden usage exists outside the audited files:

- `dotenv`
- `mongoose`

### Recommended `shared/package.json`

Keep:

- `dayjs`
- `dotenv`
- `mongoose`

Remove if no hidden usage exists outside the audited files:

- `axios`
- `bullmq`
- `ioredis`
- `p-retry`
- `p-timeout`
- `zod`
- `uuid`
- `tslib`

### Recommended `web/package.json`

Keep:

- `react`
- `react-dom`
- `@types/react`
- `@types/react-dom`
- `typescript`
- `vite`

## Suggested Fixes

1. Either declare root tool dependencies in the root manifest or move `tools/` into a proper workspace package.
2. Remove manifest entries with no direct import evidence after one narrow build-and-test pass.
3. Keep the shared repeated versions aligned if you retain the current workspace split.

## Bottom Line

- No confirmed deprecated packages.
- No present version conflicts.
- The biggest issue is root tooling depending on undeclared packages, followed by several likely-unused workspace dependencies.