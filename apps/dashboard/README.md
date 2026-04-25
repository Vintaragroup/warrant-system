# Bail-Bonds Dashboard (UI + API)

This repository contains:
## Time Bucket Model (v2 Default)
The dashboard now uses a canonical time bucket taxonomy (`time_bucket_v2`) enabled by default:
`0_24h, 24_48h, 48_72h, 3d_7d, 7d_30d, 30d_60d, 60d_plus`.

To temporarily revert to legacy hour-diff logic set:

```bash
DISABLE_TIME_BUCKET_V2=true
```

Otherwise no flag is required—v2 is on by default.

## Adaptive Serialized Polling
Front-end polling of dashboard endpoints is consolidated into a single serialized loop (`useSerializedPolling`).
Each endpoint has a base interval; if returned data is unchanged the interval is multiplied (x2 at 3 stable cycles, x4 at 6, x8 at 12) and resets on change or tab visibility regain.
You can reset adaptive state via the Debug Panel (see below) or programmatically with `resetAdaptive()` from the provider.

## Debug Panel
Activate with `?debug=1` in the dashboard URL or set `window.__DASH_DEBUG__ = true` in the console.
Shows:
- Variant headers (fast path vs fallback) per endpoint
- Route metrics (count, errors, p95 latency, variant distribution)
- Adaptive meta table (multiplier, stable cycles, backoff, ETA)
- Manual reload & adaptive reset controls

## Scripts (Root)
```bash
npm run server:dev          # nodemon backend
npm run server:start        # production-style start
npm run validate:windows    # correctness validator vs Mongo
npm run smoke:dashboard     # quick KPI/top/new/recent sanity
npm run smoke:trends        # trends spans smoke (7,14,30)
```

## Validator Notes
`validate-windows.mjs` now expects v2 buckets; it fails if the API reports a legacy mode (which only happens if you explicitly set `DISABLE_TIME_BUCKET_V2=true`).

## Observability
- `/api/dashboard/metrics` exposes in-memory route timing & variant counts.
- Variant headers: `X-Top-Variant`, `X-New-Variant`, `X-Recent-Variant`, `X-PerCounty-Variant`, and `X-Path-Variant` (KPIs) allow fast-path validation.

## New: KPI 3–7d and Recent window
- API: `/api/dashboard/kpis` now includes `newCountsBooked.threeToSeven` (maps to `time_bucket_v2 = 3d_7d` or falls back to legacy when coverage is low).
- API: `/api/dashboard/recent` supports `?window=3d_7d` in addition to the default combined mode.
- UI: The third KPI card has a small toggle to switch between “48–72h” and “3–7d”.
- Health: `/api/health/buckets` summarizes `time_bucket_v2` distribution across simple_* for quick scraper alignment checks.

## New: CRM contact capture (address/phone)
- Schema: Cases now include optional CRM contact fields under `crm_details.address` `{ streetLine1, streetLine2, city, stateCode, postalCode, countryCode }` and `crm_details.phone`.
- Source mapping: When present on source records (e.g., simple_harris.address or `address_line_1`/`city`/`state`/`postal_code` and `phone`), these are backfilled into CRM on read, so existing records immediately surface contact details.
- Updates: `PATCH /cases/:id/crm` accepts `address` and `phone` updates; the UI will include them in enrichment defaults.
- Enrichment defaults: Whitepages lookups now default to CRM address/phone unless overridden in the form.

## Future Enhancements (Optional)
- Persist metrics snapshots.
- Expand aggregated provider to additional windows on demand.
- Add CI smoke run using the validator with a seeded fixture dataset.

# Bail-Bonds Dashboard (UI + API)

This repository contains:
- Frontend: React + Vite app under `src/`
- Backend API: Express + Mongoose under `server/`

Swagger UI: http://localhost:8080/api/docs (when the server is running)

For full server details (environment, troubleshooting, scripts), see `server/README.md`.

## Documentation

- `SCHEMA_CONTRACT.md` – data field contracts
- `WINDOW_CONTRACT.md` – canonical window semantics (design + mapping)
- `WINDOWS_V2_STATUS.md` – windows v2 migration status, validation snapshot, ops playbook

## Quick Start

1) Install dependencies

```bash
# Frontend deps
npm install

# Server deps
cd server && npm install && cd ..
```

2) Configure environment

```bash
# Frontend API base URL
cp .env.example .env   # if you want to customize VITE_API_URL

# Server Mongo connection
cp server/.env.example server/.env
# then edit server/.env and set MONGO_URI (and optionally MONGO_DB, PORT, WEB_ORIGIN)
```

3) Run

```bash
# Terminal A — start API server (with auto-restart)
cd server
npm run dev

# Terminal B — start frontend
cd ..
npm run dev
```

Frontend will typically be at http://localhost:5173 and proxy requests to the API at http://localhost:8080 via Vite's dev proxy (browser calls `/api`, Vite forwards to the API).

## Environment

Root `.env` (frontend):
- `VITE_API_URL` — default is `/api` for same-origin requests via Vite's proxy. If you are not using the proxy, set it to a full URL (e.g., `http://localhost:8080/api`).

Server `.env` (see `server/.env.example`):
- `MONGO_URI` — MongoDB connection string (Atlas or local)
- `MONGO_DB` — Database name (default: `warrantdb`)
- `PORT` — API server port (default: `8080`)
- `WEB_ORIGIN` — CORS origin for the UI (e.g., `http://localhost:5173`)
- `DASHBOARD_TZ` — Timezone for booking-day window (default: `America/Chicago`)

## Troubleshooting

- Port conflict (EADDRINUSE):
	```bash
	lsof -iTCP:8080 -sTCP:LISTEN -n -P
	kill -9 <pid>
	```
- DB errors / timeouts: ensure `MONGO_URI` is set and Atlas network access allows your host.
- Swagger not loading routes: ensure the server is running and browse to http://localhost:8080/api/docs.

### Optional: Minimal error overlay (debug only)
To surface top-of-page errors quickly on mobile, you can enable a minimal overlay banner. It’s off by default.

- Runtime env: set `DEV_ERROR_OVERLAY='true'` in `public/env.js` (or `env.example.js` -> copy to `env.js`).
- Or append `?dev_error_overlay=1` to the URL.

Note: Avoid enabling this permanently in production; it’s intended for short-term troubleshooting and does not display stack traces or PII.

---

## Mobile dev over LAN (iOS/Android)

When testing on a phone over Wi‑Fi, prefer same‑origin API calls so session cookies are first‑party on iOS.

- Compose dev stack exposes:
	- Web (Vite): http://<your-mac-ip>:5173
	- API: proxied via the web origin as `/api` (Vite forwards to the API container)
- Configuration:
	- `docker-compose.dev.yml` sets `VITE_API_URL=/api` and `VITE_PROXY_API_TARGET=http://api-dev:8080`
	- `vite.config.js` reads `VITE_PROXY_API_TARGET` and proxies `/api` to the API
- Why: iOS may treat third‑party cookies differently; using same‑origin avoids 401s after login.

Steps
1) Ensure phone and laptop are on the same Wi‑Fi
2) Start dev stack with the hotreload profile
3) On phone browser, open `http://<your-mac-ip>:5173`
4) Log in (mobile uses OAuth redirect flow)

Gotchas
- Firebase Auth → Authorized domains: add your LAN IP (e.g., `10.0.0.24`) to avoid provider warnings during dev
- Stripe.js warns about HTTP in dev; this is safe. For live, use HTTPS.
- Optional HTTPS locally: enable HTTPS in Vite if needed; proxy still applies.

### HTTPS dev (optional)
Enable HTTPS for local Vite to better mirror production or satisfy SDK requirements.

Quick start:
- Run with a self-signed cert generated by Vite:
	- `npm run dev:https`
- Provide your own certs (e.g., via mkcert):
	- Set environment variables when running: `DEV_HTTPS=true DEV_HTTPS_KEY=path/to/key.pem DEV_HTTPS_CERT=path/to/cert.pem npm run dev`

Notes:
- Server continues to proxy `/api` to the API target.
- If using mkcert, trust the local CA so iOS devices on LAN accept the cert.

## Original Vite README

Below is the original Vite starter content for reference.

### React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs) for Fast Refresh

#### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
