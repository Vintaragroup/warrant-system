# Consolidation Decisions

**Date:** 2026-04-24
**Status:** Approved — pending implementation
**Source of truth:** Cross-system analysis and consolidation decision plan (April 2026 audit cycle)

This document is the index of all pre-consolidation decisions. Each item links to the detailed document where rationale, affected files, and implementation order are recorded.

---

## Decision Summary Table

| #   | Priority | Area                                 | Decision                                                                                             | Status  | Detail doc                                                           |
| --- | -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- |
| 1   | P0       | Data handoff: pipeline → enrichment  | Sync script as a pipeline post-step                                                                  | Decided | [simple-to-enrichment-handoff.md](./simple-to-enrichment-handoff.md) |
| 2   | P0       | MongoDB topology                     | One shared MongoDB 7 cluster with replica set                                                        | Decided | [mongo-strategy.md](./mongo-strategy.md)                             |
| 3   | P1       | Canonical booking date field         | `booking_date` (YYYY-MM-DD) is the contract field between pipeline and dashboard                     | Decided | [schema-contract.md](./schema-contract.md)                           |
| 4   | P1       | Bond amount handling                 | Coercion lives in pipeline normalizer; enrichment gate uses explicit null guard                      | Decided | [schema-contract.md](./schema-contract.md)                           |
| 5   | P1       | Per-service MongoDB database names   | `inmate_enrichment`, `warrantdb`, `warrantdb_pipeline`                                               | Decided | [mongo-strategy.md](./mongo-strategy.md)                             |
| 6   | P2       | Enrichment API auth                  | `ENRICHMENT_PROXY_SECRET` header; network isolation for local/staging; required before Render deploy | Decided | [env-strategy.md](./env-strategy.md)                                 |
| 7   | P2       | HCSO rate-limit coordination         | Operational scheduling constraint now; shared Redis key as follow-on                                 | Decided | [hcso-rate-limit-policy.md](./hcso-rate-limit-policy.md)             |
| 8   | P2       | Broken pipeline Render start command | Fix `api.app:app` → `api.main:app` in both render.yaml files                                         | Decided | [env-strategy.md](./env-strategy.md)                                 |

---

## Implementation Order

These decisions have dependencies. Implement in this sequence:

```
Step 1: P0-2 — Shared Mongo cluster (all downstream decisions depend on data being visible)
Step 2: P1-5 — Per-service database names (must be set before any data is written to shared cluster)
Step 3: P0-1 — Sync script (requires shared cluster to be in place)
Step 4: P1-3 — Booking date backfill in normalizer (safe to implement alongside step 3)
Step 5: P1-4 — Bond amount coercion in normalizer (safe to implement alongside step 3)
Step 6: P2-8 — Fix Render start command (zero-risk, implement any time)
Step 7: P2-6 — ENRICHMENT_PROXY_SECRET middleware (implement before external Render deploy)
Step 8: P2-7 — HCSO scheduling policy (document now; Redis rate limiter as follow-on)
```

---

## What Was Explicitly Decided Against

| Approach                                                                 | Rejected for                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Pipeline writes directly into the enrichment `inmates` schema            | Creates backward coupling from pipeline into enrichment-owned schema                                   |
| Dashboard and pipeline on separate Mongo clusters with sync              | Adds a third sync path; increases operational complexity with no benefit                               |
| Dashboard reads `simple_*` directly from pipeline collections (Option A) | `simple_*` has no enrichment lifecycle fields; enrichment write-back would pollute pipeline-owned data |
| Forcing `booking_datetime` into the dashboard's fallback chain           | Requires ISO parsing at Mongo aggregation layer; unnecessary when `booking_date` backfill is simpler   |
| Shared Redis between enrichment and dashboard (no namespace)             | BullMQ queue name collisions would route jobs to the wrong worker                                      |

---

## Deferred (not decided in this cycle)

| Item                                                       | Why deferred                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Shared BullMQ queue namespace prefix (`ie:`, `dashboard:`) | No collision confirmed in production yet; low urgency                      |
| HCSO shared Redis rate limiter (cross-language)            | Non-trivial; scheduling constraint is sufficient for now                   |
| Formal `packages/shared-schema` implementation             | Stubs exist; full implementation requires finalizing schema contract first |
| `uploads/` directory audit                                 | Excluded from rsync; needs separate review before production               |
| Selenium/webdriver Render runtime assessment               | Pipeline scraper dependency; separate from consolidation scope             |
