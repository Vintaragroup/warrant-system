# Enrichment wiring: current status and next steps

Last updated: 2025-10-21

This document tracks how the dashboard’s Enrichment feature is currently wired, what data is shown, and what is still pending.

## Overview

- Architecture: server-owned provider keys (Enrichment service) + proxy-only dashboard.
- Back end: Node/Express + MongoDB + Redis/BullMQ with OpenAPI. Related parties and audits are computed on the service.
- Front end: React + Vite dashboard. The Enrichment panel has three sub-views: Menu (run), Details, and Full.
- Scoring semantics:
  - Scores normalized to [0, 1]. If a provider returns 0–100, we divide by 100.
  - Display: 0% is shown as "0%"; absent/unknown score is shown as "—".
  - High-quality threshold: 0.75 (75%), configurable from `HIGH_QUALITY_MATCH`.

## Data flow (proxy-only)

- Providers list: `GET /enrichment/providers` (proxied) → used to populate provider dropdown.
- Case enrichment (provider candidates):
  - `useCaseEnrichment(caseId, providerId)` → returns `{ enrichment: { candidates, selectedRecords, requestedAt, error? }, nextRefreshAt, cached }`.
  - Actions: `useRunCaseEnrichment` (POST) and `useSelectCaseEnrichment` (attach by recordId).
- Related parties of the subject:
  - `useRelatedParties(subjectId)` → `GET /enrichment/related_parties?subjectId=` → returns an array or `{ rows: [...] }` with items like `{ partyId, name, relationType, lastAudit }`.
  - Audits per related party: `useRelatedPartyAudits(subjectId, partyId, limit)` → `GET /enrichment/related_party_audits?...` returning flattened audit rows (not yet used in UI).

All the above endpoints are called through the dashboard API proxy; no provider keys or direct provider calls leave the browser.

## What the UI shows today

- Menu view
  - Provider selector and manual input form (name, city, state, postal, phone)
  - Run/Force buttons; cache status and last-run metadata
  - "Enrichment success" banner when ≥1 high-quality candidate (from provider candidates)
  - Candidates table: Name, Phones, Addresses, Relations, and Attach action for provider candidates

- Details view
  - Metadata: Last run, Requested by, Cache status, Selected records, Current inputs
  - High-quality matches accordions (up to 2 entries)
    - Preference: uses Related Parties if any meet the HQ threshold; otherwise falls back to provider candidates
    - For provider candidates: Attach button shows when a `recordId` exists
    - For related parties: shows name, score, relation; contact info is currently blank unless present directly on the party object

- Full view
  - Chips showing counts: All, High-quality, With phone (provider candidates)
  - Provider candidates table rendered (sorted by score)
  - Related parties table appended with: Score, Name, Relation, Phones, Emails, Addresses, Accepted, Last run
    - Sorting: by normalized score (desc)
    - Accepted: based on `lastAudit.accepted` ("Yes"/"No")

- Score formatting is consistent everywhere (0% vs —) and the HQ threshold is 75%.

## Known gaps and pending work

1) Related parties: contact details not populated in Details or Full
- Today, `useRelatedParties` returns basic info + `lastAudit` only. In screenshots the Details accordions show "—" for current phone/email/address.
- Options to fix:
  - A) Client-side aggregation via audits: for each party, call `useRelatedPartyAudits(subjectId, partyId, limit=25)` and derive latest phones/emails/addresses. Cache results by partyId.
  - B) Add a server endpoint: `GET /enrichment/related_party_summary?subjectId=&partyId=` that returns `{ phones: string[], emails: string[], addresses: string[] }` pre-aggregated. Fewer round-trips and smaller bundle code.
- Recommendation: implement B on the service, with optional fall-back to A.

2) Provider candidates: row expanders and filters (spec exists)
- Spec doc: `inmate_enrichment/docs/Full_Results_Expanders_and_Filters.md`.
- Pending:
  - Expanders per row to show DOB/age, gender, emails, relations, raw snippet
  - Filters (All | High-quality | With phone) persisted to URL and toggling the table

3) UI toggle between "Provider candidates" and "Related parties" in Full view
- Optional: Add tabs or a segmented control to switch the primary table. Current implementation shows provider candidates first with a related-parties table appended.

4) Actions for related-party rows
- Implemented: "Re-enrich" button in both Details (for HQ related) and Full (per row). Triggers `POST /enrichment/related_party_pull` via the proxy with `{ subjectId, partyId, aggressive: true }`.
- Pending: "View audits" drawer and "Mark accepted/denied" (if authorized).

5) Attach semantics
- Attaching currently supported only for provider candidates via `recordId`.
- Non-provider related parties do not have a `recordId`; any future attach semantics would need a design (e.g., linking partyId to case contacts/CRM).

## SPN 02865254: expected vs observed

- Full view:
  - Provider candidates: one 100% "Unknown" entry with phone and address → displayed at top as expected.
  - Related parties: two HQ results (Lynee Marie Vela ~93%, Toribio J Vela ~81%) sorted above low-quality/no-score rows.
  - Accepted column: shows "Yes" for those two entries (from `lastAudit.accepted`).
- Details view:
  - The two HQ related parties appear in the accordions. Contact sections are currently blank (see gap #1); this is expected until we aggregate contacts.

## Implementation notes (frontend)

- Score normalization helper covers common provider fields: `score`, `matchScore`, `confidence`, `scorePercent`.
- Related parties HQ selection: `lastAudit.match` is parsed to a number and clamped to [0,1].
- Preference logic in Details: if any related parties meet the HQ threshold, they take precedence over provider candidates for the top-two presentation.
- Only provider candidates with a `recordId` show the Attach button.

## Next steps (proposed)

1) Related-party contact aggregation (server)
- Add endpoint `GET /enrichment/related_party_summary?subjectId=&partyId=` returning `{ phones, emails, addresses, demographics? }`.
- Implement aggregation over latest successful audits with simple de-duplication.
- Frontend: add `useRelatedPartySummary` hook, fetch on demand in Details and Full, and populate accordions and counts.
- Acceptance criteria: Details accordions show at least one phone or address for Lynee/Toribio when present in provider payloads; counts match Full table.

2) Provider candidates expanders and filters (frontend)
- Implement row expanders + URL-persisted filter chips per the spec.
- Acceptance criteria: toggling filters updates the table; expanders reveal DOB/age, gender, emails, relations, and an optional raw snippet link.

3) Optional: Full-view toggle (frontend)
- Add a segmented control to switch between Provider and Related Parties as the primary table; remember selection in the URL.

4) Optional: Related-party actions
- Add actions column with View audits / Re-enrich party (guarded by permissions) and wire to `useRelatedPartyAudits` and `useRelatedPartyPull`.

## Verification steps

- Providers list loads; provider selection persists across refresh within the session.
- Run enrichment returns candidates; success banner appears when any candidate ≥ 75%.
- Full view shows counts (All/High-quality/With phone) and related parties table with correct score semantics and acceptance status.
- Details view shows the 2 HQ matches (related first, otherwise candidates). Until gap #1 is resolved, contact fields may appear as "—" for related parties.

---
If you need any additional display rules or data mappings, let me know and I’ll incorporate them into the next iteration.
