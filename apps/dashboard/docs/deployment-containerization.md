# Deployment & Containerization Guide

_Last updated: 2025-09-28_

See also: the “2025-09-28 Integration Fix Log — Firebase + Mongo data visible in Frontend” section in `authentication-integration.md` for the finalized runtime env.js loader, API base resolution, cookie posture, and verification steps.

## 1. Objectives
- Provide a repeatable way to run the full stack (Node API, React front-end, supporting services) in development, staging, and production.
- Support rapid iteration in a dev sandbox without risking production stability.
- Enable CI/CD pipelines that build, scan, test, and promote immutable container images.
- Document onboarding steps so new engineers can run the stack locally and deploy with confidence.

## 2. System Overview
| Component | Tech | Responsibility | Notes |
| --- | --- | --- | --- |
| Front-end | React + Vite | Authentication UI, dashboard, admin tooling | Served via Node/Express or a static CDN in production |
| API | Node.js (Express) | REST endpoints (`/api/*`), auth middleware, MongoDB access, Firebase admin | Depends on MongoDB Atlas + Firebase project |
| Database | MongoDB Atlas | Case data, users, auth audit | External managed service |
| Identity | Firebase Auth | User records, SSO providers, ID tokens | Require service account credentials |
| Observability | TBD | Logs, metrics, traces | Placeholder until platform selected |

## 3. Containerization Strategy
1. **Base Images**
   - API: `node:20-alpine` (or company base image). Includes production dependencies only.
   - Front-end: Build with `node:20-alpine`, serve via `nginx:alpine` or Express static hosting. Decide on SSR vs. static.
2. **Multi-stage builds**
   - Stage 1: install deps (respecting `package-lock.json`), run lints/tests.
   - Stage 2: copy built assets only.
3. **Runtime configuration**
   - Environment variables provided via `.env` files in dev, secrets store in staging/prod.
   - Mount Firebase service-account JSON as secret (Kubernetes secret, AWS Secret Manager, etc.).
4. **Image tagging**
   - `asap-bail-books-api:<git-sha>` and `asap-bail-books-web:<git-sha>`.
   - Promote by retagging to `:staging` and `:prod` after validation.

## 4. Local Development (Docker Compose)
The repository includes `docker-compose.dev.yml` wired for a rapid local loop:

```yaml
version: '3.9'
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
  api:
    build:
      context: ./server
      dockerfile: Dockerfile
    environment:
      - PORT=8080
      - NODE_ENV=development
      - MONGO_URI=mongodb://mongo:27017
      - MONGO_DB=warrantdb
      - WEB_ORIGIN=http://localhost:5173
    volumes:
      - ./server/src:/app/src
      - ./server/src/openapi.yaml:/app/openapi.yaml
    ports:
      - "8080:8080"
    depends_on:
      - mongo
    command: node src/index.js
  web:
    build:
      context: .
    
      dockerfile: Dockerfile.web
    ports:
      - "5173:80"
    depends_on:
      - api
volumes:
  mongo-data:
```

Quick start:
- Dev up (foreground): `npm run compose:dev:up`
- Dev down (remove volumes): `npm run compose:dev:down`

Notes:
- The dev stack serves the built SPA via Nginx on http://localhost:5173 and the API on http://localhost:8080
- If you prefer Vite hot reload, run `npm run dev` outside of Compose for the web app.
- In dev, Firebase emulators can be added later; for now, use test credentials or mocked flows as documented.

### Quickstart: Docker Staging (local)
Run the production-like stack locally with minimal env:

```sh
# Required env in your shell
export MONGO_URI="<your Mongo connection string>"
export WEB_ORIGIN="http://localhost:5173"
# Optional (defaults to warrantdb)
export MONGO_DB="warrantdb"

# Ensure Firebase admin secret exists
ls ./.secrets/*firebase*.json

# Bring up staging stack (detached)
npm run compose:staging:up

# Tear down
npm run compose:staging:down
```

Endpoints:
- API: http://localhost:8080 (Swagger at /api/docs)
- Web: http://localhost:5173

Validate with the PR and Staging Verification checklists below.

Firebase (SPA) build-time env
- The SPA reads Firebase config from Vite env vars at build time. Set these in your shell before building the `web` image, or define them in an `.env` file that Compose will read:

Required
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Optional
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_API_URL` (defaults to http://localhost:8080 in dev Compose)

Compose passes these as build args to `Dockerfile.web`. If they are missing, the SPA will log a clear error and Firebase auth will fail with `[auth/invalid-api-key]`.

Runtime env.js (optional)
- To avoid rebuilding the web image just to tweak environment values, you can supply a runtime file served at `/env.js`.
- Copy `public/env.example.js` to `public/env.js` and fill in values. The app will prefer `window.__ENV__.*` when present.
- This is useful for local testing but avoid committing real secrets.

Compose override to mount env.js (optional)
Create `docker-compose.override.yml` with:

```yaml
services:
  web:
    volumes:
      - ./public/env.js:/usr/share/nginx/html/env.js:ro
```

Then run your usual compose command. If `public/env.js` exists, the SPA will load it before initialization and use `window.__ENV__` values.

## 5. Production Deployment Workflow
1. **Build phase** (CI)
   - Install dependencies (`npm ci` front-end & server).
   - Run `npm run lint`, `npm run test`, `npm run build`.
   - Docker build for API & front-end (multi-stage, no dev deps).
   - Scan images (Trivy/Grype) and fail build on critical vulns.
   - Generate SBOM (Syft) for each image.
2. **Release artifacts**
   - Push images to registry (e.g., GHCR, ECR, GCR) and sign with cosign/notary for provenance.
   - Publish SBOM + vulnerability report alongside build artifacts for audit trail.
3. **Staging deployment**
   - Apply Kubernetes manifest or ECS task definition referencing new tags.
   - Run smoke tests (Cypress API checks, health endpoints, login).
   - Verify observability hooks (logs/metrics).
4. **Promotion**
   - Gate via approval.
   - Retag images to `:prod` and deploy to production cluster.
   - Run post-deploy validation + rollback plan (previous tag).

### 5.4 Optional: Render.com Deployment (Blueprint)
We include a `render.yaml` Blueprint to provision a Render web service for the API (Docker) and a static site for the SPA.

Steps:
1. Ensure `render.yaml` is in the repo root (it is).
2. Commit & push to the branch you intend to link for the Blueprint.
3. In the Render dashboard: New → Blueprint → Connect your repo → Choose the branch → Apply.
4. Set required environment variables and a Secret File for Firebase in the dashboard:
  - API env vars: `MONGO_URI` (required), `MONGO_DB` (optional), `WEB_ORIGIN` (required), `FIREBASE_PROJECT_ID` (required)
  - Secret File: create `firebase.json` with your Firebase admin JSON and it will mount to `/opt/render/project/secrets/firebase.json`. Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to this path.
  - SPA env var: `VITE_API_URL` → set to your API public URL (e.g., `https://warrantdb-api.onrender.com`)
5. Verify routes:
  - SPA includes a rewrite rule in the Blueprint to route all paths to `/index.html` (client-side routing).
6. Optional: Add custom domain(s) in Render and configure DNS; set correct `WEB_ORIGIN`.

Notes:
- The API uses the Dockerfile at `server/Dockerfile` and builds from `server/` context.
- The SPA builds with `npm ci && npm run build` and publishes `dist/`.
- For Atlas, allowlist Render’s outbound IPs or use a public connection string with proper auth.
- You can switch the SPA to an image-based web service by changing runtime to `docker` and using `Dockerfile.web` if you prefer Nginx.

### 5.5 Render Staging Checklist (copy/paste)

1) Repository and Blueprint
- [ ] Repo connected in Render
- [ ] Branch selected: infra/containerization-YYYY-MM-DD (or main)
- [ ] `render.yaml` applied without errors

2) API Web Service (Docker runtime)
- [ ] Context: `server/`, Dockerfile: `server/Dockerfile`
- [ ] Env vars set: `MONGO_URI`, `WEB_ORIGIN`, `FIREBASE_PROJECT_ID`, optional `MONGO_DB`
- [ ] Secret File created: Name `firebase.json` with Firebase admin JSON
- [ ] `GOOGLE_APPLICATION_CREDENTIALS` set to `/opt/render/project/secrets/firebase.json`
- [ ] Deployment succeeded, health check green

3) SPA Static Site
- [ ] Build command `npm ci && npm run build`
- [ ] Publish path `./dist`
- [ ] Env var `VITE_API_URL` set to API public URL
- [ ] Rewrite rule /* → /index.html present

4) Atlas/Networking
- [ ] Atlas IP allowlist updated for Render outbound IPs (or use public connection string with auth)
- [ ] Verify API can connect to MongoDB Atlas

5) Validation
- [ ] Open Swagger: <API_URL>/api/docs
- [ ] GET <API_URL>/api/health returns 200 and ok: true
- [ ] Open SPA: <SPA_URL>/ and a non-existent route → both 200 (fallback)

6) Post-setup
- [ ] Save URLs and environment details to this doc
- [ ] Create tag `baseline/staging-verified-YYYY-MM-DD` after validation

### 5.1 Branching & Release Management
- Branch naming:
  - Feature work: `feature/<short-scope>`
  - Infrastructure/containerization: `infra/containerization-<YYYY-MM-DD>`
- PR flow:
  - Always open a PR to merge into the integration branch or `main`.
  - Require review from Dev + Ops for infra changes.
- Tagging conventions:
  - `baseline/last-known-good-<YYYY-MM-DD>`: points to `main` prior to a rollout.
  - `baseline/staging-verified-<YYYY-MM-DD>`: after staging validation completes.

Commands:
```sh
# Create an annotated baseline tag pointing to main
git fetch origin
git tag -a baseline/last-known-good-$(date +%F) origin/main \
  -m "baseline: last-known-good prior to rollout ($(date +%F))"
git push origin baseline/last-known-good-$(date +%F)

# After staging verification completes
git tag -a baseline/staging-verified-$(date +%F) HEAD \
  -m "baseline: staging verified ($(date +%F))"
git push origin baseline/staging-verified-$(date +%F)
```

### 5.2 Rollback Procedures
If the deployment introduces regressions, use the most recent baseline tag.

Option A — Git rollback and redeploy (Compose-based staging):
```sh
# Return repo to last-known-good and bring up staging stack
git fetch --tags
git checkout baseline/last-known-good-YYYY-MM-DD
npm run compose:staging:down
npm run compose:staging:up
```

Option B — Re-deploy images (CI/CD-managed):
- Retag previous known-good images to `:staging`/`:prod` and redeploy via your orchestrator.
- Keep image SBOM and signature verification enabled.

### 5.3 PR Checklist (Infra/Containerization)
- Docs updated in `docs/deployment-containerization.md` (sections touched listed in PR).
- OpenAPI validates and bundles successfully.
- Compose files pass a basic sanity check and services start.
- Smoke tests pass against local/staging environment.
- No secrets committed; `.env` and `.secrets` patterns respected.

Helpful commands:
```sh
# Validate and bundle OpenAPI
node server/scripts/validate-openapi.js server/src/openapi.yaml --out server/src/openapi.bundle.json

# Local dev stack (foreground) / teardown
npm run compose:dev:up
npm run compose:dev:down

# Staging stack (detached) / teardown
npm run compose:staging:up
npm run compose:staging:down

# API smoke checks
npm run smoke:dashboard
npm run smoke:trends
```

## 6. Environment Configuration
- **Common variables**
  - `NODE_ENV`, `PORT`, `MONGO_URI`, `MONGO_DB`, `SESSION_SECRET`.
  - `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (path or JSON), `WEB_ORIGIN`.
  - Front-end `VITE_API_URL`, `VITE_FIREBASE_*` keys.
- **Secrets Management**
  - Dev: `.env` checked into repo with sample values (`.env.example`).
  - Staging/Prod: use secret manager (AWS Parameter Store, GCP Secret Manager) or Kubernetes Secrets.
  - Rotate service-account keys periodically; prefer Workload Identity over static keys if policy allows.
  - Enforce least-privilege IAM bindings for Firebase admin, Mongo Atlas, and CI/CD service accounts; document approvals.

Staging Compose specifics (`docker-compose.staging.yml`):
- Expects environment variables: `MONGO_URI`, `MONGO_DB` (optional, defaults to `warrantdb`), `WEB_ORIGIN`.
- Expects a Firebase admin JSON secret at `./.secrets/firebase-admin.json` (mounted into the API as a Docker secret at `/run/secrets/firebase`).
- Start/stop:
  - Up (detached): `npm run compose:staging:up`
  - Down: `npm run compose:staging:down`

## 7. Testing & Quality Gates
- **Unit/Integration Tests**
  - API: Jest/Supertest or Vitest to cover auth flows, role checks, metadata endpoints.
  - Front-end: React Testing Library for auth context, Cypress for end-to-end login flows.
- **Security Checks**
  - Dependency scanning (npm audit, Snyk).
  - Container vulnerability scan (Trivy, Grype).
  - Lint for secret leaks (gitleaks) before merge.
  - Verify image signatures and archive SBOM attestation to support SOC2 evidence requests.
- **Performance**
  - Optional load tests on `/api/dashboard` and login endpoints.

### 7.1 Staging Verification Checklist
- API health: `GET /api/health` (if present) responds 200 and includes commit/version.
- Swagger docs: `/api/docs` loads, Checkins endpoints are present and examples render.
- Auth: Can log in with a staging user; Firebase project matches environment.
- Dashboard: Non-zero counts for expected windows; no 24–48h zero anomalies.
- Checkins: Create/list/update basic happy path works.
- Payments (if applicable): Test card flow on test keys succeeds.
- Logs: No error spam; expected metrics/headers present in responses.

### 7.2 Local Docker validation log — 2025-09-28

Environment
- Stack: `docker-compose.dev.yml` (API http://localhost:8080, Web http://localhost:5173)

API
- GET `/api/health` → 200 OK; payload includes `{ ok: true, db.status: "ok" }`
- GET `/api/docs.json` → 200 OK; Checkins tag present with list/create/update endpoints

Web
- GET `/` → 200 OK (SPA served by Nginx)
- GET `/does/not/exist` → 200 OK (SPA fallback to index.html confirmed)

Notes
- Dev Mongo mapped to host 27018 to avoid a local 27017 port conflict
- SPA build uses `npm ci --legacy-peer-deps` due to `@stripe/react-stripe-js` peer range with React 19
- API provided `GOOGLE_APPLICATION_CREDENTIALS` via Compose secret for Firebase initialization

Quick: View in browser (Docker)
- Dev compose: Web → http://localhost:5173, API → http://localhost:8080 (Swagger at /api/docs)
- Staging compose: Same URLs by default unless you change port mappings
- No local servers needed—containers serve both the SPA and API

## 8. Onboarding Checklist
1. Install prerequisites (Docker, Node, npm, Firebase CLI).
2. Clone repo, run `npm install` at root and `npm install` in `server/`.
3. Copy `.env.example` files and set local credentials.
4. Start Docker Compose (`docker compose up api web mongo`).
5. Seed initial SuperUser (existing script in `server/scripts/create-firebase-user.mjs`).
6. Verify front-end at `http://localhost:5173` and API docs at `http://localhost:8080/api/docs`.

## 9. Security & Compliance Considerations
- Maintain policy-aligned change management: feature branches → PR review → CI evidence stored (build logs, test results).
- Keep infrastructure-as-code (Terraform/Helm) versioned for auditability; record deploy approvals (aligns with SOC2 CC7/CC8).
- Centralize logs/metrics with retention policies that satisfy SOC2/GDPR needs; enable immutable auth audit logging exports.
- Enforce MFA on all privileged accounts (Firebase Console, Mongo Atlas, CI/CD, registry) and document rotation cadence for secrets.
- Run scheduled vulnerability assessments/penetration tests; track remediation through ticketing with due dates.
- Document disaster recovery (Mongo snapshots, Firebase export strategy) and rehearse at least annually.
- Ensure vendor risk assessments for Firebase, MongoDB Atlas, hosting provider, and any third-party auth plugins are current.

## 10. Outstanding Decisions
- Choose hosting target: Kubernetes (GKE/EKS), ECS Fargate, or managed PaaS (Render, Fly.io).
- Observability stack (Datadog, Grafana/Loki, OpenTelemetry collector).
- CDN strategy for front-end assets (CloudFront, Cloudflare) vs. Express static serving.
- Blue/green vs. rolling update strategy for API.

## 11. CI/CD Roadmap (Initial)

Targets
- Build and test on every PR and push to main
- Build Docker images for API and Web, scan, and optionally push when secrets are configured

Proposed workflow (GitHub Actions)
1) Triggers
   - On pull_request to main; on push to main and tags
2) Jobs
   - Setup Node (use .nvmrc or Node 20)
   - Cache npm with lockfiles
   - Lint & test
     - Root `npm run lint` (if configured) and `npm test` / `npm run test -w server`
   - Build
     - Web: `npm ci && npm run build` (root)
     - API: `npm ci` in `server/` and run minimal build/validate (OpenAPI validation)
   - Docker
     - Build API image from `server/Dockerfile`
     - Build Web image from `Dockerfile.web`
     - Scan with Trivy/Grype (fail on CRITICAL)
   - Publish (conditional)
     - If `secrets.REGISTRY_USER` and `secrets.REGISTRY_TOKEN` present, login and push tags:
       - `asap-bail-books-api:${{ github.sha }}` and optional `:staging` on protected branches
       - `asap-bail-books-web:${{ github.sha }}` and optional `:staging`

Registry config (example: GHCR)
- Create GitHub Actions secret `REGISTRY` = ghcr.io
- `REGISTRY_USER` = `${{ github.actor }}`
- `REGISTRY_TOKEN` = Personal Access Token (write:packages) or `GITHUB_TOKEN` with proper permissions
- Image names: `ghcr.io/<org>/asap-bail-books-api` and `ghcr.io/<org>/asap-bail-books-web`

Next steps
- Add `.github/workflows/ci.yml` implementing the above with conditional publish
- Add Trivy (aquasecurity/trivy-action) or Grype (anchore/scan-action)
- Optionally add Cypress smoke job that hits deployed staging URLs after publish

---
_Primary owners: DevOps + Application Engineering. Update this doc as infrastructure decisions solidify._

## Appendix: Change Log (Containerization)

- 2025-01-15
  - Added Dockerfiles for API (`server/Dockerfile`) and SPA (`Dockerfile.web`).
  - Added Nginx config for SPA routing (`nginx/default.conf`).
  - Added Compose stacks for dev and staging (`docker-compose.dev.yml`, `docker-compose.staging.yml`).
  - Added npm scripts to run compose flows from root package.json.
  - Documented environment variables and secret mounting for staging.

- 2025-09-28
  - Added unauthenticated health smoke (`server/scripts/smoke-health.mjs`) and npm script `server/smoke:health`.
  - Enhanced authenticated dashboard smoke (`server/scripts/smoke-dashboard.mjs`) to accept bearer/cookie and optional Firebase sign-in.
  - Documented smoke usage and options in `server/README.md`.
  - Validated dev Docker stack locally: `/api/health` OK, `/api/docs` OK, SPA served at http://localhost:5173.
  - Added branching, tagging, rollback procedures, PR and staging verification checklists.
