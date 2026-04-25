# warrant-system — Migration Plan

Generated: 2026-04-24

## Source → Target Mapping

| Source | Target | Notes |
|--------|--------|-------|
| `Inmate_enrichment/` | `services/inmate-enrichment/` | Moved intact, internal npm workspace preserved |
| `Bail-Bonds-Dashboard/` | `apps/dashboard/` | Moved intact, server/ sub-package preserved |
| `warrantdb-pipeline/` | `services/warrantdb-pipeline/` | Moved intact, Python venv excluded |
| `*/docs/*_AUDIT.md` | `docs/audits/<service>/` | Copied per-service to avoid name collisions |
| `Bail-Bonds-Dashboard/render.yaml` | `infra/render/dashboard.render.yaml` | Reference copy |
| `warrantdb-pipeline/render.yaml` | `infra/render/pipeline.render.yaml` | Reference copy |

## New Files Created

- `warrant-system/package.json` — root workspace scripts (no cross-language workspace resolution)
- `warrant-system/infra/docker/docker-compose.yml` — consolidated all-services compose
- `warrant-system/packages/shared-schema/` — stub, for future cross-service schema extraction
- `warrant-system/packages/shared-config/` — stub, documents env var overlap across all three services
- `warrant-system/docs/architecture/OVERVIEW.md` — cross-service topology

## Port Assignments (consolidated compose)

| Service | Internal | Host |
|---------|----------|------|
| inmate-enrichment API | 4000 | 4000 |
| inmate-enrichment Mongo (rs0) | 27017 | not exposed |
| inmate-enrichment Redis | 6379 | not exposed |
| dashboard API | 8080 | 8080 |
| dashboard Mongo | 27017 | 27018 |
| dashboard Redis | 6379 | 6381 |
| pipeline Mongo | 27017 | 27019 |
| pipeline API | 8080 | 8081 (build disabled — stub) |

## What Was NOT Changed

1. Business logic — zero changes to any .ts, .js, .py source files
2. Scraper behavior — ingestion/ scripts untouched
3. Enrichment logic — worker/src/pipeline.ts untouched
4. Dashboard UI — src/ components untouched
5. Mongoose models — shared/src/models.ts untouched
6. Server routes — server/src/routes/ untouched
7. Original repos — not deleted; copies placed in warrant-system/

## Known Issues (pre-existing, not introduced)

- `warrantdb-pipeline/Dockerfile` is named `Dockerfile.disabled` — no Docker build active; compose build is non-functional in that repo
- `inmate-enrichment` has no render.yaml — not deployed to Render
- dashboard render.yaml references branch `deploy/production` — autoDeploy is false
- Pipeline render.yaml references `api.app:app` but module path may need validation against actual FastAPI structure

## Next Steps (future work, not done here)

1. Extract truly shared Mongoose schema fields into `packages/shared-schema/`
2. Align `MONGO_DB` value (all three use `warrantdb` or variants)
3. Create a root `.env.example` consolidating all env vars
4. Add a `docker-compose.override.yml` for per-developer local overrides
5. Set up git history preservation (git subtree or submodule approach)
