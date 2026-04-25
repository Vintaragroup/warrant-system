# Check-ins Integration Plan

_Last updated: 2025-01-15_

## 1. Goals
- Replace the legacy check-in screens with the Figma-generated components while keeping existing case relationships intact.
- Support scheduled in-person check-ins, attendance logging, and reminder workflows.
- Introduce GPS ping support (2–3 times per day) for clients who consent as part of bond acceptance.
- Ensure auditability (attendance, location pings, notifications) for SOC2 / evidentiary requirements.

## 2. Current State Summary
- Existing `/check-ins` route renders basic tables but relies on mock data.
- API has partial endpoints under `server/src/routes/checkins.js` but lacks GPS support and reminder scaffolding.
- No centralized job queue for recurring tasks (reminders, GPS pings).

## 3. Feature Work Breakdown

### 3.1 Frontend Wiring
1. **Component inventory:** map each generated component/page to new routes (`src/pages/CheckIns.jsx`, detail drawers, create/edit modals).
2. **React Query hooks:** add `useCheckIns`, `useCheckInDetail`, `useCreateCheckIn`, `useUpdateCheckIn`, `useCheckInAttendance`.
3. **List view:**
   - Filters (status, officer, date range, client name).
   - Summary cards (Upcoming / Overdue / GPS-enabled clients).
   - Bulk actions placeholders (notify, export).
4. **Detail view:**
   - Timeline of attendance + GPS pings (map component using last known coordinates).
   - Quick actions (mark attended/missed, trigger manual ping, reschedule).
   - Audit tab showing change log.
5. **Modal forms:** create/edit check-in (date/time, timezone, assigned officer, location, notes, reminder toggles).
6. **Client consent messaging:** display GPS consent status with link to signed agreement.
7. **Integration touches:** update navigation badges, notifications (toast) behaviour, link from `CaseDetail` to check-ins.

#### 3.1.1 Attendance workflows (new)
- **Status picker:** replace the single “Mark completed” action with a mini-dialog that supports `attended`, `missed`, and `no-show` states (the latter reserved for escalations).
- **Evidence capture:** allow optional upload/attach of:
  - GPS snapshot (auto-populated when ping present)
  - Photo/selfie (file or mobile camera prompt)
  - Officer notes (required when marking missed/no-show)
- **Escalation toggles:** checkboxes for “notify lead” and “create follow-up task,” defaulting on after two consecutive misses.
- **Timeline revisions:** display attendance cards with badges and evidence thumbnails, linking to full audit modal.
- **Accessibility:** ensure keyboard-only flow (dialog focus trapping, descriptive labels) and screen-reader announcements for success/failure messages.
- **Offline mode (stretch):** cache attendance action locally until connectivity returns; surface unsynced badge.

### 3.2 Backend/API Tasks
1. **Schema updates:**
   - `CheckIn` model: add fields `timezone`, `remindersEnabled`, `gpsEnabled`, `scheduledPingsPerDay`, `lastPingAt`.
   - New `CheckInPingLog` collection storing `{ checkInId, clientId, scheduledFor, responseAt, location, status }`.
   - Client/Bond schema: `gpsConsentAt`, `gpsConsentMethod`, `deviceToken` (if using push) or `phoneNumber`.
2. **Routes:**
   - `GET /api/checkins` with filters, pagination.
   - `POST /api/checkins` (create) and `PUT /api/checkins/:id` (edit).
   - `POST /api/checkins/:id/attendance` (mark attended/missed with optional location + notes).
   - `POST /api/checkins/:id/pings/manual` (trigger manual ping).
   - `GET /api/checkins/:id/audit` and `/pings` endpoints for detail view.
   - Update OpenAPI documentation for new endpoints and schemas. ✅ *2025-01-15*
3. **Permissions:** ensure `billing:*` or `officer:*` roles can manage; clients have limited read-only endpoints.

### 3.3 GPS Ping Service
1. **Scheduling:**
   - Use Bull/BullMQ or equivalent job queue (Redis-backed).
   - On check-in creation (gpsEnabled), enqueue daily jobs at configured times (default 08:00, 13:00, 19:00 client timezone).
   - Respect geofence windows (§3.7) by aligning ping times with expected safe-zone arrival.
   - **Implementation outline:**
     1. Provision Redis in dev (docker) + staging (managed service) with TLS enforced.
     2. Create `jobs/checkins.queue.js` responsible for registering named queues (`checkin:reminder`, `checkin:gps`), plus health metrics.
     3. Add service layer (`checkinsQueueService`) that exposes `scheduleReminder`, `schedulePing`, `cancelJobsForCheckIn` helpers.
     4. Persist job metadata on the `CheckIn` document (`meta.jobIds`) for cancellation/audit.
     5. Emit structured logs for enqueue/dequeue events so we can feed dashboards + SOC2 evidence.
2. **Ping execution:**
   - Primary channel: push/SMS deep link to lightweight web page requesting GPS + optional selfie for verification.
   - Record log entry with `status` (`queued`, `sent`, `acknowledged`, `missed`, `failed`), `responseAt`, and location.
   - Escalate to officer if two consecutive pings are missed; optionally trigger IVR call (see voice biometrics).
3. **Client experience:**
   - Provide mobile-friendly confirmation flow with consent text, location preview, ability to request short delay.
   - Store explicit consent at bond acceptance; capture device identifier.
4. **Hardware tracker integration:** API must accept pings from dedicated trackers (§3.8) and merge them with mobile pings.

#### 3.3.1 Reminder cadence matrix
- Default schedule: 24h, 4h, and 1h before the appointment; configurable per case.
- Intelligent suppression: skip reminders sent within last 2h or when client already confirmed via portal.
- Quiet hours: auto-shift SMS to the next allowed window (configurable per department).
- SLA monitoring: send metrics to observability stack (missed reminder dispatches, queue delays).

#### 3.3.2 GPS Ping Verification Checklist
- [ ] Confirm Redis/Bull queue configuration in dev and staging with `checkins_gps` workers registered and processing heartbeats.
- [ ] Add automated health probes (e.g., `/api/health` extension) that validate queue connectivity and surface last successful ping timestamp.
- [ ] Create a gpsEnabled check-in in dev, verify three daily ping jobs get enqueued with correct client timezone metadata, and snapshot job IDs in the document.
- [ ] Run manual worker test to simulate provider callback (mock GPS payload) and ensure `CheckInPingLog` persists location, status transition, and audit trail.
- [ ] Confirm `CaseDetail` and `CheckIns` timelines render latest ping + status without relying on mock data.
- [ ] Capture SOC2 evidence: job configuration screenshot, ping log excerpt, and alerting screenshot stored in compliance vault.
- [ ] Draft operator runbook for investigating missed pings (queue backlog, provider outage, client device issues) and link it in `docs/final-feature-readiness.md`.

#### 3.3.3 Immediate Actions
- [x] Add Redis service to `docker-compose.dev.yml` + staging infra plan, documenting ports/credentials.
- [x] Scaffold `jobs/checkins.queue.js` with placeholder workers and logging (no-op handler) to unblock queue health checks.
- [x] Define `/api/health` extension contract for queue metrics and coordinate with ops for alert thresholds.

- [ ] Add `/api/health` extension reporting Redis connectivity and last GPS job heartbeat.
- [ ] Implement scheduled GPS ping enqueue service (3x per day default) with config stored on `CheckIn`.
- [ ] Capture screenshots/log snippets (queue metrics, sample ping log) for SOC2 evidence once scheduling runs.
### 3.4 Notifications & Reminders
1. Hook into messaging provider (Twilio/SendGrid) once selected.
2. Templates: reminder email/SMS, missed check-in alert, manual ping instructions.
3. UI toggles per client / per check-in for reminder cadence.
4. Logging: each notification -> audit trail (timestamp, channel, delivery status).

### 3.9 Client confirmation experience
1. **Landing page:** secure, tokenized link (short-lived JWT) that lets clients confirm arrival, request delay, or signal assistance. Include case details, officer info, and countdown to start time.
2. **Device telemetry:** when the client taps “Confirm arrival,” capture GPS coordinates (with consent prompt), device model, and IP → feed into `CheckInPing` for traceability.
3. **Identity verification:** optional selfie capture with liveness check (using WebRTC getUserMedia), stored in secure bucket with retention policy (e.g., 90 days).
4. **Consent banner:** display legal language with checkbox that records `gpsConsentAt` + method; add link to privacy policy.
5. **Messaging tie-in:** automatically push confirmation transcript into messaging inbox and fire webhook for third-party alerts.
6. **Offline fallback:** provide SMS keyword instructions (“Reply YES + selfie link”) when the portal cannot load.
7. **Security:** enforce rate limiting, signed URLs, and single-use protection; expire tokens after successful check-in.

### 3.5 Audit & Compliance
1. Ensure all check-in changes go through audit middleware (user, timestamp, diff).
2. GPS consent logging: captured during bond acceptance form (store doc reference + timestamp).
3. Data retention guidelines: define TTL for `CheckInPingLog` (e.g., 1 year) and provide export endpoint.
4. SOC2 evidence: update `Schema_Authentication.md` with GPS consent and check-in policies.

### 3.6 Testing Plan
- **Unit tests:** form validation, scheduling utils, GPS job handlers, attendance endpoint.
- **Integration tests:** create/edit check-in, mark attendance, manual ping, reminder queue.
- **QA checklist:**
  1. Create check-in with reminders & GPS.
  2. Simulate attendance (success + missed).
  3. Validate pings logged 3 times per day.
  4. Verify notifications and audit entries.
  5. Confirm consent details visible in UI.

### 3.7 Smart Check-In Channels
To make supervision more flexible while keeping a strong audit trail, support additional check-in modalities:

1. **Geofenced safe zones**
   - Admins define zones (home, work, courthouse) with radius or polygon.
   - If device dwells inside zone during a scheduled window, system auto-marks “present” pending officer review.
   - Requires mobile app background location or frequent GPS pings; configurable dwell time & accuracy thresholds.
   - Must log coordinates, accuracy, and auto-mark reason for SOC2.

2. **Voice biometric call-in**
   - Toll-free IVR call, client speaks passphrase, voiceprint matches stored profile.
   - Use provider (e.g., Twilio Voice + voice-match) with fallback to live agent if verification fails twice.
   - Stores audio snippet or hashed voiceprint per compliance requirements.

3. **QR / kiosk confirmation**
   - Rotating QR codes (5 min TTL) displayed by officers or kiosks; client scans via app or enters numeric code.
   - Records device ID, geo, and optional selfie; kiosk mode uses case number + PIN.

4. **Smart SMS scripts (ties to Messaging)**
   - Conversational flows: “Reply 1 when you arrive”, “Send photo if requested”, “Need help? Reply HELP”.
   - Integrates with messaging provider; transcripts stored in `checkinLogs` and surfaced in messaging module.

5. **Wearable / vehicle GPS trackers**
   - Issue BLE/GPS devices (AirTag-style or OBD-II trackers) for clients who consent.
   - Provisioning workflow to pair device ID; ingest vendor webhooks into `CheckInPing` stream.
   - Battery/tamper alerts with escalation; inventory management in admin UI.

### 3.8 Hardware & Device Support (Future Pilot)
- Select vendor(s) for trackers; document API/webhook requirements.
- Maintain registry of device assignments, activation/deactivation history.
- Provide dashboards for device health (battery, last ping).
- Ensure removal/deletion workflow once bond terminates.

## 4. Dependencies & Open Questions
- Messaging provider decision (Twilio vs SendGrid/SMS alternative).
- Push vs SMS for GPS pings; need or availability of client mobile app.
- Redis/Bull queue infrastructure scaffolded for development; staging provisioning + health checks still pending.
- Infrastructure for job queue (Redis) in production.
- Legal review of GPS consent language and data retention.
- Observability stack for queue + reminder metrics (Grafana/Datadog); confirm logging standards with DevOps.
- Secrets management for queue credentials (Vault/SOPS) and rotation cadence.

## 5. Next Steps
1. Extend attendance UX to capture missed/no-show reasons and attach evidence (photo/GPS), then bubble into alerts.
2. Wire reminder + GPS ping scheduling to real job queue once provider/Redis decision is finalized (placeholder toggles now live).
3. Build client-facing confirmation flow + consent storage (ties into messaging module) and add SOC2 evidence hooks.

## 6. Progress Log
- **2025-09-28:** Swagger/OpenAPI hygiene and documentation improvements for Check-ins
   - Moved misplaced `/checkins*` path definitions to the top-level `paths` section in `server/src/openapi.yaml` so the Checkins tag renders all operations in Swagger UI.
   - Added missing spec paths to match implemented server routes:
      - `PATCH /checkins/{id}/status` (update status with optional note)
      - `PATCH /checkins/{id}/contact` (increment contact attempts and update timestamp)
   - Added `operationId` and request/response `examples` for all Checkins operations (`list`, `create`, `detail`, `update`, `timeline`, `manual ping`, `attendance`, `status`, `contact`) to improve client generation and QA usability.
   - Fixed an unrelated but blocking OpenAPI validation issue in `/dashboard/per-county` response schema to allow the spec to validate cleanly.
   - Validated the OpenAPI spec and generated a bundle artifact at `server/src/openapi.bundle.json`.
   - Note: No breaking API changes to Checkins handlers; this was documentation-only alignment for the Checkins endpoints already implemented in `server/src/routes/checkins.js`.

   Process note: For ongoing work, we’ll update this Progress Log before and after each Checkins-related task to keep documentation current.
- **2025-01-15:** Added `/checkins/options` endpoint + React Query hook so scheduling modal pulls real client/officer lists; persisted case number/county metadata on create.
- **2025-01-15:** Implemented `/checkins/:id/attendance` API, updated timeline/detail views to show attendance records, and replaced “Mark complete” action with the new mutation. OpenAPI updated to cover options + attendance endpoints.
- **2025-01-15:** Established baseline plan, created reusable UI primitives (`CheckInSummary`, `CheckInFilters`, `CheckInList`, `CheckInDetailDrawer`, `CheckInFormModal`) and updated `src/pages/CheckIns.jsx` to use new components with enhanced filtering skeletons; expanded hooks (`useCheckins`, detail/create/update/ping stubs) ahead of API work.
- **2025-01-15:** Extended `CheckIn` schema (timezone, officer, reminders, GPS), added `CheckInPing` model, upgraded `/api/checkins` filters & stats, and introduced new detail/timeline/create/update/manual-ping endpoints.
- **2025-01-15:** Documented new API routes/schemas in `openapi.yaml`.
- **2025-01-15:** Added roadmap for geofenced auto check-ins, voice biometrics, QR/kiosk scans, smart SMS workflows, and hardware tracker integration.
- _2025-10-03:_ Added `/api/health` queue metrics, auto-scheduling placeholder (3x per day) and case-level ping button scaffolding; next up: real cadence + evidence capture.
- _2025-10-03:_ Added case-level Check-ins tab with manual ping controls and GPS queue heartbeat reporting; next: production cadence + SOC2 evidence.

