# Bail-Bonds Server (API)

Express + Mongoose API powering the dashboard. Ships with:
- Swagger UI at /api/docs
- Resilient DB timeouts and safe fallbacks
- Liveness endpoint that works without Mongo
 - Enrichment proxy at /api/enrichment/* forwarding to external enrichment service

## Requirements
- Node.js >= 18.17 (tested with Node 20/22/24)
- MongoDB Atlas (or any MongoDB) connection string

## Environment
Create a .env file in this server folder (next to this README) based on the template below.

Recognized variables:
- MONGO_URI — Mongo connection string (e.g., mongodb+srv://user:pass@cluster/db)
- MONGO_DB — Database name (default: warrantdb)
- PORT — HTTP port (default: 8080)
- WEB_ORIGIN — CORS allowlist origin (default: /^http:\/\/localhost:\\d+$/)
- DASHBOARD_TZ — Timezone used for booking-day windows (default: America/Chicago)
- REDIS_URL — Redis connection string for BullMQ queues (default: redis://localhost:6379/0)
- QUEUE_HEARTBEAT_MS, MESSAGING_QUEUE_CONCURRENCY — Optional queue tuning knobs
- CHECKINS_GPS_INTERVAL_MINUTES — Minutes between auto-scheduled GPS pings in dev/test (default: 5)
- FIREBASE_PROJECT_ID — Firebase Admin project id (production)
- GOOGLE_APPLICATION_CREDENTIALS — Path to Firebase Admin credentials file (e.g., /opt/render/project/secrets/firebase.json on Render)
- TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID — Twilio Programmable Messaging credentials
- TWILIO_STATUS_CALLBACK_URL, TWILIO_WEBHOOK_AUTH_TOKEN — Optional overrides for webhook URL/signature validation
- SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS — SMTP settings to send invitation emails (optional)
- EMAIL_FROM — From-address used in invite emails (optional)
- WHITEPAGES_API_KEY — API key used for manual Whitepages enrichment lookups
- ENRICHMENT_PROVIDERS — comma-separated list of enabled enrichment providers (e.g., `pipl,whitepages`)
- PIPL_API_KEY — API key used for Pipl enrichment lookups
 - APP_NAME — App name used in invite subject/body (optional)
 - ENRICHMENT_API_URL — Base URL of the external enrichment service (proxy target), e.g., http://localhost:4000
 - ENRICHMENT_PROXY_TIMEOUT_MS — Timeout in ms when proxying to the enrichment service (default 10000)

Notes:
- The server also reads environment from the repo root .env (for convenience), but server/.env takes precedence during development.
- Multiple env names for the URI are supported: MONGO_URI (preferred), MONGODB_URI, MONGO_URL, ATLAS_URI, DATABASE_URL.

## Quick start

1) Install dependencies

```bash
cd server
npm install
```

2) Configure environment

```bash
cp .env.example .env
# Edit .env and set MONGO_URI (and optionally MONGO_DB, PORT, WEB_ORIGIN)
```

3) Run the server

- Development (auto-restart):
```bash
npm run dev
```
- Normal start:
```bash
npm run start
```

4) Verify it’s up

- Liveness (no DB required):
```bash
curl -s http://localhost:8080/api/health/light | jq
```
- Full health (needs Mongo):
```bash
curl -s http://localhost:8080/api/health | jq
```
- Swagger UI:
```
http://localhost:8080/api/docs

## Invites email setup

To send invite emails automatically, configure SMTP:

- Locally (recommended): run MailHog and point the server to it
	- If you use docker-compose with the "hotreload" profile, MailHog is included (SMTP at mailhog:1025, Web UI at http://localhost:8025)
	- Otherwise, install MailHog and run it, then in `server/.env` set:
		- `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_SECURE=false`, `EMAIL_FROM=no-reply@localhost`

- Staging/Production: set real SMTP credentials via your platform secret manager
	- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
	- Optional: `APP_NAME` for branding in subject/body

If SMTP is not configured, the API will still generate an invite link and return it to the client; the UI shows a copyable link instead of email-sent.
```

## Behavior & reliability
- If Mongo is slow or unreachable, DB endpoints fail fast with 503; they won’t hang or crash the process.
- The liveness endpoint /api/health/light always returns 200 while the process is up (no DB calls).
- All heavy Mongo calls use maxTimeMS + a small Promise timeout wrapper.
- Lightweight request logging prints each incoming request line for quick triage.

## Frontend integration
- The frontend uses VITE_API_URL (e.g., http://localhost:8080/api).
- Set this in the repo root .env if needed:
```
VITE_API_URL=http://localhost:8080/api
```

### Enrichment proxy

The API exposes a proxy at `/api/enrichment/*` that forwards requests to an external enrichment service defined by `ENRICHMENT_API_URL`.

- Local development: if you run the enrichment service on your host at `http://localhost:4000`, with Docker for Mac/Windows you can set
	`ENRICHMENT_API_URL=http://host.docker.internal:4000` for the `api`/`api-dev` service in `docker-compose.dev.yml` (already defaulted).
- Non-Docker local: if running the server directly on your machine, set `ENRICHMENT_API_URL=http://localhost:4000` in `server/.env`.
- Staging/Production: set `ENRICHMENT_API_URL` to your deployed enrichment service base (no trailing slash). The proxy appends `/api/enrichment`.

Example target mapping:

- Browser calls: `/api/enrichment/prospects_window?windowHours=72`
- Server proxies to: `${ENRICHMENT_API_URL}/api/enrichment/prospects_window?windowHours=72`


## Troubleshooting
- Port in use (EADDRINUSE):
```bash
lsof -iTCP:8080 -sTCP:LISTEN -n -P
kill -9 <pid>
```
- DB 503 errors: ensure MONGO_URI is set, Mongo Atlas IP/Access Rules allow your machine, and credentials are correct.
- CORS issues: set WEB_ORIGIN to your frontend origin (e.g., http://localhost:5173).
- Multiple server processes: ensure only one Node process is running on port 8080.
- Render health check: the service exposes GET /api/health for container readiness.

## Scripts
- npm run dev — Start with nodemon (watches src)
- npm run start — Start once
- npm run lint:api — Validate OpenAPI file
- npm run lint:api:bundle — Validate and output a bundled spec

## Smoke tests
Quick checks to verify the API is up and protected endpoints respond when authenticated.

- Health (no auth required):
	- `npm run smoke:health`
	- Options: `--base http://localhost:8080`

- Dashboard (auth required):
	- Bearer token:
		- `AUTH_BEARER=<idToken> npm run smoke:dashboard`
		- Or: `npm run smoke:dashboard -- --base http://localhost:8080/api/dashboard --bearer <idToken>`
	- Cookie session:
		- `AUTH_COOKIE="__asap_session=<cookieValue>" npm run smoke:dashboard`
	- Built-in email/password sign-in (uses Firebase Web REST API):
		- `npm run smoke:dashboard -- --signin --email you@example.com --password '...' --apiKey $VITE_FIREBASE_API_KEY`
	- Environment variables also supported: `AUTH_EMAIL`, `AUTH_PASSWORD`, `FIREBASE_WEB_API_KEY` or `VITE_FIREBASE_API_KEY`.

Tip: You can create a test Firebase user with `npm run firebase:create-user` (requires server Firebase admin credentials configured).

## Security
- Do not commit real credentials to .env files.
- Keep MONGO_URI in server/.env during development. In production, use your platform’s secret manager or environment variables.
