# Production Deployment Runbook (Render)

Last updated: 2025-09-29

This runbook brings the product public using Render’s onrender.com URLs (no custom domain required). We start with separate origins (SPA Static Site + API Docker Web Service) and will later migrate to single-origin via Nginx.

## Overview
- Current choice: Option B (temporary)
  - SPA: Render Static Site → gets an onrender.com URL
  - API: Render Web Service (Docker) → gets an onrender.com URL
  - SPA points to API via VITE_API_URL
  - API CORS allows SPA origin and sets cookies for cross-origin with credentials
- Later: Option A (single-origin)
  - SPA served via Nginx Docker
  - Nginx proxies /api to the API host → no cross-origin, simpler cookies

## Prereqs
- MongoDB Atlas connection string (MONGO_URI + optional MONGO_DB)
- Firebase project: Admin service account JSON
- GitHub repo connected to Render (render.yaml is in repo root)

## Step 1 — Provision API (Docker Web Service)
Render → New → Web Service → From repository
- Name: warrantdb-api (or similar)
- Runtime: Docker
- Dockerfile path: server/Dockerfile
- Context: server/
- Port: 8080 (auto-detected)
- Env vars (Environment tab):
  - NODE_ENV=production
  - MONGO_URI=…
  - MONGO_DB=warrantdb (optional)
  - WEB_ORIGIN=https://<your-spa>.onrender.com
  - FIREBASE_PROJECT_ID=<your-firebase-project-id>
  - GOOGLE_APPLICATION_CREDENTIALS=/opt/render/project/secrets/firebase.json
- Secret File: firebase.json (paste the admin JSON)
- Save & deploy

Verify after deploy
- Open <API_URL>/api/health → should return ok with db.status
- Open <API_URL>/api/docs → Swagger should load

Notes
- In production, cookies are set with SameSite=None; Secure=true.
- If you add more SPA origins (e.g., staging), set WEB_ORIGIN as a comma-separated list.

## Step 2 — Provision SPA (Static Site)
Render → New → Static Site → From repository
- Name: warrantdb-web (or similar)
- Build command: npm ci && npm run build
- Publish directory: ./dist
- Env vars:
  - VITE_API_URL=https://<your-api>.onrender.com
  - VITE_FIREBASE_API_KEY=<from Firebase web config>
  - VITE_FIREBASE_AUTH_DOMAIN=<from Firebase web config>
  - VITE_FIREBASE_PROJECT_ID=<from Firebase web config>
  - VITE_FIREBASE_APP_ID=<from Firebase web config>
  - VITE_FIREBASE_MEASUREMENT_ID=<from Firebase web config>
- Route rewrite:
  - Add rewrite /* → /index.html (Render’s Static Site UI supports this)
- Save & deploy

Verify after deploy
- Open <SPA_URL> → app loads; authentication UI available
- Open devtools Network → API calls go to <API_URL> with credentials included
- Log in → session cookie appears (Secure, SameSite=None)

## Step 3 — Firebase Authorized Domains
Firebase Console → Authentication → Settings → Authorized domains
- Add the SPA onrender.com domain
- If you use OAuth providers (Google/Apple), ensure their allowed redirect/callback URLs include the SPA domain

## Step 4 — MongoDB Atlas Allowlist
- If Atlas enforces IP allowlisting, add Render outbound IPs for the API service or use a credentialed public connection string
- Recheck <API_URL>/api/health

## Step 5 — Smokes (optional but recommended)
Use the existing scripts against production endpoints:
- Health: server/scripts/smoke-health.mjs --base <API_URL>
- Dashboard: server/scripts/smoke-dashboard.mjs --base <API_URL>/api/dashboard
Expected: 2xx responses; JSON with ok:true and non-zero counts when data exists

## Step 6 — Monitoring & Rollback
- Enable logs and set alerts on 5xx in Render
- Rollback:
  - Redeploy the previous successful build in Render, or
  - Retag and push the previous image (if CI/CD is wired to the registry)

Branching and Auto-deploys
- This repo includes render.yaml with branch set to deploy/production for both services.
- Auto-deploys are disabled by default in the blueprint; trigger deploys manually from Render or via a PR merge into deploy/production if you later enable it.

## Step 7 — Migrate to Single-Origin (later)
- Convert SPA to Nginx Docker using Dockerfile.web
- Configure nginx/default.conf to proxy /api → https://<your-api>.onrender.com
- Remove VITE_API_URL so the SPA defaults to same-origin /api
- Update WEB_ORIGIN to your custom SPA domain when you add it (HTTPS)

## Checklists

API (Docker)
- [ ] MONGO_URI set and connects to Atlas
- [ ] WEB_ORIGIN set to SPA onrender domain (comma-separated if multiple)
- [ ] Firebase admin JSON mounted as Secret File → GOOGLE_APPLICATION_CREDENTIALS points to it
- [ ] /api/health returns ok, /api/docs loads

SPA (Static)
- [ ] VITE_API_URL points to API onrender URL
- [ ] Rewrite /* → /index.html applied
- [ ] Firebase Authorized domains includes SPA domain
- [ ] Login works; cookies set; API calls succeed

Migration (later)
- [ ] Custom domains configured for SPA and/or API
- [ ] Option A enabled (single-origin via Nginx); VITE_API_URL removed
- [ ] WEB_ORIGIN updated to SPA custom HTTPS domain

Heads-up: Dev and staging remain unchanged. Production uses separate env vars and routes, so no impact.
