# WarrantDB Pipeline Docker And Deployment Audit

Date: 2026-04-24
Scope: `docker-compose.yml`, `Dockerfile.disabled`, `render.yaml`, README/runbook deployment commands, and actual runtime entrypoints

## 1. What Service(s) Are Being Built?

### Compose-declared services

- `api`
  - declared as `build: .` in [docker-compose.yml](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/docker-compose.yml)
- `mongo`
  - pulled from `mongo:7`

### Render-declared services

- `warrant-api`
  - Python web service
- `warrant-pipeline`
  - Python worker service

### Actual buildable Dockerfile present in repo

- [Dockerfile.disabled](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/Dockerfile.disabled)
  - minimal API-only image
  - not referenced by Compose

## 2. What Is The Container Actually Running?

### Intended API runtime

- README start command: `uvicorn api.main:app --reload --port 8080`
- actual code entrypoint: [api/main.py](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/api/main.py)

### Dockerfile-disabled runtime

- CMD: `uvicorn api.main:app --host 0.0.0.0 --port 8080`
- this matches the actual file path

### Render API runtime

- start command in `render.yaml`: `uvicorn api.app:app --host 0.0.0.0 --port $PORT`
- this does not match the actual code layout

### Render worker runtime

- start command in `render.yaml`: `sleep infinity`
- this does not run the pipeline
- the real operational pipeline entrypoint is [scripts/run_pipeline.py](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/scripts/run_pipeline.py), usually invoked as `python -m scripts.run_pipeline`

## 3. Are There Mismatches Between Code Entry Point And Docker CMD?

Yes.

### Confirmed API mismatch in Render

- `render.yaml` uses `api.app:app`
- actual file is [api/main.py](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/api/main.py)
- no `api/app.py` exists

This Render API start command is broken.

### Confirmed Compose build mismatch

- `docker-compose.yml` uses `build: .`
- the repo does not contain an active root `Dockerfile`
- only [Dockerfile.disabled](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/Dockerfile.disabled) exists

That means the Compose API build path is broken unless a missing Dockerfile is restored externally.

### Worker mismatch in Render

- Render worker runs `sleep infinity`
- the actual background workload is the pipeline command described in README/RUNBOOK/SCHEDULING

This means the worker service is provisioned but not actually performing useful work by default.

### Pipeline internal mismatch

- [scripts/run_pipeline.py](/Users/ryanmorrow/Documents/Projects2025/WarrentDB/warrantdb-pipeline/scripts/run_pipeline.py) sets `NORMALIZER_MODULE = "scripts.normalize_to_simple"`
- actual normalizer file is repo-root `normalize_to_simple.py`

This is not a Docker CMD mismatch, but it directly affects deployable pipeline execution.

## 4. Any Inefficiencies Or Broken Steps?

### Broken steps

1. `docker-compose.yml` cannot build the API as written because there is no active root `Dockerfile`.
2. `render.yaml` API start command points to a nonexistent module.
3. `render.yaml` worker service does not run the pipeline at all.
4. `scripts/run_pipeline.py` points to the wrong normalizer module.

### Inefficiencies

1. No `.dockerignore` file exists.
   - full repo context would be sent into Docker builds if the Dockerfile path were fixed
2. The available Dockerfile is API-only.
   - it does not define a real worker image strategy
3. Scheduling is documented in `SCHEDULING.md` rather than represented in a deployable container entry strategy

## Missing Dependencies In Docker

### Missing Python package dependencies for containerized workloads

The requirements file is incomplete for code currently imported by the repo:

- `playwright`
  - imported by `enrichment/tdcj_enrich.py`
- `certifi`
  - imported by `ingestion/galveston_p2c_fast.py`
  - imported by `scripts/backfill_galveston_mugshots.py`

### Missing browser installation path

README notes that Playwright may require:

- `python -m playwright install chromium`

No Docker or Render build step performs that browser installation.

So even after adding the Python package, Playwright-based flows would still be incomplete in containerized deployments.

## Anything That Would Break Deployment?

Yes. Multiple things.

### Confirmed breakage

1. Compose API build is broken because there is no active root `Dockerfile`.
2. Render API deployment is broken because it starts `api.app:app` instead of `api.main:app`.
3. Render worker is effectively a no-op because it runs `sleep infinity`.

### High-probability breakage

4. Playwright-based enrichment will fail in Docker/Render because the package and browser install path are incomplete.
5. Pipeline runs that depend on the normalizer step will fail or misbehave because `scripts/run_pipeline.py` references the wrong module path.

## Corrected Docker Strategy

Recommended primary strategy:

1. Create a real root `Dockerfile` and stop relying on `Dockerfile.disabled`.
2. Split deployment intent clearly:
   - API image for `uvicorn api.main:app`
   - worker image for `python -m scripts.run_pipeline` or a scheduler-specific command
3. Fix Render commands to match those same entrypoints.

Minimal corrected strategy:

- API image
  - base: `python:3.11-slim`
  - install `requirements.txt`
  - copy source
  - run `uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080}`

- Worker image
  - same Python base and dependency install
  - run `python -m scripts.run_pipeline`
  - for cron-style environments, let the platform schedule this command instead of keeping a sleeping worker alive

- Compose
  - update `docker-compose.yml` to reference the active Dockerfile explicitly
  - add a worker service if local containerized pipeline execution is intended

- Render
  - change API start command to `uvicorn api.main:app --host 0.0.0.0 --port $PORT`
  - change worker start command to an actual pipeline command or remove the worker service and use Render Cron Jobs directly

- Dependencies
  - add missing Python packages to `requirements.txt`
  - if Playwright flows are supported, install browser binaries during image build or remove those flows from container expectations

## Bottom Line

- Current container strategy is not deployable as written.
- Compose is broken, Render API is broken, and the Render worker is a placeholder.
- This repo needs an actual active Dockerfile plus corrected entry commands before container deployment can be considered reliable.