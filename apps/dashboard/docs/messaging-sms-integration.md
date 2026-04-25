# Messaging (SMS) Integration Plan

_Last updated: 2025-10-02_

## 1. Current State Snapshot
- `src/pages/Messages.jsx` now uses React Query to read `/api/messages` and includes a basic composer tied to the Twilio queue; thread view and template management remain TODO.
- Backend exposes messaging queue + Twilio adapter (`GET /api/messages`, `POST /api/messages/send`, inbound/status webhooks) with audit logging; outbound delivery still requires live credentials.
- Twilio is the approved provider per decision brief; sandbox credentials pending provisioning.
- Check-in manual pings enqueue GPS jobs but still need automated scheduling + reminder hand-offs.
- Compliance artefacts (opt-out automation, retention policy) need to be drafted before staging.

## 2. Task Breakdown

### 2.1 Provider & Infrastructure
- [x] Finalize provider selection (Twilio vs. SendGrid SMS vs. alternative) with legal/compliance review and cost analysis. (See `docs/messaging-provider-brief.md`.)
- [ ] Provision sandbox messaging credentials (account SID, token, messaging service SID, webhook auth secret) and assign test numbers.
- [x] Expand environment templates (`.env.example`, deployment manifests) with messaging variables and rotate secrets into vault/SOPS.
- [x] Align queue/job infrastructure (shared Bull/BullMQ instance) so scheduled SMS reminders reuse existing Redis setup.

### 2.2 Backend Messaging Service
- [x] Create/extend Mongo message model (direction, provider IDs) — existing schema supports queue integration.
- [x] Implement provider-agnostic messaging service (`server/src/services/messaging.js`) with Twilio adapter + BullMQ worker.
- [ ] Add REST endpoints:
  - [x] `GET /api/messages` (filters, pagination, thread summary)
  - [ ] `GET /api/messages/:threadId` (full conversation + delivery receipts)
  - [x] `POST /api/messages/send` (compose outbound SMS from UI/templates/check-in jobs)
- [x] Implement inbound webhooks (`/api/messages/twilio/status` + `/api/messages/twilio/inbound`) with signature validation.
- [ ] Integrate message composer with check-in reminders, payment notices, and manual officer sends (shared helper to enqueue SMS jobs).
- [x] Emit audit logs and structured events for SOC2 evidence and analytics dashboards.
- [x] Unify existing case-scoped `/cases/:id/messages` + resend flows with the new messaging service (shared validation, permission checks).

### 2.3 Frontend & UX
- [x] Replace mock data in `Messages` page with React Query hooks hitting new messaging endpoints.
- [x] Build baseline message composer (caseId + recipient + body) wired to API; add template picker/scheduling in follow-up.
- [ ] Add conversation thread view with real-time status badges and retry flow for failed messages.
- [ ] Implement template management UI (CRUD) and hook into backend template storage.
- [ ] Surface messaging activity within `CaseDetail` and `CheckIns` panels to keep context aligned.

### 2.4 Compliance, Security & Operations
- [ ] Implement opt-in/opt-out handling (STOP/HELP keywords), quiet hours, and per-department messaging policies.
- [ ] Enforce role-based permissions (`communications:*` scope) and log user actions (who sent which SMS).
- [ ] Define retention policy, export tooling, and redaction workflow for messaging transcripts.
- [ ] Document on-call escalation and failure recovery runbooks (provider downtime, webhook retries, rate limit breaches).

### 2.5 Testing & Observability
- [ ] Add unit tests for messaging service, template rendering, and webhook signature validation.
- [ ] Create integration tests using provider sandbox/mocked client to cover send, delivery receipt, and inbound reply flows.
- [ ] Wire automated smoke jobs (e.g., nightly test SMS to sandbox number) and alert on failures.
- [ ] Instrument metrics/logging (queue depth, send latency, error rate) and feed into dashboard + PagerDuty alerts.

## 3. Dependencies & Open Questions
- Final decision on job queue hosting (shared Redis vs. standalone) impacts message scheduling timelines.
- Need confirmed contact data source of truth (phone numbers, consent flags) to avoid conflicting updates.
- Determine whether two-way messaging requires short code, toll-free, or local presence numbers per jurisdiction.
- Clarify retention requirements with compliance (court admissibility, redaction rules, subpoena process).

## 4. Verification Checklist
- [ ] Outbound SMS from UI reaches provider sandbox number with correct template interpolation. *(Blocked by US A2P 10DLC registration – Twilio returning error 30034 as of 2025-10-03.)*
- [ ] Inbound reply creates/updates thread, visible within 30 seconds in `Messages` page.
- [ ] Delivery receipt transitions message status from `queued` → `sent` → `delivered` (or `failed`) and logs event payload.
- [ ] Check-in reminder flow can enqueue and dispatch an SMS, recording ping association.
- [ ] Opt-out keyword (`STOP`) updates consent flag and blocks future sends until re-subscribed.
- [ ] Monitoring dashboard shows live metrics and raises alert on >5% failure rate over 15 minutes.

## 5. Progress Log
- _2025-10-02:_ Documented current gaps and end-to-end task list; awaiting provider selection to begin implementation.
- _2025-10-02:_ Wired Twilio messaging queue + REST endpoints, added `/messages/send` composer, and updated docs; awaiting sandbox credentials and thread view implementation.
- _2025-10-03:_ Prefilled messaging composer with query params, added case-level "Message client" shortcut, awaiting A2P approval for live delivery.
## 6. Immediate Next Steps
- [x] Draft provider decision brief comparing Twilio vs. alternatives with compliance requirements and submit for approval.
- [x] Design updated messaging API surface (new `/api/messages` + composer endpoint) mapping to existing `Message` schema and case audit trail.
- [x] Prototype queue worker scaffolding that consumes `Message` jobs and updates status to validate Redis/Bull setup.
- [x] Update `.env.example` + deployment manifests with placeholder messaging credentials once provider chosen.

