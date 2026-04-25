# WarrantDB Pipeline Configuration Audit

Date: 2026-04-24
Scope: Python env loading, county config files, deployment files, scheduling files, and hardcoded operational constants across scrapers and maintenance scripts

## Primary Conclusion

Configuration in this repo is fragmented.

- There is one core DB config owner: `storage/mongo_client.py`.
- After that, configuration becomes highly distributed across county scrapers, maintenance scripts, scheduling docs, deploy files, and JSON/text config assets.

This repo has the most fragmented configuration model of the three.

## Configuration Sources

### Core runtime config

- `storage/mongo_client.py`
  - main owner for Mongo connection defaults and `.env` loading
  - central only for DB connection, not for the broader system

### Environment template

- `.env.example`
  - operator-facing template for Mongo, HCSO, IMAP, Dropbox, and roster support
  - does not represent the full configuration surface used by the repo

### Deployment config

- `docker-compose.yml`
  - service topology, env file loading, port exposure
- `render.yaml`
  - deployment env vars and service start commands

### Scheduling and orchestration config

- `SCHEDULING.md`
  - effectively a config source because it defines env for cron, systemd, and Render jobs
- `RUNBOOK.md`
  - operational configuration guidance and examples

### County/static config assets

- `configs/*.json`
  - county-specific source definitions and schedule metadata
- `configs/jefferson_lastnames.txt`
  - Jefferson scraper input data used as configuration

### Script-local configuration

- `ingestion/*.py`
- `enrichment/*.py`
- `scripts/*.py`
- `normalize_to_simple.py`

These files define many local constants and env knobs instead of importing from a single shared config layer.

### Hardcoded constants in scrapers

Examples:

- `ingestion/harris_inmate.py`
- `ingestion/jefferson_jail.py`
- `ingestion/brazoria_jail.py`
- `ingestion/galveston_p2c_fast.py`
- `ingestion/fortbend_ingest.py`

Each carries source URLs, user agents, search limits, delays, or debug behavior locally.

## Where Configuration Is Duplicated

### Mongo configuration is repeated everywhere

Repeated in:

- `storage/mongo_client.py`
- many ingestion scripts
- many maintenance scripts
- `RUNBOOK.md`
- `SCHEDULING.md`
- `docker-compose.yml`
- `render.yaml`

The repo has one DB helper, but many scripts still read `MONGO_URI` and `MONGO_DB` directly.

### Scheduler config exists in docs rather than a single machine-readable file

`SCHEDULING.md` defines:

- `PIPELINE_SOURCES`
- `PIPELINE_STEPS`
- `JEFF_*` knobs
- timezone and schedule choices

That means critical runtime orchestration is documented, not centralized in code.

### County scraper behavior is duplicated per source file

Each county file defines its own:

- base URL
- delays and throttles
- dump directories
- debugging limits
- search ranges

This is expected to some degree, but there is no shared schema or common config layer for these knobs.

### Template and deploy config disagree on service-port ownership

- `.env.example` uses `API_PORT`
- `render.yaml` uses `$PORT`
- README examples run Uvicorn with explicit CLI `--port 8080`

That is duplicated and inconsistent.

## Hardcoded Values That Should Be Configurable

### High-value candidates

- `ingestion/harris_inmate.py`
  - hardcoded `ASSIST_DENY_NOTES`
  - hardcoded `GROUPS`
  - hardcoded `KINDS`
  - hardcoded browser headers and long user agent string
  - hardcoded Harris source URLs as defaults

- `ingestion/jefferson_jail.py`
  - hardcoded base URLs
  - hardcoded wildcard policy
  - hardcoded browser headers and UA

- `ingestion/brazoria_jail.py`
  - hardcoded base URL
  - hardcoded request headers

- `ingestion/galveston_p2c_fast.py`
  - hardcoded base URL and roster path
  - hardcoded user agent
  - hardcoded default timeout

- `enrichment/tdcj_enrich.py`
  - hardcoded user agent string

- maintenance scripts
  - hardcoded collection defaults like `simple_harris`
  - hardcoded horizons like `90 days`

Many of these are operational assumptions, not just implementation details.

## Inconsistencies Across Files

### Port naming inconsistency

- `.env.example` uses `API_PORT`
- Render uses `PORT`
- README examples pass explicit `--port 8080`

### DB naming inconsistency

- Python runtime mostly uses `MONGO_DB`
- mongosh helpers and shell scripts often use `DB_NAME`

### Mixed centralization model

- `storage/mongo_client.py` centralizes DB access
- many scripts bypass it and construct env/default handling locally

### County config strategy is inconsistent

- some county settings live in `configs/*.json`
- others live as env vars
- others live as hardcoded constants inside source files

### Deployment path inconsistencies

- `docker-compose.yml` builds from root with `env_file: .env`
- `render.yaml` defines env vars directly and uses a different start command path

## Overall Assessment

This repo is fragmented.

- Good: Mongo connection has a recognizable home in `storage/mongo_client.py`
- Weak: almost everything else is distributed across scripts, scrapers, docs, and deploy files
- Result: configuration is not centrally managed beyond the DB layer

## Recommendation

1. Introduce a shared Python config module for all env and operational defaults, not just Mongo.
2. Replace `API_PORT` with `PORT`, or remove `API_PORT` entirely.
3. Standardize on `MONGO_DB` across Python and mongosh paths.
4. Move county-specific tunables into a structured config layer rather than leaving them split across env vars, JSON files, and hardcoded constants.
5. Reduce reliance on docs as the source of scheduler configuration by moving scheduler parameters into code or checked config files.