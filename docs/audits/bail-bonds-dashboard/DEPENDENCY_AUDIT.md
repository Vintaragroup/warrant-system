# Bail Bonds Dashboard Dependency Audit

Date: 2026-04-24
Scope: root frontend manifest, `server/package.json`, frontend imports, backend imports, and repo scripts

## Clean Dependency List

### Root `package.json`

Dependencies:

- `@radix-ui/react-accordion` `^1.2.3`
- `@radix-ui/react-alert-dialog` `^1.1.6`
- `@radix-ui/react-aspect-ratio` `^1.1.2`
- `@radix-ui/react-avatar` `^1.1.3`
- `@radix-ui/react-checkbox` `^1.1.4`
- `@radix-ui/react-collapsible` `^1.1.3`
- `@radix-ui/react-context-menu` `^2.2.6`
- `@radix-ui/react-dialog` `^1.1.6`
- `@radix-ui/react-dropdown-menu` `^2.1.6`
- `@radix-ui/react-hover-card` `^1.1.6`
- `@radix-ui/react-label` `^2.1.2`
- `@radix-ui/react-menubar` `^1.1.6`
- `@radix-ui/react-navigation-menu` `^1.2.5`
- `@radix-ui/react-popover` `^1.1.6`
- `@radix-ui/react-progress` `^1.1.2`
- `@radix-ui/react-radio-group` `^1.2.3`
- `@radix-ui/react-scroll-area` `^1.2.3`
- `@radix-ui/react-select` `^2.1.6`
- `@radix-ui/react-separator` `^1.1.2`
- `@radix-ui/react-slider` `^1.2.3`
- `@radix-ui/react-slot` `^1.1.2`
- `@radix-ui/react-switch` `^1.1.3`
- `@radix-ui/react-tabs` `^1.1.3`
- `@radix-ui/react-toggle` `^1.1.2`
- `@radix-ui/react-toggle-group` `^1.1.2`
- `@radix-ui/react-tooltip` `^1.1.8`
- `@stripe/react-stripe-js` `^2.4.0`
- `@stripe/stripe-js` `^4.1.0`
- `@tanstack/react-query` `^5.87.1`
- `class-variance-authority` `^0.7.1`
- `clsx` `^2.1.1`
- `cmdk` `^1.1.1`
- `embla-carousel-react` `^8.6.0`
- `firebase` `^11.10.0`
- `input-otp` `^1.4.2`
- `lucide-react` `^0.487.0`
- `next-themes` `^0.4.6`
- `react` `^19.1.1`
- `react-dom` `^19.1.1`
- `react-hook-form` `^7.55.0`
- `react-resizable-panels` `^2.1.7`
- `react-router-dom` `^7.8.2`
- `recharts` `^2.15.2`
- `sonner` `^2.0.3`
- `tailwind-merge` `^2.5.2`
- `vaul` `^1.1.2`
- `yargs` `^18.0.0`

Dev dependencies:

- `@apidevtools/swagger-parser` `^12.0.0`
- `@eslint/js` `^9.33.0`
- `@tanstack/react-query-devtools` `^5.87.3`
- `@testing-library/jest-dom` `^6.4.8`
- `@testing-library/react` `^15.0.0`
- `@testing-library/user-event` `^14.5.2`
- `@types/node` `^22.10.1`
- `@types/react` `^19.1.10`
- `@types/react-dom` `^19.1.7`
- `@vitejs/plugin-legacy` `^7.2.1`
- `@vitejs/plugin-react` `^5.0.0`
- `autoprefixer` `^10.4.21`
- `eslint` `^9.33.0`
- `eslint-plugin-react-hooks` `^5.2.0`
- `eslint-plugin-react-refresh` `^0.4.20`
- `globals` `^16.3.0`
- `jsdom` `^23.2.0`
- `postcss` `^8.5.6`
- `regenerator-runtime` `^0.14.1`
- `supertest` `^6.3.4`
- `tailwindcss` `^3.4.14`
- `terser` `^5.44.0`
- `typescript` `^5.7.2`
- `vite` `^7.1.2`
- `vitest` `^1.6.0`
- `whatwg-fetch` `^3.6.20`

### `server/package.json`

Dependencies:

- `bullmq` `^5.9.1`
- `cookie-parser` `^1.4.7`
- `cors` `^2.8.5`
- `dotenv` `^16.4.5`
- `express` `^4.19.2`
- `express-rate-limit` `^7.4.0`
- `firebase-admin` `^12.7.0`
- `helmet` `^7.1.0`
- `ioredis` `^5.4.1`
- `mongoose` `^8.6.4`
- `multer` `^2.0.2`
- `nanoid` `^4.0.2`
- `nodemailer` `^6.9.14`
- `stripe` `^14.0.0`
- `swagger-ui-express` `^5.0.1`
- `twilio` `^4.22.0`
- `yaml` `^2.8.1`
- `zod` `^3.23.8`

Dev dependencies:

- `@apidevtools/swagger-parser` `^10.1.1`
- `nodemon` `^3.1.0`

## Issues Found

### Likely unused or misplaced dependencies

- Root `yargs` appears misplaced rather than correctly scoped.
  - Import found in `server/scripts/backfill_bonds.js`
  - No root-side usage was found in `src/` or root `scripts/`
  - This should be a `server` dependency, not a root dependency.

- Root dev dependencies with no in-repo reference found during this scan:
  - `regenerator-runtime`
  - `terser`
  - `whatwg-fetch`

These may still be intentional, but no direct import or config reference was found in the reviewed source and build config.

### Duplicate dependencies

- `@apidevtools/swagger-parser` is declared in both manifests:
  - root: `^12.0.0`
  - server: `^10.1.1`

This is the clearest duplicate dependency in the repo.

### Potential version conflicts

- `@apidevtools/swagger-parser` is duplicated at materially different versions between root and server.
  - That is not guaranteed to break the app, but it is a real maintenance and behavior-drift risk.

- Source files under `src/components/ui/` import packages using version-pinned specifiers such as:
  - `cmdk@1.1.1`
  - `vaul@1.1.2`
  - `class-variance-authority@0.7.1`
  - `recharts@2.15.2`
  - `embla-carousel-react@8.6.0`
  - `next-themes@0.4.6`

Those currently match the root manifest versions, but they create a second source of truth. If `package.json` is updated later without updating the source imports, the repo can drift into subtle resolution failures.

### Missing dependencies based on imports

- `server/scripts/backfill_bonds.js` imports `yargs`, but `server/package.json` does not declare it.

This likely works only because the root install exposes `yargs` high enough in the parent tree for Node resolution. It should still be declared in `server/package.json` because the importing code lives there.

## Suggested Fixes

1. Move `yargs` from the root manifest to `server/package.json`.
2. Consolidate `@apidevtools/swagger-parser` to a single version strategy unless there is a deliberate compatibility reason for the split.
3. Remove unused root dev dependencies after a clean install-and-test pass if `regenerator-runtime`, `terser`, and `whatwg-fetch` are truly dead.
4. Replace version-pinned source imports like `package@version` with normal bare imports so `package.json` stays the single dependency source of truth.

## Bottom Line

- The repo’s largest concrete dependency issue is misplaced `yargs` plus a two-version split on `@apidevtools/swagger-parser`.
- Most runtime dependencies appear to be actively used.
- The other notable risk is dependency versions hardcoded directly inside frontend source imports.