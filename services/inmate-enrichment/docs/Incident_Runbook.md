# Incident Runbook — Enrichment Service & Dashboard

Use this playbook during regressions, outages, or UI/API drift.

## 0) Snapshot

- Record time, branch/commit, and a short description of what broke.
- If feasible, capture a HAR or short screencast for UI anomalies.

## 1) Fast Health Checks (60 seconds)

- API liveness: `GET http://localhost:4000/health` → 200
- Docs reachable: `GET /api/openapi.json` and `GET /api/docs`
- Providers: `GET /api/enrichment/providers` → check enabled flags and actions

## 2) Provider Connectivity

- `GET /api/providers/pipl/test` — ok/disabled
- `GET /api/providers/whitepages/test` — ok/disabled
- `GET /api/providers/pdl/test` — ok/disabled
- If a provider expected to be enabled shows disabled:
  - Check `.env` keys and `PROVIDER_*_ENABLED`
  - Restart API after changes

## 3) Dashboard Sanity

- Enrichment tab shows Menu/Details/Full; deep links `?tab=enrichment&view=...` work
- Run a manual lookup; check counts, success window, and attached records list
- Verify name fallback and score display semantics: 0% vs —

## 4) Rebuild / Restart

- Monorepo rebuild (local dev):

```bash
npm run -w shared build
npm run -w api build
```

- Compose (recommended):

```bash
docker compose up -d --build api worker
```

- Verify logs for the API container for startup errors

## 5) Datastore & Queue

- Mongo (replicaset `rs0`) is up (compose starts it)
- Redis: port 6379 accessible (compose exposes it)
- Queue stats:
  - `GET /api/enrichment/queue_stats` — job counts and throughput

## 6) Inspect Raw Payloads

- Latest subject payload (Pipl): `GET /api/providers/pipl/raw?subjectId=SPN`
- Normalized matches: `GET /api/enrichment/pipl_matches?subjectId=SPN`
- If body is missing, re-run a first pull for that subject

## 7) Cooldowns & Cache

- Related-party targeted pulls may be skipped if within cooldown window
  - Default: PARTY_PULL_COOLDOWN_MINUTES=30
  - API response includes `cooldownActive`, `lastTargetedAt`, `nextEligibleAt`
- Raw payload TTL (storage): RAW_PAYLOAD_TTL_HOURS (default 72)

## 8) Operational KPIs (Optional)

- Coverage (72h): `GET /api/enrichment/coverage72h`
- Coverage (24h, minBond): `GET /api/enrichment/coverage24h?minBond=1000`
- Prospects window: `GET /api/enrichment/prospects_window?windowHours=48&minBond=500&limit=10`
- Provider stats: `GET /api/enrichment/provider_stats?windowHours=24`
- Provider unresolved breakdown: `GET /api/enrichment/provider_unresolved_breakdown?windowHours=24`

## 9) Rollback Strategy

- If a UI change caused regression:
  - Revert the last UI patch to prior stable commit
  - Validate deep links and Menu/Details/Full flows
- If an API change caused regression:
  - Revert the last API change and redeploy container
  - Run smoke checks (health, providers, one targeted pull)

## 10) Post‑Mortem Notes

- Root cause, impact window, fixes, follow-ups
- Update docs if behavior/thresholds changed

---

## Appendix A — Local Dev Stack Recovery (Docker Desktop)

Symptoms seen recently

- Docker Desktop backend errors: `connect ECONNREFUSED .../docker.sock` or `backend.sock` → CLI/Compose fail; containers appear but logs/exec don’t attach.
- Dashboard compose start fails: `failed to set up container networking: network <id> not found` (stale compose network after daemon restart).
- API 4000/health unreachable while Docker shows containers “Running”.

Fast recovery playbook

1. Restart Docker Desktop (Troubleshoot → Restart). If CLI still can’t reach the daemon, Quit Docker Desktop and relaunch.
2. Bring enrichment stack up and wait for health:

```
npm run stack:up
```

- Health check: `curl -s http://localhost:4000/health | jq` → `{ ok: true }`
- Provider check: `curl -s http://localhost:4000/api/providers/whitepages/test | jq`

3. If Dashboard compose network errors occur (bail-bonds-dashboard):

```
docker compose -f ../WarrentDB/Bail-Bonds-Dashboard/docker-compose.dev.yml down --remove-orphans
```

- Re-run Dashboard dev (choose ONE UI path):
  - Preferred: Local Vite UI on 5173 + compose api-dev on 8080
    - Start Vite via workspace task or `npm run dev` in Bail-Bonds-Dashboard
    - Compose starts api-dev automatically when using its task; health: `curl -s http://localhost:8080/api/health | jq`
  - OR fully containerized UI (`web-dev`) — stop local Vite first to free 5173.

Useful scripts (added to monorepo root)

- `npm run stack:status` — show compose status (enrichment)
- `npm run stack:logs` — tail api/worker logs
- `npm run stack:restart` — restart api/worker only
- `npm run stack:down` — stop enrichment containers and network

Port & env clarifications

- Enrichment API: http://localhost:4000
- Dashboard API (dev): http://localhost:8080
- Dashboard UI (Vite): http://localhost:5173
- Redis URL:
  - Inside containers: `redis://redis:6379` (compose injects this for api/worker)
  - Local-only runs: `redis://127.0.0.1:6379` (ensure a local Redis is running or map from compose)

Prevention

- Compose hardening is in place: project name, api/worker `restart: unless-stopped`, API `/health` healthcheck.
- Prefer the workspace tasks to start/stop services; they wait for health and reduce mis-ordering.
