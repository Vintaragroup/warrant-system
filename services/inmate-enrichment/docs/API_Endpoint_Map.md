# API Endpoint Map (Inmate Enrichment)

Authoritative mapping of features → endpoints, including common parameters and sample requests.

Note on OpenAPI coverage:

- As of 2025-10-22, the live OpenAPI spec (`/api/openapi.json`) includes related-party endpoints and normalized Pipl matches in addition to prospects/sweeps/coverage. If anything appears missing in your environment, rebuild the API container and refresh Swagger at `/api/docs`.

## Health & Docs

- GET /health — liveness
- GET /api/openapi.json — OpenAPI spec
- GET /api/docs — Swagger UI

Dashboard proxy (recommended):

- In production, proxy dashboard calls under `/ext/enrichment/*` to the enrichment API `/api/*` as documented in `docs/Dashboard_Proxy_Wiring.md`.

## Provider Registry & Tests

- GET /api/enrichment/providers
  - Returns: [{ id, label, enabled, ttlHours, capabilities, actions[], tests[] }]
- GET /api/providers/pipl/test
- GET /api/providers/pdl/test
- GET /api/providers/whitepages/test
  - New:
    - GET /api/providers/whitepages/last?subjectId?&step?
    - GET /api/providers/whitepages/raw?subjectId=SPN
    - Raw payloads are stored for phone validations under step "whitepages_phone_lookup" with payload { request: { phone }, response }

## Subject Enrichment

- POST /api/enrichment/pipl_first_pull
  - Body: { subjectId: string, overrideLocation?: boolean, aggressive?: boolean }
  - Result: { ok, subjectId, candidateName, matchScore, chosenSummary, relationshipsFound, relatedPartiesUpserted }
- POST /api/enrichment/pdl_first_pull
  - Body: { subjectId: string, overrideLocation?: boolean, allowDemo?: boolean }
- GET /api/providers/pipl/raw?subjectId=SPN
- GET /api/enrichment/pipl_matches?subjectId=SPN
  - Normalized: { ok, count, rows: [{ idx, name, match, phones[], emails[], addresses[], usernames[] }] }
- GET /api/enrichment/subject_summary?subjectId=SPN
  - Returns concise subject view: base facts, steps, relatedParties[] (includes relationLabel), piplPreview, pdl, flags

## Related-Party Enrichment

- POST /api/enrichment/related_party_pull
  - Body: { subjectId: string, maxParties?: number, requireUnique?: boolean, matchMin?: number, partyId?: string, partyName?: string, aggressive?: boolean }
  - Cooldown: PARTY_PULL_COOLDOWN_MINUTES (default 30) for targeted runs
- GET /api/enrichment/related_parties?subjectId=SPN
  - Response includes contacts.phones[], contacts.emails[], and addresses[] for UI counts
  - lastAudit contains match, accepted, and net-new fields: netNewPhones, netNewEmails, netNewAddresses, gainedData[]
- GET /api/enrichment/related_party_audits?subjectId=SPN&partyId?=ID&limit=50
- POST /api/enrichment/related_party_override
  - Body: { subjectId: string, partyId: string, relationType?: string, relationLabel?: string, confidence?: number }
  - Use to correct classification (e.g., set to family); immediately reflected in related_parties and subject_summary
- POST /api/enrichment/related_party_validate_phones
  - Body: { subjectId: string, maxPerParty?: number }

See also: docs/Related_Parties_API.md for full contract and score semantics (0% vs —, HQ ≥ 75%).

Proxy note:

- Dashboard should call `/ext/enrichment/enrichment/related_parties` etc.; the proxy rewrites to `/api/enrichment/related_parties` on the enrichment service.

## Operational & Coverage

- GET /api/enrichment/coverage72h
- GET /api/enrichment/coverage24h?minBond=1000
- GET /api/enrichment/prospects_window?windowHours=48&minBond=500&limit=10
- GET /api/enrichment/queue_stats
- GET /api/enrichment/provider_stats?windowHours=24
- GET /api/enrichment/provider_unresolved_breakdown?windowHours=24

## Jobs API

- POST /api/enrichment/run
  - Body: { subjectIds: string[], mode?: 'standard'|'deep'|'dob-only', force?: boolean, jobSuffix?: string, windowHoursOverride?: number, minBondOverride?: number }
- GET /api/enrichment/status?jobId=...
- POST /api/enrichment/cancel { jobId }
- POST /api/enrichment/dob_sweep { windowHours?, minBond?, limit?, suffix? }
- GET /api/enrichment/batch?suffix=...
- GET /api/enrichment/unresolved_breakdown?suffix=...
- GET /api/enrichment/unresolved_samples?suffix=...&limit=3

## Sample Requests

```bash
# Providers list
curl -sS http://localhost:4000/api/enrichment/providers | jq

# Pipl first pull
curl -sS -X POST http://localhost:4000/api/enrichment/pipl_first_pull \
  -H 'Content-Type: application/json' \
  -d '{"subjectId":"A12345","aggressive":true}' | jq

# Related-party targeted pull (partyId preferred)
curl -sS -X POST http://localhost:4000/api/enrichment/related_party_pull \
  -H 'Content-Type: application/json' \
  -d '{"subjectId":"A12345","partyId":"Jane Doe|family","matchMin":0.75}' | jq

# Prospects window
curl -sS "http://localhost:4000/api/enrichment/prospects_window?windowHours=48&minBond=500&limit=10" | jq
```
