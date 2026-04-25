# Bail Bonds Dashboard Docker And Deployment Audit

Date: 2026-04-24
Scope: `Dockerfile.web`, `server/Dockerfile`, compose files, `render.yaml`, nginx config, and actual code entrypoints

## 1. What Service(s) Are Being Built?

### Built services

- `api`
  - built from [server/Dockerfile](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/server/Dockerfile)
- `web`
  - built from [Dockerfile.web](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/Dockerfile.web)

### Compose-only runtime variants

- `api-dev`
  - uses `node:20-alpine`
  - installs deps at container startup and runs dev server
- `web-dev`
  - uses `node:20-alpine`
  - installs deps at container startup and runs Vite dev server

### Pulled services only

- `mongo`
- `redis`
- `mailhog`

### Render deployment modes

- API: Docker web service using `server/Dockerfile`
- Web: Render Static Site using `npm ci && npm run build`

This repo supports two distinct deployment strategies for the frontend:

- Nginx container via `Dockerfile.web`
- Static-site hosting via Render

## 2. What Is The Container Actually Running?

### API container

- Docker CMD: `node src/index.js`
- Actual code entrypoint: [server/src/index.js](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/server/src/index.js)
- Behavior:
  - loads env files
  - starts Express API
  - mounts auth, dashboard, messaging, payments, enrichment proxy, and queue workers

### Web container

- Docker CMD: `nginx -g daemon off;`
- Build artifact source: Vite build from [src/main.jsx](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/src/main.jsx)
- Runtime behavior:
  - serves static SPA from Nginx
  - proxies `/api/` to `http://api:8080/api/` using [nginx/default.conf](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/nginx/default.conf)

### Dev containers

- `api-dev` runs `npm run dev` from the server package
- `web-dev` runs `npm run dev -- --host --port 5173`

## 3. Are There Mismatches Between Code Entry Point And Docker CMD?

### API container

No major CMD mismatch:

- `server/Dockerfile` runs `node src/index.js`
- that matches the actual backend entrypoint

### Web container

No direct CMD mismatch:

- `Dockerfile.web` builds the Vite app and serves it via Nginx

### Deployment-strategy mismatch

There is an important deployment split:

- Compose/Nginx mode expects `/api` proxying from Nginx to an internal `api` service
- Render production docs and `render.yaml` deploy the frontend as a static site, not via `Dockerfile.web`

That is not inherently wrong, but it means there are two materially different production strategies in the repo.

## 4. Any Inefficiencies Or Broken Steps?

### Likely broken steps

1. `Dockerfile.web` does not pass `VITE_STRIPE_PUBLISHABLE_KEY` as a build arg or environment variable.
   - [src/lib/stripeClient.ts](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/src/lib/stripeClient.ts) reads `import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY`
   - Compose and Dockerfile.web only pass Firebase and API vars
   - result: Stripe-enabled UI can silently build without the required publishable key

2. `docker-compose.dev.yml` and `docker-compose.staging.yml` mount `./public/env.js` into the web container unconditionally.
   - if that file does not exist, deployment or local startup can fail depending on host Docker behavior
   - docs describe `public/env.js` as optional, but Compose treats it like required

3. `render.yaml` static-site build uses `npm ci && npm run build`
   - [Dockerfile.web](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/Bail-Bonds-Dashboard/Dockerfile.web) explicitly uses `npm ci --legacy-peer-deps`
   - that means Render static deploy and Docker web deploy do not install the same way
   - if peer dependency resolution is the reason for `--legacy-peer-deps`, Render builds can fail while Docker builds succeed

### Inefficiencies

1. `api-dev` and `web-dev` run full npm installs on every container startup.
   - good for convenience, but slow and network-heavy
2. The repo supports multiple deployment modes for the frontend, which increases maintenance cost:
   - Nginx container
   - Vite dev server
   - Render static site
3. The frontend source uses version-pinned import specifiers resolved through Vite aliases.
   - not a Docker break by itself, but it makes builds more brittle across environments

## Missing Dependencies In Docker

### Missing build-time env dependency

- `VITE_STRIPE_PUBLISHABLE_KEY` is missing from:
  - `Dockerfile.web` build args
  - `docker-compose.dev.yml` static `web` build args
  - `docker-compose.staging.yml` web build args

This is the clearest missing deployment dependency.

### Runtime package dependencies

No obvious missing npm package dependency was found in the API Docker image for normal runtime operation.

## Anything That Would Break Deployment?

Yes.

### High-confidence risks

1. Stripe UI can be broken in Docker/static builds because `VITE_STRIPE_PUBLISHABLE_KEY` is not passed into the web build.
2. Render static builds can diverge from Docker web builds because one uses `--legacy-peer-deps` and the other does not.
3. Unconditional `public/env.js` bind mounts can break Compose startup when the file is absent.

### Structural risk

4. The repo documents both:
   - separate-origin Render static site + API
   - later single-origin Nginx proxy mode

Maintaining both strategies increases drift risk unless one is clearly declared primary.

## Corrected Docker Strategy

Recommended primary strategy:

1. Choose one production web deployment mode and treat the other as secondary.
   - if Render Static Site is primary, keep `Dockerfile.web` for local/demo use only
   - if Nginx is primary, align docs and deployment config around that mode

2. Add `VITE_STRIPE_PUBLISHABLE_KEY` everywhere the SPA is built.

3. Make the install strategy consistent across Docker and Render.
   - either both use `npm ci --legacy-peer-deps` or the dependency graph is cleaned up so neither needs it

4. Make `public/env.js` mount optional.
   - use an override file or document it as an optional profile instead of unconditional bind mounts

5. Keep `server/Dockerfile` minimal for runtime, but ensure docs clearly distinguish runtime image content from dev scripts.

Minimal corrected approach:

- API
  - continue using `server/Dockerfile`
  - run `node src/index.js`
- Web
  - build with `VITE_API_URL`, Firebase vars, and `VITE_STRIPE_PUBLISHABLE_KEY`
  - if using Nginx mode, keep `/api` proxy only for environments that actually have an `api` hostname
- Render
  - static-site build command should match Docker web dependency behavior

## Bottom Line

- The API container command matches the code.
- The biggest deployment defects are missing `VITE_STRIPE_PUBLISHABLE_KEY`, inconsistent install behavior between Docker and Render, and the optional `env.js` file being mounted as if it were mandatory.
- The broader issue is having two competing frontend deployment strategies without one clearly enforced as the primary path.