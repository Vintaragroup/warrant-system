## Staging CI/CD

This repo includes a GitHub Actions workflow that:

- Builds the docker-compose staging stack (API + Web) locally in CI
- Waits for /api/health and runs smoke tests against API and Dashboard
- Builds and pushes server and web images to GHCR with ref and sha tags
- Optionally triggers Render deploys via API (if you provide service IDs and API key)

### Branches

- Push to `staging` runs the full pipeline. You can also run it manually via the Actions tab.

### Required secrets

Repository secrets (Settings → Secrets and variables → Actions):

- MONGO_URI_ATLAS: MongoDB Atlas connection string
- FIREBASE_ADMIN_JSON: Firebase admin JSON (used as a file for server in compose)
- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_APP_ID
- VITE_FIREBASE_MEASUREMENT_ID

Optional (for Render deploy triggers):

- RENDER_API_KEY: Render API token
- RENDER_API_SERVICE_API_ID: Service ID for API service
- RENDER_API_STATIC_WEB_ID: Service ID for static web service

### What the smokes do

- server/scripts/smoke-health.mjs → GET /api/health, /api/health/light, /api/docs.json
- server/scripts/smoke-dashboard.mjs → GET dashboard endpoints (/kpis, /new, /recent, /per-county, /diag)

The workflow fails fast if smokes fail. Logs are uploaded as an artifact on failure.

### Rollback strategy

- GHCR images are tagged by branch and by commit SHA; in Render you can roll back to a previous successful deploy or pin to a specific `ghcr.io/<owner>/<repo>/server@sha256:<digest>`.
- If you want auto-rollback in CI, add a follow-up job that calls Render’s deploy status API, and if unhealthy, triggers a deploy of the previous image tag.

### Local verification

- docker compose -f docker-compose.staging.yml up -d --build
- Open http://localhost:5173 for web, and http://localhost:8080/api/health for API
- Run smokes: `cd server && npm ci --omit=dev && npm run smoke:health && npm run smoke:dashboard`
