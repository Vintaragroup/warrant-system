# WarrantDB Pipeline Boot Audit

Date: 2026-04-24
Goal: simulate startup from the codebase and determine whether the project can actually boot successfully

## Verdict

The repo can partially boot locally, but its container and scheduled pipeline paths are broken as written.

Practical verdict:

- local API boot is plausible if Python dependencies and Mongo are available
- Docker Compose boot is broken
- Render API boot is broken
- scheduled full pipeline boot is broken at the normalize step

## 1. What Command Starts The System?

There are really two systems here:

### API boot

- `uvicorn api.main:app --reload --port 8080`

### Pipeline boot

- `python -m scripts.run_pipeline`

These are the primary commands referenced by:

- `README.md`
- `RUNBOOK.md`
- `SCHEDULING.md`

Container/deployment startup paths also exist:

- `docker-compose.yml` → API service via `build: .`
- `render.yaml` → Render web and worker services

## 2. What Runs First?

### Local API boot

1. `uvicorn api.main:app` imports `api/main.py`
2. `api/main.py` loads `.env` from repo root
3. FastAPI app is created
4. request logging middleware is registered
5. endpoints become available
6. requests that hit Mongo use `storage/mongo_client.py`

### Local pipeline boot

1. `python -m scripts.run_pipeline` starts `scripts/run_pipeline.py`
2. it reads `PIPELINE_SOURCES` and `PIPELINE_STEPS`
3. ingest step runs first by default
4. ingest step launches `python -m scripts.run_ingestion --source <source>` for each configured source
5. `scripts/run_ingestion.py` dynamically loads the requested scraper class from `SCRAPER_SPECS`
6. normalize step runs next
7. report step runs last

### Mongo dependency path

1. `storage/mongo_client.py` loads `.env`
2. it resolves `MONGO_URI` and `MONGO_DB`
3. it creates a `MongoClient`
4. callers use `get_db()` for runtime collection access

## 3. What Dependencies Are Required At Runtime?

Core runtime:

- Python 3.10+
- packages from `requirements.txt`
- MongoDB reachable at `MONGO_URI` or local default `mongodb://localhost:27017`

Pipeline-specific runtime:

- live source websites for county scrapers
- optional env knobs like `PIPELINE_SOURCES`, `PIPELINE_STEPS`, `JEFF_*`

Feature-specific runtime:

- HCSO URLs for Harris DOB enrichment
- IMAP credentials and roster directory for email-roster workflows
- optional TDCJ or PDF-related dependencies for specialized scripts

Container runtime:

- active Dockerfile at repo root for Compose boot

## 4. Where Would It Likely Fail?

### Failure point 1

File:

- `render.yaml`

Reason:

- Render API start command is `uvicorn api.app:app --host 0.0.0.0 --port $PORT`
- actual module is `api/main.py`, not `api/app.py`

Likely outcome:

- Render web service fails immediately with module import error

Suggested fix:

1. Change the Render start command to:
   - `uvicorn api.main:app --host 0.0.0.0 --port $PORT`

### Failure point 2

File:

- `docker-compose.yml`

Reason:

- Compose uses `build: .`
- there is no active root `Dockerfile`

Likely outcome:

- `docker compose up` fails before API startup because the build context has no usable default Dockerfile

Suggested fix:

1. Add a real active root `Dockerfile`
2. Or explicitly point Compose at the intended Dockerfile path

### Failure point 3

File:

- `scripts/run_pipeline.py`

Reason:

- normalizer module is hardcoded as `scripts.normalize_to_simple`
- actual normalizer file is repo-root `normalize_to_simple.py`

Likely outcome:

- ingest step may succeed
- normalize step fails with module import error
- full scheduled pipeline does not complete successfully

Suggested fix:

1. Change the normalizer invocation to use the actual file/module path
2. For example, call the root file directly or create a real `scripts/normalize_to_simple.py` wrapper

### Failure point 4

File:

- `render.yaml`

Reason:

- worker service start command is `sleep infinity`
- this does not run the pipeline at all

Likely outcome:

- worker “boots” as a sleeping process, but no batch work actually starts

Suggested fix:

1. Use `python -m scripts.run_pipeline` for a real worker command
2. Or remove the worker service and use explicit Render cron jobs only

### Failure point 5

File:

- `storage/mongo_client.py`

Reason:

- if `.env` is missing or invalid, it falls back to local Mongo on `localhost:27017`
- that only works if a local Mongo instance is actually running

Likely outcome:

- local API or pipeline commands fail at first DB access when no local Mongo exists

Suggested fix:

1. Make `MONGO_URI` explicit in setup docs for non-local environments
2. Optionally fail fast when a required environment is missing in production-style runs

## Bootability Summary

- Primary API boot: `uvicorn api.main:app --reload --port 8080`
- Primary pipeline boot: `python -m scripts.run_pipeline`
- What runs first: env loading, then FastAPI or pipeline orchestrator, then Mongo-dependent actions
- Runtime dependencies: Python deps, MongoDB, source websites, valid env configuration
- Most likely failures: broken Render module path, broken Compose build path, stale normalizer module path, sleeping worker command

## Bottom Line

This project does not currently boot cleanly across its documented deployment paths.

Local API boot can work, but Docker Compose, Render API boot, and the full scheduled pipeline all have concrete code/config mismatches that should be fixed before the project can be considered reliably bootable.