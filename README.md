# warrant-system

Monorepo consolidating four services for the Harris County warrant intelligence system.

## Services

| Path                           | Description                                                | Language                |
| ------------------------------ | ----------------------------------------------------------- | ----------------------- |
| `apps/dashboard/`              | Bail Bonds Dashboard — React/Vite + Express backend         | TypeScript / JavaScript |
| `services/inmate-enrichment/`  | Inmate enrichment pipeline — BullMQ + PDL/Pipl               | TypeScript              |
| `services/warrantdb-pipeline/` | Warrant scraper pipeline — FastAPI + county scrapers         | Python                  |
| `services/ai-agent/`           | Telnyx voice/SMS agent — check-ins, call routing/transfer    | Python                  |

The dashboard's authentication is self-hosted (Passport.js: email/password + Google OAuth, sessions in Redis) — not a third-party auth provider. See `apps/dashboard/server/src/lib/passport.js`.

`services/ai-agent` runs on its own MongoDB database (`ai_agent`), deliberately separate from the dashboard's `warrantdb` — it has its own `checkins` collection that would otherwise collide by name with the dashboard's.

## Quick Start

```bash
# Spin up all Docker services (mongo + redis instances for all stacks)
npm run stack:up

# Or run each service individually:
cd apps/dashboard && npm run dev             # Vite dev server (frontend)
cd apps/dashboard && npm run server:dev     # Express backend dev

cd services/inmate-enrichment && npm run stack:up   # Full enrichment stack

cd services/warrantdb-pipeline && uvicorn api.main:app --reload  # FastAPI dev

cd services/ai-agent && uvicorn app.main:app --reload --port 8080  # FastAPI dev
```

Bootstrap a local dashboard admin account (replaces the old Firebase-console flow):

```bash
cd apps/dashboard/server && npm run create-local-user
```

## Consolidated Docker Compose

`infra/docker/docker-compose.yml` orchestrates all four stacks from a single file.
Each service also has its own compose file for isolated development.

## Render Deployments

- Dashboard backend: `infra/render/dashboard.render.yaml`
- Pipeline: `infra/render/pipeline.render.yaml`
- AI agent: `infra/render/ai-agent.render.yaml`
- Inmate enrichment: not deployed to Render (self-hosted)

## Deploying the dashboard frontend to Vercel (self-service)

The dashboard frontend (`apps/dashboard`) is a static Vite/React build — it deploys to Vercel independently of the backend, and doesn't require any account or config from a prior deploy. `apps/dashboard/vercel.json` already declares the build settings and the SPA rewrite (needed so client-side routes like `/cases/123` don't 404 on direct load) — Vercel just needs to be pointed at the repo:

1. In Vercel: **Add New → Project → Import Git Repository**, select `Vintaragroup/warrant-system`.
   - If the repo doesn't show up as importable, it's a GitHub App authorization issue, not a Vercel one — check **GitHub → Organization settings → Third-party Access → Vercel** and confirm it's granted access to this repo (or "All repositories").
2. **Root Directory**: `apps/dashboard`. Vercel auto-detects the Vite framework from there; `vercel.json` supplies the build command, output directory, and SPA rewrite.
3. **Environment Variables** — add one:
   - `VITE_API_URL` = the dashboard backend's URL (e.g. `https://warrantdb-api.onrender.com`).
4. Deploy. No CLI, no API key, no other config needed.
5. **One follow-up step on the backend side**: once you have the Vercel URL, set `WEB_ORIGIN` on the Render dashboard backend service to that URL (Render dashboard → `warrantdb-api` → Environment), and redeploy the backend. This is required for CORS and cross-origin session cookies to work — without it, the frontend will load but login will fail silently.

## Documentation

- `docs/audits/` — 36 audit files (12 per service) from pre-migration audit
- `docs/architecture/OVERVIEW.md` — service topology, data flow, port map
- `MIGRATION_PLAN.md` — source-to-target mapping and migration notes
- `Warrant-System-Audit-and-Plan.md` — repo consolidation audit, phased plan, and progress tracking
