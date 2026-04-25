# warrant-system

Monorepo consolidating three services for the Harris County warrant intelligence system.

## Services

| Path | Description | Language |
|------|-------------|----------|
| `apps/dashboard/` | Bail Bonds Dashboard — React/Vite + Express backend | TypeScript / JavaScript |
| `services/inmate-enrichment/` | Inmate enrichment pipeline — BullMQ + PDL/Pipl | TypeScript |
| `services/warrantdb-pipeline/` | Warrant scraper pipeline — FastAPI + county scrapers | Python |

## Quick Start

```bash
# Spin up all Docker services (mongo + redis instances for all stacks)
npm run stack:up

# Or run each service individually:
cd apps/dashboard && npm run dev             # Vite dev server (frontend)
cd apps/dashboard && npm run server:dev     # Express backend dev

cd services/inmate-enrichment && npm run stack:up   # Full enrichment stack

cd services/warrantdb-pipeline && uvicorn api.main:app --reload  # FastAPI dev
```

## Consolidated Docker Compose

`infra/docker/docker-compose.yml` orchestrates all three stacks from a single file.
Each service also has its own compose file for isolated development.

## Render Deployments

- Dashboard: `infra/render/dashboard.render.yaml`
- Pipeline: `infra/render/pipeline.render.yaml`
- Inmate enrichment: not deployed to Render (self-hosted)

## Documentation

- `docs/audits/` — 36 audit files (12 per service) from pre-migration audit
- `docs/architecture/OVERVIEW.md` — service topology, data flow, port map
- `MIGRATION_PLAN.md` — source-to-target mapping and migration notes
