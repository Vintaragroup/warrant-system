# AI Agent Warrant

AI Agent Warrant is a FastAPI service with two active domains:

- a compliance check-in flow for bond monitoring,
- a Telnyx-backed voice operations layer for inmate lookup, bail triage, transfer routing, hold handling, and callback management.

This README reflects the current runtime architecture in:

- `app/main.py`
- `app/telnyx_tools.py`
- `app/config.py`
- `app/db.py`

If a document conflicts with code, treat the files above as the source of truth.

## What The Service Does

### Compliance Check-In Flow

This side of the service sends a secure check-in link tied to a case, captures compliance evidence, and stores the result.

Implemented behavior:

- preview page with OG metadata and tracking beacons,
- one-time JWT-based check-in links,
- browser GPS capture,
- optional browser selfie capture,
- optional S3 photo upload with local static fallback,
- refusal recording,
- coarse IP-based geolocation lookup,
- admin map for last known area.

Primary routes:

- `GET /p/{case_id}`
- `GET /checkin?tok=...`
- `POST /api/checkin`
- `POST /api/refusal`
- `GET /admin/last_area/{case_id}`
- `POST /admin/send_link/{case_id}`

### Telnyx AI Voice and Bail Lookup Flow

This side of the service supports a Telnyx AI assistant and office call workflow.

Implemented behavior:

- inmate lookup by name, DOB, and county,
- bail status lookup and normalization,
- inquiry creation,
- optional caller-to-case attachment,
- county-based and schedule-based transfer routing,
- warm transfer planning,
- agent SMS notifications,
- hold detection and caller choice prompts,
- callback queue insertion and queue notifications,
- Telnyx webhook logging,
- call and transfer diagnostics.

Primary routes:

- `POST /telnyx/find_person`
- `POST /telnyx/get_bail_status`
- `POST /telnyx/create_bail_inquiry`
- `POST /telnyx/attach_caller`
- `POST /telnyx/transfer_target`
- `POST /telnyx/transfer_plan`
- `POST /telnyx/warm_transfer_plan`
- `POST /telnyx/notify_agent`
- `POST /telnyx/notify_group`
- `POST /telnyx/enqueue_callback`
- `GET /telnyx/callback_queue`
- `PATCH /telnyx/callback_queue/{queue_entry_id}`
- `POST /telnyx/handle_office_hold`
- `POST /telnyx/notify_callback_queue`

## Architecture Overview

### Application Layer

- `app/main.py` defines the FastAPI app, public routes, compliance flow, playback helper routes, template rendering, and static asset mounting.
- `app/telnyx_tools.py` defines the authenticated Telnyx tool router, transfer logic, notification logic, callback queue logic, and Telnyx event logging.

### Configuration Layer

- `app/config.py` defines environment-driven settings using Pydantic settings.
- Optional behavior is enabled through environment variables instead of code changes.

### Data Layer

- `app/db.py` creates the Mongo client, exposes collection handles, and creates indexes at startup.

### Support Services

- `app/sms.py` sends outbound notifications through Twilio or Telnyx, with a dev fallback.
- `app/storage.py` uploads compliance images to S3 or local static storage.
- `app/tokens.py` creates and verifies one-time JWT links.
- `app/geo.py` performs coarse IP geolocation using `ipinfo` or `ipapi` with caching.

## Warm Transfer and Hold Music

The transfer workflow is built around `POST /telnyx/warm_transfer_plan`.

The response includes:

- ordered phone numbers to try,
- a `primary_number`,
- `attempt_timeout_sec`,
- `whisper_text`,
- `accept_dtmf`,
- `decline_dtmf`,
- `from_caller_id`,
- `caller_hold_message`,
- `hold_music_url` when configured.

Related behavior in code:

- schedule-aware routing from office schedule JSON,
- county-aware fallback routing,
- playback start and stop support through Telnyx Call Control,
- expanded whisper support for a two-stage agent handoff,
- hold detection prompt through `POST /telnyx/handle_office_hold`.

Hold-music and playback routes currently exposed by the code:

- `GET /hold_music/moonlightdrive.mp3`
- `GET /telnyx/hold_music`
- `GET /telnyx/hold_music_test`
- `GET /telnyx/hold_music/moonlightdrive.mp3`
- `POST /ai/playback_start`
- `POST /ai/playback_stop`
- `POST /telnyx/playback_start`
- `POST /telnyx/playback_stop`

## Callback Queue

The callback queue is a first-in, first-out Mongo-backed queue for callers who choose not to wait on hold.

Implemented behavior:

- enqueue callback requests,
- list pending or completed callbacks,
- update callback status,
- broadcast queue summaries to configured agents.

Primary routes:

- `POST /telnyx/enqueue_callback`
- `GET /telnyx/callback_queue`
- `PATCH /telnyx/callback_queue/{queue_entry_id}`
- `POST /telnyx/notify_callback_queue`

Collection used:

- `callback_queue`

## MongoDB Collections

The service currently uses these collections from `app/db.py`:

- `persons`
- `custody_events`
- `inquiries`
- `logs`
- `callback_queue`
- `cases`
- `checkins`
- `links`

### How They Are Used

- `persons`: canonical person records for inmate lookup fallback.
- `custody_events`: custody snapshots and bond-related state.
- `inquiries`: caller lead intake records.
- `logs`: event log for check-ins, Telnyx events, playback, SMS, and diagnostics.
- `callback_queue`: FIFO callback workflow.
- `cases`: case metadata for compliance links and CRM attachment.
- `checkins`: submitted compliance check-ins and refusals.
- `links`: link-related support data for the check-in flow.

### Fast Lookup Collections

When present in MongoDB, the Telnyx lookup flow also checks lightweight `simple_*` collections before falling back to `persons` and `custody_events`.

The code currently looks for:

- `simple_harris`
- `simple_brazoria`
- `simple_galveston`
- `simple_fortbend`

## Environment Configuration

Copy `.env.example` to `.env` and configure the values required for your deployment mode.

### Required Minimum

- `APP_ENV`
- `BASE_URL`
- `SECRET_KEY`
- `MONGO_URI`
- `MONGO_DB`
- `TELNYX_TOOL_TOKEN`

### Optional Messaging

Telnyx messaging:

- `TELNYX_API_KEY`
- `TELNYX_MESSAGING_FROM_NUMBER` or `TELNYX_MESSAGING_PROFILE_ID`

Twilio fallback:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- optional `TWILIO_MESSAGING_SERVICE_SID`

### Optional Storage

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`

### Optional Routing and Transfer

- `DEFAULT_OFFICE_NUMBER`
- `OFFICE_ROUTES_JSON`
- `STATIC_TRANSFER_NUMBERS_JSON`
- `OFFICES_SCHEDULE_JSON`
- `APP_TZ`
- `DIAL_ATTEMPT_TIMEOUT_SEC`
- `OFFICE_CALLER_ID`
- `HOLD_MUSIC_URL`
- `TRANSFER_ACCEPT_DIGIT`
- `TRANSFER_DECLINE_DIGIT`

### Optional Webhook and Geo Settings

- `TELNYX_WEBHOOK_SECRET`
- `IP_GEO_PROVIDER`
- `IP_GEO_TOKEN`
- `BUILD_SHA`

## Health and Diagnostics

General endpoints:

- `GET /`
- `HEAD /`
- `GET /healthz`

Useful Telnyx diagnostics:

- `GET /telnyx/schedule_status`
- `GET /telnyx/sms_status`
- `GET /telnyx/agents`
- `GET /telnyx/agent_phone`
- `GET /telnyx/debug_recent`
- `GET /telnyx/call_log`

## Security Notes

### Tool Authentication

All `/telnyx/*` tool endpoints require:

- `Authorization: Bearer <TELNYX_TOOL_TOKEN>`

### Optional Webhook Secret

If configured, webhook endpoints additionally require:

- `X-Telnyx-Secret: <TELNYX_WEBHOOK_SECRET>`

### Check-In Link Security

- public check-in links are JWT-based and time-bounded,
- signing uses `SECRET_KEY`.

### Secret Handling

- never commit `.env`,
- use deployment secret management for production,
- rotate tokens and provider credentials regularly,
- treat the `logs` collection as sensitive operational data.

See `SECURITY.md` for current secret-handling guidance.

## Local Development

### 1. Create a Virtual Environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Fill in the required variables for your mode of use.

### 3. Run The Server

```bash
uvicorn app.main:app --reload --port 8080
```

### 4. Check Health

```bash
curl http://127.0.0.1:8080/healthz
```

### 5. Optional Local Webhook Exposure

```bash
ngrok http 8080
```

Update `BASE_URL` to the public HTTPS URL if you are testing Telnyx callbacks or assistant tools externally.

### 6. Optional Test Case Seed

Example `cases` document for the compliance flow:

```json
{
  "case_id": "CASE123",
  "person_id": "P-001",
  "name": "John A Smith",
  "phone": "+15551234567"
}
```

### 7. Optional Manual Compliance Link Test

```bash
curl -X POST http://127.0.0.1:8080/admin/send_link/CASE123
```

## Deployment Notes

This service runs as a standard FastAPI ASGI app.

Operational expectations visible in code and docs:

- root `/` returns `200 OK` for platform health checks,
- `/healthz` provides a more explicit health payload,
- static assets and templates are served directly by the app,
- public webhook URLs require a stable public `BASE_URL`,
- MongoDB must be reachable at startup,
- optional external services can be disabled by leaving related env vars unset.

For hosted deployment:

- set all secrets in the platform environment manager,
- redeploy or restart after rotating configuration,
- validate `/healthz`, messaging config, and Telnyx tool authentication after deploy.

## Key Docs

Ground truth and architecture:

- `docs/Ground_Truth_Foundation_Report.md`
- `docs/System_Flow_Ground_Truth.md`
- `docs/Docs_Code_Gap_Analysis.md`

Operational references:

- `docs/System_Overview.md`
- `docs/Telnyx_Integration.md`
- `docs/Minimal_Transfer_Only.md`
- `docs/Current-Telnyx-Agent-working-instructions.md`
- `docs/Two-Stage-Whisper-Instructions.md`

Historical prompt experiments:

- `docs/agent-instructions-archive/`

## Source of Truth Hierarchy

For maintenance and future updates, use this order:

1. `app/main.py`
2. `app/telnyx_tools.py`
3. `app/config.py`
4. `app/db.py`
5. `docs/Ground_Truth_Foundation_Report.md`
6. `docs/System_Flow_Ground_Truth.md`
7. `docs/Telnyx_Integration.md`

Prompt docs and archived instructions are useful operational context, but they are not authoritative over the code.
