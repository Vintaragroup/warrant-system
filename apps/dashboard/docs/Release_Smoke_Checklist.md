# Release Smoke Checklist

Date: 2025-10-23
Scope: Dashboard CRM + Enrichment UI. Goal is to validate the final UI tweaks, end-to-end wiring, and persistence before staging/prod.

## 1) UI polish sanity

- [ ] Scroll CRM with long Documents/Comms lists — sticky Quick Actions & pills remain visible
- [ ] Scroll page — top-level tabs (Overview/CRM/Enrichment/Activity) remain visible beneath header
- [ ] CRM sub-view pills highlight; URL `?crmView=` syncs and restores from localStorage
- [ ] Keyboard shortcuts on CRM: Alt+S/K/L/D/M switch correctly
- [ ] Page header subtitle breadcrumb updates on sub-view change

## 2) CRM buttons & tools

- Suggestions (CRM suggestions card)
  - [ ] Apply phone (blank) — sets CRM phone without prompt
  - [ ] Apply phone (replace) — prompts before overwrite
  - [ ] Add phone as contact — dedupe by digits, shows toast if duplicate
  - [ ] Apply email (blank/replace) — same prompt behavior as phone
  - [ ] Add email as contact — dedupe by lowercase email
  - [ ] Apply address (blank/replace) — prompt as designed; respects related-party provenance prompt
  - [ ] Save address as alternate — adds label, dedupes by normalized key
  - [ ] Apply all missing — preview lists only blank fields; Apply writes and shows toast
- Client details (top of CRM)
  - [ ] Copy phone, tel: link works
  - [ ] Address: Copy (multi-line), Copy 1-line, Open in Google Maps
  - [ ] Inline OSM map renders; badges show when country/state inferred
  - [ ] Quick-copy City/State/ZIP buttons work
  - [ ] Alternate addresses: Rename, Promote to primary, Remove
- Persistence
  - [ ] Refresh page — changes persist; CRM panel restores last sub-view

## 3) Enrichment — related-party controls

- [ ] Re-enrich on a single party (cooldown respected)
- [ ] Location Pref: Auto, Statewide, City+State — verify API receives preferStatewide (override vs auto)
- [ ] Aggressive flag flows through to API
- [ ] Admin Force bypass (if role allows) — cooldown bypassed; audits show `forced=true`
- [ ] Provenance chips show: Assumed country=US, Base location, Preference
- [ ] Validate phones (bulk) — enqueues and shows toast

## 4) Data flow & CRM transfer

- [ ] Accept a suggested phone/email/address and confirm it appears in CRM primary fields
- [ ] Add a suggested contact — appears under contacts; dedupe works
- [ ] Alternate address label and promote-to-primary update correctly

## 5) Embedded CRM sections regression

- [ ] Check-ins table loads, Ping Now works if GPS is enabled
- [ ] Checklist toggles with completedAt timestamp; required gating on Accept
- [ ] Documents upload, edit (label/note/checklist link), and delete
- [ ] Communications load; retry failed message; deep-link to composer

## 6) Audits & provenance

- [ ] Open related-party audits — records include `preferStatewide` and `forced` flags
- [ ] Spot-check raw payload (admin) for sanity

## 7) Build & deploy readiness

- [ ] Dashboard build PASS
- [ ] API build PASS
- [ ] Env parity matrix reviewed (staging/prod)
- [ ] Release notes drafted; version bump prepared

Notes:

- High-quality threshold alignment: ensure UI `VITE_HIGH_QUALITY_MATCH` and API `HIGH_QUALITY_MATCH` match.
- For mobile QA, use same-origin `/api` proxy to avoid cookie issues.
