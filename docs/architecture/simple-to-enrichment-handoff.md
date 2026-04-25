# Simple-to-Enrichment Handoff

**Date:** 2026-04-24
**Status:** Decided — implementation pending
**Affects:** `warrantdb-pipeline`, `inmate-enrichment`

---

## The Gap

The enrichment service (`inmate-enrichment`) requires that a record already exist in the `inmates` collection before it starts. The pipeline (`warrantdb-pipeline`) writes its normalized output into `simple_<county>` collections (e.g., `simple_harris`, `simple_brazoria`). Nothing in either service moves data across this boundary.

This means:
- The enrichment service has no input data unless records are manually inserted into `inmates`
- The full pipeline (`ingest → normalize → enrich → display`) is broken end-to-end as delivered

---

## Decision

A **sync script** (`sync_to_enrichment.py`) is added to the pipeline as a post-normalize step. It reads from `simple_<county>` collections and upserts into the `inmates` collection in the `inmate_enrichment` database.

This runs on every pipeline execution, after normalization, before the pipeline's reporting step.

---

## Rationale

Three approaches were considered:

| Option | Description | Rejected because |
|---|---|---|
| A — Enrichment reads `simple_*` directly | Point `SUBJECTS_COLLECTION` at `simple_harris` etc. | `simple_*` has no enrichment lifecycle fields. Writing `enrichment_status`, `enrichment_flag`, `enrichment_last_run_at` back into pipeline-owned collections creates backward coupling and contaminates the pipeline schema. |
| B — Sync script as pipeline post-step | **Selected.** Pipeline posts normalized records to `inmates`; enrichment service owns that schema entirely. | — |
| C — Pipeline writes directly into `inmates` | `normalize_to_simple.py` upserts to both `simple_*` and `inmates` | Pipeline would need to import the enrichment schema. Tight coupling in the wrong direction. |

Option B keeps schema ownership clean:
- Pipeline owns `simple_*`
- Enrichment owns `inmates`
- The sync script owns the bridge — it is small, testable, and replaceable without touching either service's core logic

---

## Sync Script Behavior

### Source

All active `simple_<county>` collections in the `warrantdb_pipeline` database:
- `simple_harris`
- `simple_brazoria`
- `simple_galveston`
- `simple_fortbend`
- `simple_jefferson`

### Target

`inmates` collection in the `inmate_enrichment` database.

### Upsert key

`spn` — the subject person number. This is the shared identity key used by both the pipeline's raw Harris data and the enrichment service's subject queries.

For records without `spn`, fall back to `(full_name, booking_date)` as a composite key. This is weaker — name/date collisions are possible — and should be flagged in the sync output.

### Fields copied on upsert

| Source field (`simple_*`) | Target field (`inmates`) | Notes |
|---|---|---|
| `spn` | `spn` | Primary identity |
| `full_name` | `first_name`, `last_name` | Split on last whitespace-delimited token |
| `bond_amount` | `bond_amount` | Already coerced to number by P1-4 fix |
| `bond` | `bond` | Carried as fallback |
| `booking_date` | `_ingested_at` | Used by enrichment window gate; see timestamp note below |
| `county` | `county` | Pipeline uses slug format; enrichment does not validate |
| `dob` | `dob` | May be null; enrichment will attempt HCSO lookup if absent |
| `address.city` | `city` | Top-level field in enrichment schema |
| `address.state` | `state` | Top-level field in enrichment schema |

### Enrichment lifecycle fields — set on first insert only

| Field | Value | Condition |
|---|---|---|
| `enrichment_flag` | `true` | Only on first insert; never overwritten by sync |
| `enrichment_status` | `NEW` | Only on first insert |

On subsequent syncs of the same record (same `spn`), the sync script must **not** overwrite `enrichment_flag` or `enrichment_status`. Those fields are owned by the enrichment service from the moment of first insert.

### Timestamp note

The enrichment service's window gate checks one of seven timestamp candidates on the `inmates` record. The sync script writes `booking_date` from the pipeline into `_ingested_at` on the `inmates` record. This is the most reliable indicator of when the source record was first seen. If `_ingested_at` is absent, the enrichment gate will fall through to other candidates and may produce incorrect window evaluations.

---

## Affected Services

| Service | Change |
|---|---|
| `warrantdb-pipeline` | Add `scripts/sync_to_enrichment.py`; call it from `scripts/run_pipeline.py` as a post-normalize step |
| `inmate-enrichment` | No code changes; schema is already compatible |
| `infra/docker/docker-compose.yml` | Shared Mongo cluster (P0-2 prerequisite) must be in place |

### Files to create or modify

| File | Action |
|---|---|
| `services/warrantdb-pipeline/scripts/sync_to_enrichment.py` | Create — sync implementation |
| `services/warrantdb-pipeline/scripts/run_pipeline.py` | Modify — add sync step between normalize and report |
| `services/warrantdb-pipeline/.env.example` | Modify — add `ENRICHMENT_MONGO_DB=inmate_enrichment` (only needed if targeting a different database on the same cluster) |

---

## Implementation Order

1. **P0-2 first** — Shared Mongo cluster must be in place. The sync script assumes both databases (`warrantdb_pipeline` and `inmate_enrichment`) are on the same Mongo instance. If they are on different hosts, `ENRICHMENT_MONGO_URI` must be a separate env var, which adds complexity.

2. **P1-3 and P1-4 first** — The sync script copies `booking_date` and `bond_amount`. If those fields are not yet correctly populated by the normalizer, the sync will propagate bad data into the enrichment service.

3. **Sync script implementation** — After the above prerequisites are satisfied.

4. **Pipeline run test** — Verify that after a full `python -m scripts.run_pipeline` run, `inmates` in `inmate_enrichment` contains records with `enrichment_status=NEW` and `enrichment_flag=true`.

---

## Risks If Deferred

| Risk | Severity |
|---|---|
| Enrichment service has no input data; enrichment queue is permanently empty | Critical |
| End-to-end pipeline test is impossible until this is implemented | Critical |
| Manual data insertion into `inmates` required for any enrichment testing | High — error-prone and not reproducible |
| Dashboard's enrichment status columns will always be empty | Medium |

---

## Out of Scope

The sync script is a one-directional write: pipeline → enrichment. It does not:
- Copy enrichment results back into `simple_*` (that is a separate integration, not yet planned)
- Replace or merge records from multiple counties with conflicting `spn` values (county-of-origin tagging is the long-term solution)
- Handle deleted records — if a record is removed from `simple_harris`, it remains in `inmates` (soft-delete strategy not defined)
