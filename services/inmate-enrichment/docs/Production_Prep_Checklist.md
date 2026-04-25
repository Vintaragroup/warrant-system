# Production Prep Checklist (Dashboard + Enrichment)

This checklist ensures a clean dev → prod handoff, focusing on proxy safety, env alignment, and an SPN‑based smoke.

## Environment and configuration

- [ ] API: set HIGH_QUALITY_MATCH (default 0.75)
- [ ] API: optional PARTY_PULL_COOLDOWN_MINUTES (default 30)
- [ ] API: provider keys set only on the enrichment service (server‑owned)
- [ ] Dashboard: set VITE_HIGH_QUALITY_MATCH (match server), VITE_API_URL to dashboard API origin
- [ ] Dashboard proxy (Render): allowlist only /api/enrichment/*, timeouts set (e.g., 20s), optional shared secret header
- [ ] Vite dev proxy maps /api → http://localhost:4000/api for local

## Build and deploy

- [ ] Build enrichment containers or server app; run migrations if applicable
- [ ] Build dashboard; verify assets and env injection (window.__ENV__ or import.meta.env)
- [ ] Deploy dashboard with proxy rules; redeploy API/worker as needed

## Smoke tests

- [ ] GET /api/health → 200
- [ ] GET /api/enrichment/providers → returns list/set expected
- [ ] GET /api/enrichment/related_parties?subjectId=02865254 → rows present, lastAudit fields populated
- [ ] GET /api/enrichment/pipl_matches?subjectId=02865254 → ok true, rows >= 1 (when provider enabled)

## UI validation (SPN 02865254)

- [ ] Details panel: two high‑quality related matches (≥ 75%) when available
- [ ] Full: provider candidates sorted by score; related parties table shows low‑quality and unscored
- [ ] Re‑enrich disabled during cooldown; shows ETA
- [ ] Score semantics: 0% vs — consistent

## Monitoring and rollback

- [ ] Logs wired (API + Worker + Dashboard access logs)
- [ ] Incident runbook available: docs/Incident_Runbook.md
- [ ] Ability to disable provider Temporarily via env without rebuild
- [ ] Rollback instructions tested (deploy previous image or commit)
