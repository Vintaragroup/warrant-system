# Bail Bonds Dashboard Package.json Audit

Date: 2026-04-24
Scope: root `package.json`, `server/package.json`, and actual imports across frontend, backend, tests, and scripts

## Observations

- This repo has two `package.json` files: root and `server/package.json`.
- No declared package in these manifests is currently confirmed as formally deprecated by the npm registry.
- The strongest package hygiene issues are one misplaced dependency, one duplicated package at different versions, and a large set of version-pinned import specifiers inside frontend source files.

## Declared Dependencies And DevDependencies

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

## Comparison Against Actual Imports

Confirmed active usage from code/config:

- `@stripe/react-stripe-js`
- `@stripe/stripe-js`
- `@tanstack/react-query-devtools`
- `@testing-library/react`
- `@apidevtools/swagger-parser`
- `yargs`
- `firebase`
- `next-themes`
- `react-hook-form`
- `recharts`
- `vaul`
- `cmdk`
- `class-variance-authority`
- many `@radix-ui/*` packages
- many standard frontend build packages such as `tailwindcss`, `postcss`, `autoprefixer`, `jsdom`, and `supertest`

Source-level drift risk:

- many frontend files import version-pinned package specifiers directly, such as:
  - `embla-carousel-react@8.6.0`
  - `lucide-react@0.487.0`
  - `@radix-ui/react-label@2.1.2`
  - `react-hook-form@7.55.0`
  - `recharts@2.15.2`
  - `next-themes@0.4.6`
  - `vaul@1.1.2`
  - `cmdk@1.1.1`
  - `class-variance-authority@0.7.1`

That means the codebase is partially using import specifiers as a second dependency manifest.

## Unused Packages

Likely unused or misplaced based on current imports:

- Root dependency `yargs`
  - imported by `server/scripts/backfill_bonds.js`, not by root-side code
  - this is more accurately a misplaced dependency than a truly unused one

- Root dev dependencies with no direct usage found in the audited files:
  - `regenerator-runtime`
  - `terser`
  - `whatwg-fetch`

These may still be kept intentionally, but no direct import or config evidence was found during this audit.

## Deprecated Packages

- No declared package in the reviewed `package.json` files is confirmed as formally deprecated by npm at audit time.

## Version Conflicts

Confirmed version split:

- `@apidevtools/swagger-parser`
  - root: `^12.0.0`
  - server: `^10.1.1`

This is the clearest actual version conflict in the repo.

Additional drift risk:

- the version-pinned source imports in `src/components/ui/` can diverge from `package.json` even when package versions are updated correctly in the manifest.

## Cleaned And Optimized Dependency List

### Recommended root `package.json`

Keep runtime dependencies that are clearly imported by frontend code:

- all actively used `@radix-ui/*` packages
- `@stripe/react-stripe-js`
- `@stripe/stripe-js`
- `@tanstack/react-query`
- `class-variance-authority`
- `clsx`
- `cmdk`
- `embla-carousel-react`
- `firebase`
- `input-otp`
- `lucide-react`
- `next-themes`
- `react`
- `react-dom`
- `react-hook-form`
- `react-resizable-panels`
- `react-router-dom`
- `recharts`
- `sonner`
- `tailwind-merge`
- `vaul`

Move to `server/package.json`:

- `yargs`

Remove if not needed after a clean test/build pass:

- `regenerator-runtime`
- `terser`
- `whatwg-fetch`

### Recommended root dev dependencies

Keep:

- `@eslint/js`
- `@tanstack/react-query-devtools`
- `@testing-library/jest-dom`
- `@testing-library/react`
- `@testing-library/user-event`
- `@types/node`
- `@types/react`
- `@types/react-dom`
- `@vitejs/plugin-legacy`
- `@vitejs/plugin-react`
- `autoprefixer`
- `eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`
- `globals`
- `jsdom`
- `postcss`
- `supertest`
- `tailwindcss`
- `typescript`
- `vite`
- `vitest`

### Recommended `server/package.json`

Keep:

- all current runtime dependencies
- `nodemon`

Add:

- `yargs`

Align version:

- `@apidevtools/swagger-parser`

## Suggested Fixes

1. Move `yargs` to `server/package.json` because the importing code lives in `server/scripts/`.
2. Align `@apidevtools/swagger-parser` to one version strategy across root and server.
3. Replace `package@version` import specifiers in frontend source files with bare imports so `package.json` stays the single source of truth.
4. Remove `regenerator-runtime`, `terser`, and `whatwg-fetch` if a clean build and test run confirms they are dead.

## Bottom Line

- No confirmed deprecated packages.
- One real version conflict: `@apidevtools/swagger-parser`.
- One concrete manifest mistake: `yargs` belongs in `server/package.json`.
- The largest long-term maintenance risk is version-pinned imports inside the source tree.