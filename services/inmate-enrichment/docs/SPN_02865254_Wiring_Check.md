# Wiring Verification — SPN 02865254

This guide verifies the dashboard enrichment pages are correctly wired to the enrichment service for subject SPN 02865254.

## Expected data (from Mongo)

- Subject (simple_harris): CHRISTOPHER VELA (DOB 1989-01-21), enrichment_status: SUCCEEDED
- Related parties: several zero-match entries (low quality) and at least one high-quality accepted match:
  - Example HQ: `name: "Lynee Marie Vela"`, `lastAudit.match ≈ 0.93`, `accepted: true` (pipl_party_pull)
  - Multiple audit rows show repeated accepted pulls with personsCount=7
- Raw provider payloads exist for pipl_first_pull and pipl_party_pull

## Dashboard → API wiring

UI components (CaseDetail.jsx) now:

- Fetch related parties with: GET /enrichment/related_parties?subjectId=<SPN>
  - Hook: `useRelatedParties(caseId)`
  - Data shape used: `{ partyId, name, relationType, contacts?, addresses?, lastAudit: { match, accepted, at, provider } }`
- Compute `highQualityRelated` as:
  - accepted === true OR (lastAudit.match >= HIGH_QUALITY_MATCH)
  - Show top 2 on Enrichment → Details
- Full results includes two sections:
  1) Provider candidates (from the enrichment first pull)
  2) Related parties table (low-quality included) with: Score, Name, Relation, Phones, Emails, Addresses, Accepted, Last run

Aux endpoints (optional for deeper debug):
- GET /enrichment/providers
- GET /enrichment/providers/pipl/raw?subjectId=<SPN>
- GET /enrichment/pipl_matches?subjectId=<SPN>

## Score semantics

- Any numeric score renders as a percent (0 → 0%, 0.78 → 78%)
- Null/undefined scores render as em dash “—”
- High-quality threshold: 0.75 by default (from VITE_HIGH_QUALITY_MATCH)

## What you should see for SPN 02865254

- Enrichment → Details: two high-quality people (e.g., includes “Lynee Marie Vela”) with accordions showing:
  - Current phone, all phones; Email; Current address, all addresses; Demographics; Relation type
  - Attach button only appears for provider candidate rows (related-party rows omit it)
- Enrichment → Full results:
  - Provider candidates sorted by score, high-quality highlighted
  - Related parties table: includes several rows with 0% and some with —; acceptance Yes/No displayed

## Troubleshooting

- If “Related parties” is empty:
  - Ensure API has related_parties records for subjectId=02865254
  - Verify dashboard proxy is reaching enrichment service (GET /enrichment/_proxy_health)
- If scores are all em dashes:
  - Check `lastAudit.match` presence; 0 should render as 0%, null as —
- If no high-quality appears in Details:
  - Verify `accepted: true` rows exist or matches ≥ configured threshold

## Notes

- Contacts may be empty for some parties pending downstream validation; UI renders em dashes
- Accordions default open to reduce click friction during QA
