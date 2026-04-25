# Windows v2 Migration Status

_Last updated: 2025-10-02_

## Executive Summary
The dashboard has migrated from legacy calendar-day heuristic windows to a canonical bucket taxonomy (`time_bucket_v2`) guarded by the feature flag `USE_TIME_BUCKET_V2`. Validation now shows 1:1 correspondence between API KPIs, per-county stats, and direct MongoDB bucket aggregates. Coverage is 100% for the 7‑day diagnostic slice.

## Canonical Fields
- `booking_datetime` (precise source timestamp where derivable)
- `booking_date_v2` (normalized YYYY-MM-DD; exposed as `booking_date` alias in responses)
- `time_bucket_v2` one of:
  - `0_24h`, `24_48h`, `48_72h`, `3d_7d`, `7d_30d`, `30d_60d`, `60d_plus`
- `booking_derivation_source` (diagnostic provenance)

## Legacy Window Mapping
| Legacy Window | Buckets | Notes |
| ------------- | ------- | ----- |
| 24h | `0_24h` | "Today" (most recent 24h slice) |
| 48h | `24_48h` | Yesterday slice |
| 72h | `48_72h` | Two days ago |
| 7d  | `0_24h`,`24_48h`,`48_72h`,`3d_7d` | Rolling (0–7d) aggregate |
| 30d | `0_24h`..`7d_30d` | Rolling (0–30d) aggregate |

## Feature Flag
- Env var: `USE_TIME_BUCKET_V2=true` enables bucket-based logic and response enrichment.
- When `false`, system reverts to legacy calendar-day matching and omits bucket diagnostics.

## Validation Snapshot (Green)
Command: `npm run validate:windows --workspace=server -- --warnPct=2`
```
PASS KPI.today (0_24h) api=230 mongo=230
PASS KPI.yesterday (24_48h) api=0 mongo=0
PASS KPI.twoDaysAgo (48_72h) api=216 mongo=216
PASS PerCounty.* (all counties / windows)
PASS New list buckets all 0_24h
PASS Recent list buckets all 48_72h
PASS Coverage 100% (bucketCoverage.coverageRate=1)
```
Exit code: 0

## Diagnostics Endpoint
`GET /api/dashboard/diag?window=7d` (v2 mode):
- `bucketDist`: distribution across all buckets in window match
- `bucketCoverage`: `{ withBucket, withoutBucket, coverageRate }` (should be 1)
- `mode`: `v2_buckets` (legacy returns `legacy` and omits bucket facets)

## Indexing
Implemented / verified indexes (representative):
- `{ time_bucket_v2: 1 }`
- `{ county: 1, time_bucket_v2: 1 }`
- `{ county: 1, time_bucket_v2: 1, bond_amount: -1 }`
- `{ booking_datetime: -1 }`

These support fast equality / small IN queries on `time_bucket_v2` and compound lookups for per-county + bond aggregations.

## Scripts
- `scripts/test-windows.mjs` – deterministic mapping tests
- `scripts/validate-windows.mjs` – live reconciliation (API vs Mongo buckets)
- `scripts/analyze_har.mjs` – HAR perf inspection (optional)

## Rollback Plan
1. Set `USE_TIME_BUCKET_V2=false` and restart API
2. Legacy calendar-day logic resumes; enriched bucket fields & coverage facets disappear
3. Re-run smoke tests to confirm baseline counts (legacy expectations)
4. If returning to v2: re-enable flag and re-run validator until green

_No schema changes require reversal; the v2 fields are additive and safely ignored by legacy mode._

## Operational Playbook
| Task | Command / Endpoint | Success Criteria |
|------|--------------------|------------------|
| Health (fast) | `/api/health/light` | `{ ok: true }` |
| KPI sanity | `/api/dashboard/kpis` | Non-stale counts (monotonic within day) |
| Bucket coverage | `/api/dashboard/diag?window=7d` | `coverageRate === 1` |
| Full validation | `npm run validate:windows` | Exit code 0 |

## Known Limitations / Open Questions
- Rolling-hour view (todo #11) pending product decision; current windows are bucket/fixed-slice based.
- Aggregation optimization (in progress): still performing some date normalization work when only bucket filters are needed.
- No automated alerting yet if coverageRate < 1 (future enhancement: CI or cron job + Slack webhook).

## Next Steps
1. Finish aggregation optimization (introduce bucket-only fast path & perf headers annotation)
2. Decide on showing both calendar and rolling-hour views, or deprecating rolling entirely
3. Add lightweight telemetry (histograms of query ms per endpoint variant)
4. Optional: surface a `/api/dashboard/buckets/summary` endpoint for ops dashboards

## Changelog (High-Level)
- 2025-09-24: Introduced feature flag + mapping utilities
- 2025-09-25 (AM): Added diagnostics coverage facet & validation script
- 2025-09-25 (PM): Switched on v2, validation green, documenting status (this file)
 - 2025-10-02: Added KPI threeToSeven (3–7d), recent `?window=3d_7d` support, and UI KPI toggle (48–72h ↔ 3–7d); /health/buckets documented.

---
_Questions or discrepancies: run the validator first; if green, attach example doc(s) with unexpected UI behavior._
