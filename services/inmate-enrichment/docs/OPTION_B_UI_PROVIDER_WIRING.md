# Option B: UI relies on Enrichment for Providers

This guide shows how to make the Dashboard UI source providers directly from the Enrichment service and auto-apply enrichment results (Pipl first) without extra clicks.

## Summary
- Enrichment API exposes `GET /api/enrichment/providers` with the list of providers, based on enrichment `.env`.
- Dashboard adds a pass-through proxy route to forward `/api/enrichment/providers` to the Enrichment service.
- UI updates the provider dropdown to consume this endpoint and shows enabled providers.
- When a user selects a provider (Pipl first), the UI triggers the provider action and auto-applies results to CRM (fill missing phone/email/employer/jobTitle/address, append relations as contacts, no overwrite).

## Enrichment prerequisites
Set keys and toggles in `inmate_enrichment/.env`:

```
PROVIDER_PIPL_ENABLED=true
PIPL_API_KEY=...  # required
PROVIDER_WHITEPAGES_ENABLED=true  # optional, set true to list WP in providers
WHITEPAGES_API_KEY=...            # optional, if you want WP actions
PROVIDER_PDL_ENABLED=false  # optional
```

Verify:
- `GET http://localhost:4000/api/enrichment/providers` returns Pipl and Whitepages enabled, PDL disabled.
- Docs: `http://localhost:4000/api/docs` → search "providers".

## Dashboard API: proxy route
Add a pass-through route so UI can call the Dashboard API:

- `GET /api/enrichment/providers` → forwards to Enrichment `/api/enrichment/providers`

Implementation sketch (Express):

```js
// server/src/routes/enrichmentProxy.js
router.get('/enrichment/providers', async (req, res) => {
  try {
    const r = await fetch(process.env.ENRICHMENT_BASE_URL + '/api/enrichment/providers');
    const text = await r.text();
    res.status(r.status).type('application/json').send(text);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
```

Configure `ENRICHMENT_BASE_URL=http://localhost:4000` (or docker service name) in the Dashboard `.env`.

## UI: use providers from enrichment
Update the provider hook:

```ts
// src/hooks/cases.ts (or similar)
export function useEnrichmentProviders() {
  return useQuery(['enrichment-providers'], async () => {
    const r = await fetch('/api/enrichment/providers');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const list = (j.providers || []).filter((p: any) => p.enabled);
    return list.map((p: any) => ({ id: p.id, label: p.label }));
  });
}
```

## UI: auto-apply on select (Pipl first)

Behavior:
- On Case load, prefill from subject summary: `GET /api/enrichment/subject_summary?subjectId=SPN`.
- On selecting `pipl` in the dropdown, immediately POST `/api/enrichment/pipl_first_pull { subjectId }`.
- When it returns, apply to CRM without overwriting existing fields:
  - phone/email/employer/jobTitle/address → fill only if missing
  - relations → append to contacts[] with de-dup

Sketch:

```ts
async function runProvider(providerId: string, subjectId: string) {
  if (providerId === 'pipl') {
    const r = await fetch('/api/enrichment/pipl_first_pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectId }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    // then PATCH /api/cases/:id/crm with fields that are missing
  } else if (providerId === 'whitepages') {
    await fetch('/api/enrichment/related_party_validate_phones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectId }) });
  }
}
```

Toast a short result summary (e.g., phones/emails added) and refresh the Case detail.

## Auto-prefill from subject summary
Use `GET /api/enrichment/subject_summary?subjectId=SPN` to prefill the Enrichment tab with any data that already exists in the inmate record (phones, addresses, flags).

## Error handling & UX tips
- If only one provider is returned, show a small note: "To enable more providers, set keys in enrichment .env".
- If Pipl returns no matches, show "No acceptable match" and don’t update CRM.
- Display provider match % for transparency.

### Troubleshooting
- Pipl not listed?
  - Ensure `PROVIDER_PIPL_ENABLED=true` and `PIPL_API_KEY` is set in enrichment `.env`.
- Whitepages not listed?
  - Ensure `PROVIDER_WHITEPAGES_ENABLED=true` and `WHITEPAGES_API_KEY` is set.
- Endpoint reachable?
  - From Dashboard server container/host: `curl -s http://localhost:4000/api/enrichment/providers | jq .`
  - Through Dashboard proxy (after you add it): `curl -s http://localhost:8080/api/enrichment/providers | jq .`

### Quick verify (local)
```bash
# Providers
curl -s http://localhost:4000/api/enrichment/providers | jq .

# Suggestions for a subject
curl -s "http://localhost:4000/api/enrichment/crm_suggestions?subjectId=SPN123" | jq .

# Pipl first pull (simulate UI select)
curl -s -X POST http://localhost:4000/api/enrichment/pipl_first_pull \
  -H 'Content-Type: application/json' \
  -d '{"subjectId":"SPN123"}' | jq .
```

## Acceptance criteria
- Dropdown shows providers from enrichment endpoint (Pipl visible with your current `.env`).
- Selecting Pipl auto-runs, applies missing fields, refreshes case, and shows a success toast.
- No Dashboard registry duplication required.
```
