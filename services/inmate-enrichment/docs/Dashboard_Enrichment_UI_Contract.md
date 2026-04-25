# Dashboard Enrichment UI Contract

Defines the Dashboard’s expected behavior, data shapes, and wiring to the enrichment service.

## High-level

- The Dashboard never calls provider APIs directly; it only calls the enrichment service’s proxy endpoints.
- Score display semantics:
  - If score is a number (including 0): show as percent (e.g., 0 → 0%, 0.87 → 87%).
  - If score is null/undefined: show em dash “—”.
- High-quality threshold: default 0.75 (read from `VITE_HIGH_QUALITY_MATCH`), matches server default.

## Overview snapshot (cross-tab rollup)

The Overview tab includes a short rollup of enrichment so users can gauge contact readiness at a glance:

- Related parties: `HQ / Total` count.
- Contacts (parties): aggregated `phones • emails • addresses` across related parties, with a hint for how many parties have a phone.
- Subject phones: count; hint shows the primary number if available.
- Re-enrich available: how many related parties are currently eligible (cooldown expired).
- Last related pull: timestamp of the most recent related-party enrichment run.

Notes:

- Subject summary is fetched outside the Enrichment tab to power these tiles.
- Related-party list is already available globally; cooldown eligibility is derived client-side using `lastAudit.cooldownUntil`.

Deep links:

- Clicking tiles navigates to the Enrichment tab with presets:
  - Related parties → `view=full` and `rp=hq` (falls back to `rp=all` if no HQ).
  - Contacts (parties) → `view=full`, `rp=phone`, `rpSort=value`.
  - Subject phones → `view=details`.
  - Re-enrich available → `view=full`, `rpSort=value`.
  - Last related pull → `view=full`.

## CRM panels powered by enrichment

- Client details card (in CRM tab):

  - Shows primary phone and address from CRM; when blanks, shows enrichment fallback (subject summary phones/addresses) with a subtle “from enrichment” hint.
  - Shows CRM owner and follow-up at a glance.
  - “Open Enrichment” button deep-links to `view=full`, `rp=phone`, `rpSort=value`.
  - Convenience: tel: link and Copy for phone; “Open in Maps” and Copy for address.
  - Inline map: When an address is available, show a small OpenStreetMap embed centered on the location with a pinned marker; a hover overlay shows the address; a footer link opens the full map.

  - Inline map and address UX additions:
    - Progressive geocoding with normalization and fallback to the US Census Geocoder (US-only) for higher hit rates.
    - Local caching for geocode lookups: in-memory for the session and localStorage with a 14-day TTL across sessions.
    - Badges under the address when the UI infers missing pieces for geocoding:
      - “state inferred: XX” if a two-letter state code was appended.
      - “country inferred: US” if only the country was appended.
    - Convenience actions next to the address:
      - Copy (multi-line as shown)
      - Copy 1-line (normalized, comma-separated)
      - Open in Google Maps (explicit button in addition to the address link)
      - Quick copy buttons for City, State, and ZIP when available
    - A small Recenter control on the map reloads to the original bounds if the user has panned.
    - When geocoding fails, the map area shows a friendly fallback with a direct “Open in Google Maps” link.

- CRM suggestions card (in CRM tab):

  - Fetches `GET /api/enrichment/crm_suggestions?subjectId=...`.
  - Displays suggested phone, email, and address with source badges (`sources.phone|email|address` split by `|` as chips: facts, pdl, base, related_parties).
  - “Apply phone”, “Apply email”, and “Apply address” buttons:
    - Fill blanks directly; when an existing CRM value is present, ask for confirmation before overwriting.
    - If the suggestion source includes `related_parties`, the UI prompts with a clearer confirmation that you’re applying data that originated from a related party to the CLIENT’s primary fields.
  - “Apply all missing” fills only blank fields; never overwrites existing data. A preview modal lists fields that will be set before confirming.
  - Shows up to 3 top contacts (name, relation, phone/email) sourced from related parties, with a deep link to Enrichment.
  - Each top contact row includes an “Add as contact” action to append the contact to `crm_details.contacts` without altering the client’s primary phone/email. We dedupe by phone/email.

  - Convenience actions: “Copy” next to suggested phone/address; tel: link for phones; “Open in Maps” for addresses.
  - Email convenience: mailto: link and Copy action.

Address parsing/normalization in UI:

- Accepts common formats:
  - `123 Main St, Houston, TX 77001`
  - `Houston, TX 77001`
  - `The Woodlands, TX, US` (trailing country ignored)
- Extracted fields: `streetLine1`, `streetLine2`, `city`, `stateCode`, `postalCode`.
  - When only `City, ST` is present, fills `city` and `stateCode` and leaves other fields empty.

### CRM tab centralization (2025-10-22)

To streamline workflow, the CRM tab now also includes the following sections inline:

- Quick actions: Ping now, Message client, Refresh.
- Scheduled check-ins: The Check-ins table is rendered inside CRM.
- Checklist: The onboarding checklist is shown within CRM.
- Documents: Upload/manage attachments and link to checklist items.
- Communications: Recent messages with retry and edit/resend.

Notes

- For stability, the original top-level tabs (Check-ins, Checklist, Documents, Comms) remain and display the same content. The CRM tab mirrors these sections; no backend changes were required.
- All actions in CRM operate on the same data sources (hooks/endpoints) as the dedicated tabs.
- After validation and team sign-off, we can optionally deprecate or hide the redundant top-level tabs.

## Views and Deep Links

- Enrichment tab sub-views:
  - Menu (default)
  - Details — `?tab=enrichment&view=details`
  - Full results — `?tab=enrichment&view=full`
- “Back to enrichment” clears `view` to return to Menu.

## Name and Score Helpers

- getCandidateName(candidate):
  - fallback chain: fullName > displayName > name > chosenSummary.summary.name > names[].display|formatted|name > first/last > given/family.
- getCandidateScore(candidate):
  - normalizes fields: score|matchScore|confidence|scorePercent
  - accepts 0–1 or 0–100 (converted to 0–1); null when unknown.
- formatScoreDisplay(score):
  - returns `—` for null/NaN; else `${Math.round(score*100)}%`.

## Provider Selection and Actions

- Providers listed via `GET /api/enrichment/providers` (service-owned registry).
- Actions triggered via the listed provider `actions[].path` (e.g., `pipl_first_pull`, `related_party_pull`).
- Provider tests for connectivity: `/api/providers/{pipl|whitepages|pdl}/test`.

## Manual Lookup Form (Menu view)

- Inputs: firstName, lastName, city?, stateCode?, postalCode?, phone?
- State: shows last run, requested by, cache TTL; supports “Force refresh” when allowed.
- On success with high-quality matches (>= threshold): show success window with best candidate summary and an “Attach best” button.

## Enrichment Results Table (Menu)

- Columns: Name, Phones, Addresses, Relations, Actions
- Name line shows: Candidate name; metadata line shows age range, gender, and recordId when present.
- Attach flow: attaches by `recordId`; shows “Attached” state and disables repeat.

## Full Results View

- Summary chips: All, High-quality, With phone (counts shown).
- Sorted by score desc by default; rows highlighted when score >= threshold.
- Pending enhancements:
  - Per-row expander with DOB/age, gender, emails, relations, metadata, raw snippet (when available).
  - Interactive filters that alter the displayed set and persist in URL.

Relation display and deltas:

- Relation shows provider/native label when available (`relationLabel`), otherwise falls back to `relationType`.
- "Last run" column shows relative time and value deltas when present (e.g., `+2p +1e +0a`).
- Optional control allows sorting by "Score" or by "Value" (sum of net-new items from last run).

Related Parties UX details:

- Filters: quick chips for All, High-quality (HQ), With phone, With email, With address. These update the displayed set and persist in the URL.
- Sort: Score (default) or Value. Value = net-new phones + emails + addresses from the last run. Persisted in URL.
- URL params:
  - `view=menu|details|full`
  - `rpSort=score|value`
  - `rp=all|hq|phone|email|address`
  - `cand=all|hq|phone` (provider candidates filter)
- Bulk actions:
  - Re-enrich available: triggers targeted re-enrich for parties whose cooldown has expired.
  - Validate phones: triggers phone validation for all related parties of the subject.
- Row expander:
  - Shows detailed lists with actionable links: tel/mailto and “Open in Maps,” plus copy buttons.
- Admin-only:
  - “Raw Pipl” link opens the provider raw payload (via proxy) in a new tab.
  - Inline “Override” per row to set relationType/label and save.

## Details View

- Shows last run, requested by, cache status/expiry, selected record IDs, and current inputs.

## Error/Edge Semantics

- Show specific API error messages when provided; otherwise use a generic fallback.
- Cooldowns (related-party pulls) are enforced server-side; UI should surface returned cooldown info.
- When no candidates returned: show a dashed border empty state.

## Endpoint Matrix (UI → API)

- Provider list: `GET /api/enrichment/providers`
- Pipl first pull: `POST /api/enrichment/pipl_first_pull`
- PDL first pull: `POST /api/enrichment/pdl_first_pull`
- Related-party pull: `POST /api/enrichment/related_party_pull`
- Related-parties list: `GET /api/enrichment/related_parties?subjectId=...`
- Related-party audits: `GET /api/enrichment/related_party_audits?subjectId=...&partyId?=...`
- Related-party override (admin): `POST /api/enrichment/related_party_override`
- Normalized Pipl matches: `GET /api/enrichment/pipl_matches?subjectId=...`
- Raw payload: `GET /api/providers/pipl/raw?subjectId=...`
- CRM suggestions: `GET /api/enrichment/crm_suggestions?subjectId=...`
- Apply CRM edits: `PATCH /api/cases/:id/crm` (only patch missing fields unless user confirms overwrite). Accepts `phone`, `email`, and `address{...}`.

## Config Flags (UI)

- `VITE_HIGH_QUALITY_MATCH` — default 0.75
- Any new flags should be wired through `src/config/enrichment.ts` and read in `CaseDetail.jsx`.

## Cost and value controls

- Manual-only enrichment is the default; UI surfaces cooldown messages for targeted related-party pulls.
- The service enforces a value gate: only net-new phones/emails/addresses are written; UI surfaces deltas per last run.

## QA Checklist

- [ ] Scores: 0 → “0%”; null → “—” everywhere
- [ ] High-quality threshold highlights rows and success window wording matches `Math.round(threshold*100)`
- [ ] Provider buttons disabled/enabled correctly based on permissions and force capability
- [ ] Attach flow updates selection list and button state
- [ ] Deep links for `view=details|full` work; Back returns to Menu
- [ ] Cooldown messages surfaced for related-party targeted pulls
- [ ] CRM suggestions shown only when available; Apply buttons disabled when missing
- [ ] Applying phone/address updates CRM and shows success toast; overwrites prompt for confirmation
- [ ] “Apply all missing” does not overwrite existing values
- [ ] Suggestions show source badges, tel/maps links, and copy actions work
- [ ] Apply-all preview lists exactly the fields to be set
- [ ] Email field is editable in CRM and suggestion apply/replace behaves like phone/address
