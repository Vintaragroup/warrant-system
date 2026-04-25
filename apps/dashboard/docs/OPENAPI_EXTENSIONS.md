# OpenAPI Extensions — CRM and Enrichment

Date: 2025-10-02

This document summarizes the additions made to the API spec to cover CRM contact fields and enrichment endpoints.

## Paths Added

- GET `/cases` — list cases with filters (query/county/status/date ranges/windows/sort/paging)
- GET `/cases/{id}` — retrieve case detail
- PATCH `/cases/{id}/crm` — update CRM contact and metadata (address, phone, assignedTo, followUpAt, documents)
- GET `/cases/{id}/enrichment/latest` — latest enrichment state for a case
- POST `/cases/{id}/enrichment/run` — run (or return cached) enrichment using Whitepages with optional override params
- POST `/cases/{id}/enrichment/select` — select candidate records to attach

## Schemas Added

- `CrmAddress` — streetLine1, streetLine2, city, stateCode, postalCode, countryCode
- `ChecklistItem` — key, label, required, status, completedAt, note
- `Case` — includes `crm_details.address`, `crm_details.phone`, `crm_details.documents`, `attachments`, and core case fields
- `EnrichmentParams` — fullName/firstName/lastName/city/stateCode/postalCode/addressLine1/addressLine2/phone
- `EnrichmentCandidate` — id, score, name, phones[], addresses[]
- `Enrichment` — provider, status, params, requestedAt/expiresAt, requestedBy, candidates[], error, selectedRecords[]

## Validation

- Ran `npm -C server run -s lint:api:bundle` and confirmed spec is valid (3.0.3) and bundle written to `server/src/openapi.bundle.json`.

## Notes

- The endpoints reflect the server implementation currently in `server/src/routes/cases.js`.
- Additional fields can be promoted to the `Case` schema over time; keep payloads additive.
