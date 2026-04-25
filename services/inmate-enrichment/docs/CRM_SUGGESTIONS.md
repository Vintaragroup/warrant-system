# CRM Suggestions Endpoint

Provides a suggested CRM patch for a subject based on existing enrichment facts and related parties.

- Endpoint: `GET /api/enrichment/crm_suggestions?subjectId=SPN`
- Returns: `{ ok, subjectId, suggestions, sources }`

## Suggestions shape

```json
{
  "ok": true,
  "subjectId": "A12345",
  "suggestions": {
    "phone": "+1 (713) 555-1010",
    "email": "example@example.com",
    "address": "456 Oak St, Houston, TX 77001",
    "employer": null,
    "jobTitle": null,
    "contacts": [
      {
        "name": "Jane Doe",
        "relation": "family",
        "phone": "+1 (713) 555-3030",
        "email": null
      }
    ]
  },
  "sources": {
    "phone": "facts|pdl",
    "email": "facts|pdl",
    "address": "facts|base",
    "contacts": "related_parties"
  }
}
```

- `phone`, `email`, `address` are the first non-empty values from subject `facts` and/or provider data.
- `contacts` is a small list from `related_parties` with any known phone/email.
- `sources` indicates where each field came from.

## Usage in UI

- On Case Detail load, call this endpoint to prefill missing CRM fields (read-only preview).
- When the user confirms, send a single PATCH `/api/cases/:id/crm` with only the missing fields.
- If a provider is selected (e.g., Pipl), run it first, then refresh suggestions and apply.

UI details:

- The Dashboard shows a "CRM suggestions" card with suggested phone/email/address and source badges (chips for facts, pdl, base, related_parties); per-field Apply buttons never overwrite existing CRM values without explicit confirmation.
- An "Apply all missing" action fills only blanks.
- Before applying all, a preview modal lists the fields that will be set.
- Address suggestions are parsed client-side into `streetLine1/2, city, stateCode, postalCode` and support formats like `123 Main St, Houston, TX 77001`, `Houston, TX 77001`, and `The Woodlands, TX, US` (country suffix ignored).

Convenience actions:

- Phone values include a tel: link and a Copy button.
- Email includes a mailto: link and a Copy button.
- Address values include an "Open in Maps" link and a Copy button.

## Notes

- Employer and jobTitle are not derived in this pipeline yet (left as null).
- De-dup contacts by name and do not overwrite existing CRM fields.
- CRM PATCH accepts `phone`, `email`, and `address` fields; only patch missing unless the user confirms overwrite.
