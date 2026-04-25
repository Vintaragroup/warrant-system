# MongoDB Strategy

**Date:** 2026-04-24
**Status:** Decided
**Affects:** All three services

---

## Decision

Use **one shared MongoDB 7 cluster with a single-node replica set** for all three services in all environments (local dev, staging, production).

Each service uses a **separate named database** within that cluster.

---

## Rationale

### Why one cluster

The fundamental problem requiring this decision: in the pre-consolidation topology, `simple_*` collections (pipeline output, consumed by the dashboard) and `inmates` (enrichment service input) lived in separate Mongo instances. There was no data path between them. The entire system produced no output because the enrichment service had no input data and the dashboard had no case data.

A single cluster eliminates the cross-cluster data movement problem. All three services can read and write the same physical Mongo instance. The sync step (see [simple-to-enrichment-handoff.md](./simple-to-enrichment-handoff.md)) writes within the same cluster — no network hop, no replication lag between services.

### Why MongoDB 7

Both the dashboard and pipeline already used MongoDB 7 images in their original compose files. The enrichment service used MongoDB 6. MongoDB 7 is the newer stable version and supports all features required by the enrichment service, including replica sets and change streams.

### Why a replica set

The enrichment service's `watcher.ts` uses a MongoDB change stream (`collection.watch()`). Change streams require a replica set. A single-node replica set (`rs.initiate({_id:"rs0", members:[{_id:0, host:"warrant-mongo:27017"}]})`) satisfies this requirement with no multi-node operational overhead.

### Why not three separate clusters

Three clusters require three sync paths:

- pipeline → dashboard (for display)
- pipeline → enrichment (for input data)
- enrichment → dashboard (for enrichment status display)

Each sync path introduces lag, failure modes, and an additional process to operate. The three services have no conflicting write patterns that require isolation at the cluster level. Their data is isolated at the database name level (see Per-Service Database Names below).

---

## Per-Service Database Names

| Service                | `MONGO_DB` value     | Rationale                                                                               |
| ---------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `inmate-enrichment`    | `inmate_enrichment`  | Distinct from dashboard; matches service name                                           |
| `bail-bonds-dashboard` | `warrantdb`          | Preserved from existing production configuration; changing it requires a data migration |
| `warrantdb-pipeline`   | `warrantdb_pipeline` | Distinct from dashboard; matches service name                                           |

### Why not all three in `warrantdb`

All three services defaulted to `MONGO_DB=warrantdb` in their original templates. On a shared cluster, this would place all collections in the same database. Collections are distinct enough (`inmates`, `simple_harris`, `users`) that data corruption is unlikely, but:

- Atlas/Mongo-level access control cannot be scoped per service
- Backup and restore cannot target one service's data independently
- Cost attribution, monitoring, and index management become entangled
- A `db.dropDatabase()` operation in one service deletes all three services' data

---

## Affected Services

| Service                           | Change required                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `services/inmate-enrichment`      | `MONGO_DB` default → `inmate_enrichment`; Mongo image → `mongo:7`; compose Mongo service renamed |
| `apps/dashboard`                  | `MONGO_URI` must point to shared cluster in all environments                                     |
| `services/warrantdb-pipeline`     | `MONGO_DB` default → `warrantdb_pipeline`; `MONGO_URI` must point to shared cluster              |
| `infra/docker/docker-compose.yml` | Remove `dashboard-mongo` and `pipeline-mongo`; single `warrant-mongo` service with replica set   |

---

## Implementation Order

1. **Update `infra/docker/docker-compose.yml`**
   - Replace `ie-mongo`, `dashboard-mongo`, `pipeline-mongo` with a single `warrant-mongo` service
   - Image: `mongo:7`
   - Command: `mongod --replSet rs0 --bind_ip_all`
   - Host port exposure: `27017:27017` (for local tooling access)
   - Update `ie-mongo-setup` entrypoint to target `warrant-mongo`
   - Remove `dashboard-mongo-data` and `pipeline-mongo-data` volumes

2. **Update all `MONGO_URI` compose env vars** to point to `warrant-mongo:27017`
   - `ie-api` and `ie-worker`: `mongodb://warrant-mongo:27017/inmate_enrichment?replicaSet=rs0`
   - `dashboard-api`: `mongodb://warrant-mongo:27017/warrantdb`
   - `pipeline-api` (when enabled): `mongodb://warrant-mongo:27017/warrantdb_pipeline`

3. **Update `.env.sample` / `.env.example` per service** with correct `MONGO_DB` defaults
   - `services/inmate-enrichment/.env.sample`: `MONGO_DB=inmate_enrichment`
   - `services/warrantdb-pipeline/.env.example`: `MONGO_DB=warrantdb_pipeline`
   - `apps/dashboard/server/.env.example`: no change (`warrantdb` is correct)

4. **Update standalone compose files** (used when running services independently)
   - `services/inmate-enrichment/docker-compose.yml`: update Mongo image to `mongo:7`

5. **Create root `.env.example`** with prefixed multi-service entries (see [env-strategy.md](./env-strategy.md))

---

## Risks If Deferred

| Risk                                                                                    | Severity                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Dashboard shows zero county case records in all environments                            | Critical — the dashboard's primary value is inaccessible |
| Enrichment queue is permanently empty (no input records)                                | Critical — the enrichment pipeline never runs            |
| Three-cluster topology makes integration testing impossible without manual data seeding | High                                                     |
| Mongo 6 → 7 version gap widens over time, increasing migration effort                   | Medium                                                   |
| Atlas billing for three separate clusters vs. one                                       | Low (depends on deployment target)                       |

---

## Standalone Mode Compatibility

Each service can still be run in isolation from its own directory using its own compose file. When run standalone:

- `services/inmate-enrichment/docker-compose.yml` starts its own `ie-mongo` with replica set
- `apps/dashboard/docker-compose.dev.yml` starts its own `dashboard-mongo`
- `services/warrantdb-pipeline/docker-compose.yml` is currently broken (no active Dockerfile)

The consolidated compose is the only path that enables the full data flow. Standalone compose files are development-only convenience tools and are not expected to demonstrate end-to-end data flow.
