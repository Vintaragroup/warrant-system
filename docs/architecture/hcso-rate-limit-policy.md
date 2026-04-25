# HCSO Rate Limit Policy

**Date:** 2026-04-24
**Status:** Decided (Phase 1 — operational constraint); Phase 2 (Redis rate limiter) deferred
**Affects:** `warrantdb-pipeline`, `inmate-enrichment`

---

## The Problem

Both `warrantdb-pipeline` and `inmate-enrichment` make HTTP requests to the Harris County Sheriff's Office (HCSO) system. They do so using separate client implementations, separate configuration variables, and no shared state. A concurrent run of both services can send HCSO requests at double the rate without either service being aware of the other.

HCSO does not publish a rate limit. Observed behavior is the only constraint. An IP-level block from HCSO would simultaneously disable:
- DOB lookups in the inmate enrichment service (breaking provider candidate scoring)
- DOB enrichment in the pipeline's HCSO enrichment step (breaking normalization quality)

---

## HCSO Access Per Service

### warrantdb-pipeline

- Files: `enrichment/*.py` (HCSO enrichment scripts)
- Config vars: `HCSO_SPN_URL_FMT`, `HCSO_NAME_URL_FMT`, `HCSO_THROTTLE_SEC`, `HCSO_BETWEEN_PEOPLE_SEC`, `HCSO_TIMEOUT_SEC`
- Client type: Python HTTP scraper
- Trigger: Run explicitly via script; not triggered by a change stream or queue

### inmate-enrichment

- File: `worker/src/providers/hcsoClient.ts`
- Config vars: `HCSO_BASE_URL`, `HCSO_SCRAPE_MODE`, `HCSO_SCRAPE_ENABLED`
- Client type: TypeScript HTTP or browser (Selenium) depending on `HCSO_SCRAPE_MODE`
- Trigger: Triggered per-record by the BullMQ enrichment worker (continuous, change-stream driven)

The two implementations are not interchangeable. They target different URL patterns, use different throttle mechanisms, and have different runtime triggers.

---

## Phase 1 Decision — Operational Scheduling Constraint

### Selected approach

**Do not run both services' HCSO access concurrently.** This is enforced by operational scheduling, not by code.

### Rationale

A shared rate limiter requires both a TypeScript client and a Python client to read and write the same Redis key atomically before each HCSO request. This is technically feasible but non-trivial to implement correctly across two languages and two deployment environments. The implementation risk is higher than the operational risk it mitigates, given that the two HCSO access patterns are already semi-independent (pipeline HCSO enrichment runs as a scheduled batch; enrichment service HCSO runs continuously but per individual record).

The scheduling constraint is sufficient for the current operational volume.

### Constraint Rules

1. **Do not run `python -m scripts.run_pipeline` (or any pipeline HCSO enrichment script) while `ie-worker` is actively processing an enrichment queue.**

2. **If enrichment auto-enrich is enabled (`IE_AUTO_ENRICH_ENABLED=true`) and a pipeline HCSO run is needed, disable or pause auto-enrich first:**
   - Set `IE_AUTO_ENRICH_ENABLED=false` and restart `ie-worker`, or
   - Set `IE_HCSO_SCRAPE_ENABLED=false` to disable only the HCSO step in the enrichment worker without stopping the entire worker

3. **Scheduled pipeline runs (cron or Render worker) must be timed to avoid overlap with peak enrichment queue activity.** If enrichment runs continuously during business hours, schedule pipeline HCSO steps during off-hours.

4. **Both services' HCSO access must source from the same egress IP.** If either service is ever moved to a different host, cloud region, or VPN, confirm the egress IP before enabling HCSO access.

---

## Phase 1 Affected Files

| File | Change |
|---|---|
| `services/warrantdb-pipeline/RUNBOOK.md` | Add section: "HCSO Scheduling Constraint" |
| `services/warrantdb-pipeline/SCHEDULING.md` | Add note: do not schedule HCSO steps during enrichment worker active hours |
| `warrant-system/docs/architecture/OVERVIEW.md` | Add note to HCSO row in service topology: shared HCSO dependency, no shared rate limiter |

No code changes required for Phase 1.

---

## Phase 2 Decision — Shared Redis Rate Limiter (Deferred)

### Approach (when implemented)

A shared Redis key `hcso:last_request_at` (Unix timestamp, milliseconds) is read and written atomically by both clients before every HCSO HTTP request.

Minimum inter-request interval is configurable: `HCSO_GLOBAL_MIN_INTERVAL_MS` (default: 1000ms).

**Python client pattern:**

```python
import time
import redis

def _hcso_rate_limit_check(r: redis.Redis, min_interval_ms: int = 1000):
    key = "hcso:last_request_at"
    now = int(time.time() * 1000)
    last = r.get(key)
    if last:
        elapsed = now - int(last)
        if elapsed < min_interval_ms:
            time.sleep((min_interval_ms - elapsed) / 1000)
    r.set(key, str(int(time.time() * 1000)))
```

**TypeScript client pattern:**

```typescript
async function hcsoRateLimit(redis: Redis, minIntervalMs = 1000): Promise<void> {
  const key = 'hcso:last_request_at';
  const last = await redis.get(key);
  if (last) {
    const elapsed = Date.now() - parseInt(last, 10);
    if (elapsed < minIntervalMs) {
      await new Promise(r => setTimeout(r, minIntervalMs - elapsed));
    }
  }
  await redis.set(key, String(Date.now()));
}
```

### Phase 2 prerequisites

- Both services must share a Redis instance (or use a Redis accessible to both)
- `HCSO_REDIS_URL` env var added to both services pointing to that shared Redis
- Phase 2 is **not** the same Redis as the BullMQ Redis for either service — a separate shared Redis (or shared namespace) avoids interfering with job queues

### Phase 2 affected files (for reference only — not implementing now)

| File | Change |
|---|---|
| `services/warrantdb-pipeline/enrichment/*.py` | Wrap HCSO HTTP calls with `_hcso_rate_limit_check()` |
| `services/inmate-enrichment/worker/src/providers/hcsoClient.ts` | Wrap HCSO HTTP calls with `hcsoRateLimit()` |
| Both `.env.example` files | Add `HCSO_REDIS_URL=` and `HCSO_GLOBAL_MIN_INTERVAL_MS=` |

---

## `HCSO_SCRAPE_MODE` Discrepancy

A separate but related issue: the inmate-enrichment `.env.sample` and documentation describe `HCSO_SCRAPE_MODE=http` as the default. The code default in `shared/src/config.ts` is `browser`.

- `http` mode: lightweight HTTP scraper, lower resource overhead, faster
- `browser` mode: Selenium-based, higher resource overhead, may be required if HCSO serves JavaScript-rendered pages

**Decision:** Explicitly set `HCSO_SCRAPE_MODE=http` in all non-production environments. Reserve `browser` mode for production only, and document the browser/Selenium runtime requirement separately.

Until the enrichment service is deployed with a confirmed Chromium/Selenium environment, `HCSO_SCRAPE_MODE=http` should be the active setting.

Add to `services/inmate-enrichment/.env.sample`:

```dotenv
# HCSO scrape mode: 'http' (default for dev) or 'browser' (requires Selenium/Chromium).
# Code default is 'browser'; explicitly set 'http' for all non-Selenium environments.
HCSO_SCRAPE_MODE=http
```

---

## Risks If Deferred (Phase 1 constraint)

| Risk | Severity |
|---|---|
| Concurrent HCSO runs from both services cause IP-level throttle or block | High — disables DOB lookup for both services simultaneously with no warning |
| Recovery from an HCSO IP block is manual and time-indeterminate | High — no automated retry or failover |
| Pipeline HCSO step and enrichment worker overlap during a large pipeline run | Medium — likely during initial data load when both run together for the first time |

## Risks If Phase 2 Continues To Be Deferred

| Risk | Severity |
|---|---|
| Operational scheduling constraint breaks down as team grows | Medium — harder to enforce manually with multiple engineers |
| High-volume enrichment queue plus a large pipeline batch creates sustained HCSO concurrency | Medium — detectable by monitoring request counts, but no automatic brake |
