# warrant-system — Architecture Overview

## Service Topology

```
warrant-system/
├── apps/
│   └── dashboard/          React/Vite frontend + Express API backend
│                           Deployment: Render (static site + Docker web service)
│                           Port: 8080 (API), served via Nginx in production
│
├── services/
│   ├── inmate-enrichment/  TypeScript enrichment pipeline
│   │                       Stack: Express API (4000) + BullMQ Worker + MongoDB + Redis
│   │                       Deployment: self-hosted / Docker Compose
│   │                       Internal npm workspace: api/, worker/, shared/, web/
│   │
│   ├── warrantdb-pipeline/ Python scrapers + FastAPI
│   │                       Stack: FastAPI (8080/8081) + MongoDB + scrapers
│   │                       Deployment: Render (Python web + worker)
│   │                       Note: Dockerfile.disabled — build via Render buildCommand
│   │
│   └── ai-agent/           Telnyx voice/SMS agent (FastAPI)
│                           Stack: FastAPI (8080, mapped to 8082 in local compose) + MongoDB + Telnyx/Twilio/S3
│                           Deployment: Render (Python web)
│                           On its own MongoDB database — see Databases below
│
└── packages/
    ├── shared-schema/      Stub — future cross-service schema extraction
    └── shared-config/      Env var documentation across all services
```

## Data Flow

```
warrantdb-pipeline
  ingestion/*.py → normalize_to_simple.py → MongoDB (warrantdb, simple_* collections)
        ↓
  simple_harris / simple_brazoria / ... → read by inmate-enrichment watcher
        ↓
  inmate-enrichment
  watcher.ts → BullMQ queue → pipeline.ts → PDL/Pipl/Whitepages → subjects collection
        ↓
  subjects collection → read by dashboard API
        ↓
  apps/dashboard
  server/src/routes/ → React frontend

Note: ai-agent's code supports a fast-path simple_* lookup during Telnyx
calls, but runs on its own separate database today (see Databases below) —
this path is currently inactive, not a live third consumer of the pipeline's
data.
```

## Databases

| Service            | Database                           | Collections                                                                    |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------ |
| inmate-enrichment  | `inmate_enrichment` (configurable) | subjects, raw_payloads, related_parties                                        |
| warrantdb-pipeline | `warrantdb`                        | simple*harris, simple_brazoria, simple_fortbend, simple_galveston, warrants*\* |
| dashboard          | `warrantdb` (shared with pipeline) | users, cases, case*enrichment, check_ins, messages, payments, simple*\*        |
| ai-agent           | `ai_agent` (own database)          | persons, custody_events, inquiries, logs, callback_queue, cases, checkins, links |

Note: dashboard and warrantdb-pipeline share the same MongoDB database (`warrantdb`). ai-agent is deliberately **not** on that database — it has its own `checkins`/`cases` collections that would collide in name (though not in purpose) with the dashboard's `check_ins`/`cases` collections if merged onto the same database. ai-agent's code has a fast-path lookup that reads `simple_*` collections *if present in whatever database it's pointed at* (`app/telnyx_tools.py`, checks `db.list_collection_names()` before querying) — but on its own separate `ai_agent` database, those collections don't exist, so that path is currently a graceful no-op rather than live cross-service data access. Wiring it to actually read the pipeline's `simple_*` data would need a deliberate connection to `warrantdb` (read-only) and is out of scope for this merge.

## Port Map

| Service                 | Dev Host Port | Notes                                       |
| ----------------------- | ------------- | ------------------------------------------- |
| inmate-enrichment API   | 4000          |                                             |
| dashboard API (server/) | 8080          |                                             |
| warrantdb-pipeline API  | 8081          | remapped in consolidated compose (was 8080) |
| dashboard Mongo         | 27018         | mapped from internal 27017                  |
| pipeline Mongo          | 27019         | mapped from internal 27017                  |
| dashboard Redis         | 6381          | mapped from internal 6379                   |
| dashboard MailHog SMTP  | 1025          | dev only (hotreload profile)                |
| dashboard MailHog Web   | 8025          | dev only (hotreload profile)                |
| ai-agent API            | 8082          | container listens on 8080 internally        |
| ai-agent Mongo          | 27020         | mapped from internal 27017                  |

## Render Deployments

| File                                 | Services                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `infra/render/dashboard.render.yaml` | `warrantdb-api` (Docker), `warrantdb-web` (static)      |
| `infra/render/pipeline.render.yaml`  | `warrant-api` (Python web), `warrant-pipeline` (worker) |
| `infra/render/ai-agent.render.yaml`  | `ai-agent` (Python web)                                 |

## Audit Documents

All 12 × 3 = 36 audit files from the pre-migration audit are in `docs/audits/`.
