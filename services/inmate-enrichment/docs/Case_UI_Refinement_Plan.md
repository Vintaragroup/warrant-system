# Case UI Refinement Plan (Dashboard)

This plan finalizes the inmate Case UI prior to production. It aligns UI layouts, server-owned key/proxy constraints, score semantics (0% vs —), high-quality threshold (≥ 75%), and cooldown-aware actions.

Scope covers all main sub‑panels/tabs rendered in the Case view. Each section includes: final polish tasks, acceptance criteria, dependencies, and a quick QA checklist.

## Shared UX/semantics

- Score display: numbers → percent (0 → 0%); null/undefined → —
- High‑quality threshold: 0.75 unless overridden via env (UI: VITE_HIGH_QUALITY_MATCH)
- Server‑owned keys: browser only calls dashboard proxy endpoints; no direct provider calls
- Cooldown: related‑party Re‑enrich disabled during cooldown, shows “Re‑enrich in Xm” with tooltip
- Accessibility: buttons focusable, labels for inputs, summary/aria labels for tables

## Case header (Summary)

Polish
- [ ] Show name, SPN (or booking number), county, booking date, and bond amount with consistent formatting
- [ ] Status chips for enrichment state (NEW/QUEUED/RAN/ERROR) and CRM decision (Pending/Accepted/Denied)
- [ ] Quick actions: Copy SPN, Open in system, Re‑sync case

Acceptance
- [ ] Loading states present; empty fields render —
- [ ] Long names truncated with tooltip

## Stage & ownership (CRM top card)

Polish
- [ ] Stage dropdown + note input save reliably; toast on success/failure
- [ ] Owner text input with basic validation; optional follow‑up presets
- [ ] Checklist progress bar and missing required items banner

Acceptance
- [ ] Updating stage writes a history entry
- [ ] Required checklist banner appears only when relevant

Dependencies
- [ ] Dashboard API endpoints for stage update and history insertion

## CRM details

Polish
- [ ] Phone, structured address (line1/line2/city/state/zip)
- [ ] Qualification notes, decision (Pending/Accepted/Denied) with conditional notes

Acceptance
- [ ] Empty fields show placeholders; save disabled while pending
- [ ] Decision UI persists and matches server value

## Checklist

Polish
- [ ] Required vs optional flag surfaced; completed count accurate
- [ ] Link documents to checklist items and display linkage

Acceptance
- [ ] Mark/unmark reflects immediately; progress bar updates

Dependencies
- [ ] API to read/update checklist per case

## Enrichment

Panels: Menu, Details, Full results

Polish
- [ ] Menu: provider select (from API), inputs with validation, run + force refresh (role‑gated)
- [ ] Details: prefer high‑quality related parties (≥ threshold), show best candidate summary
- [ ] Full: provider candidates sorted by score; related parties table (low‑quality and unscored included)
- [ ] Re‑enrich buttons for related parties are cooldown‑aware (disabled + ETA)

Acceptance
- [ ] Score display follows 0% vs — semantics client‑wide
- [ ] Threshold (UI) matches server default (0.75) unless overridden
- [ ] Related parties include accepted flag, last run, phone/email/address counts

Dependencies (proxy‑safe)
- [ ] GET /api/enrichment/providers (or UI registry; prefer API listing)
- [ ] GET /api/enrichment/related_parties?subjectId=SPN
- [ ] POST /api/enrichment/related_party_pull { subjectId, partyId?, aggressive? }
- [ ] GET /api/enrichment/pipl_matches?subjectId=SPN (optional QA)

QA (example subject SPN 02865254)
- [ ] Details shows two high‑quality related matches (≥ 75%) when available
- [ ] Full shows multiple low‑quality provider candidates and unscored related parties
- [ ] Cooldown label visible after targeted pull

## Documents

Polish
- [ ] Upload with label/note; link to checklist item
- [ ] List shows filename, size, uploaded by, and optional note
- [ ] Delete and replace flows

Acceptance
- [ ] Disabled states during upload; toasts on success/error
- [ ] Linked checklist item shows as satisfied

Dependencies
- [ ] API for file upload (multipart) and metadata storage

## Activity & stage history

Polish
- [ ] Reverse chronological entries with actor, timestamp, short description; optional note
- [ ] Preset activity quick‑adds (left voicemail, text sent, etc.)

Acceptance
- [ ] Entries appear immediately after save; paging or lazy load for long history

Dependencies
- [ ] API to append activity entries and read history

## Performance and resilience

- [ ] React Query caching/staleTime tuned for enrichment and related parties
- [ ] Long tables are virtualized if needed (threshold > 200 rows)
- [ ] All network calls use dashboard proxy (/api/*); no provider keys in browser

## Final QA checklist (pre‑production)

- [ ] Env vars aligned: HIGH_QUALITY_MATCH (server) == VITE_HIGH_QUALITY_MATCH (UI)
- [ ] Proxy allowlist permits only /api/enrichment routes needed by UI
- [ ] SPN 02865254 validation passes (docs/SPN_02865254_Wiring_Check.md)
- [ ] Force refresh visible only to Admin/SuperUser
- [ ] Cooldown ETA visible where applicable; buttons disabled accordingly
- [ ] 0% vs — semantics consistent across Details/Full/Related tables

## References

- API Endpoint Map — docs/API_Endpoint_Map.md
- Related Parties API — docs/Related_Parties_API.md
- Dashboard ↔ Enrichment Proxy Wiring — docs/Dashboard_Proxy_Wiring.md
- Dashboard Enrichment UI Contract — docs/Dashboard_Enrichment_UI_Contract.md
- Full Results Expanders & Filters — docs/Full_Results_Expanders_and_Filters.md
- Wiring check (SPN 02865254) — docs/SPN_02865254_Wiring_Check.md
