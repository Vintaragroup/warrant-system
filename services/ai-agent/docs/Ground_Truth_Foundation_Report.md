# AI Agent Warrant Ground Truth Foundation Report

Added: 2026-05-01  
Status: Ground truth from executable code and active operations docs

## Executive Summary

AI Agent Warrant is a single FastAPI service with two production-relevant domains:

1. A compliance check-in workflow for bond monitoring.
2. A Telnyx-backed voice and transfer workflow for inmate lookup, bail triage, office routing, agent notification, hold management, and callback handling.

The executable source of truth is the Python application code, especially `app/main.py`, `app/telnyx_tools.py`, `app/config.py`, and `app/db.py`. The operational docs in `docs/` are useful, but the code defines the real current behavior.

## Primary Business Purpose

### Domain 1: Compliance Check-In

This side of the system sends a secure link to a person tied to a case, records whether they comply with a location request, and stores the resulting evidence.

Capabilities implemented in code:

- One-time token generation for check-in links.
- Preview page with OG-card metadata and tracking beacons.
- Browser-based geolocation capture.
- Optional selfie capture through browser camera access.
- Optional image upload to S3, with local static fallback in development.
- Refusal recording.
- Coarse IP-based geolocation lookup.
- Admin last-known-area map display.

Main code:

- `app/main.py`
- `app/tokens.py`
- `app/storage.py`
- `app/geo.py`
- `app/templates/checkin.html`
- `app/templates/preview.html`
- `app/templates/admin_last_area.html`

### Domain 2: Telnyx Voice Operations

This side of the system supports a Telnyx AI assistant and office transfer workflow.

Capabilities implemented in code:

- Authenticated inmate lookup by name, DOB, and county.
- Bail status retrieval and normalization.
- Inquiry capture and optional attachment to an existing case.
- County-based and schedule-based transfer routing.
- Warm transfer planning with ordered numbers, whisper text, DTMF controls, caller hold message, and caller ID.
- Agent notification by SMS to one or many recipients.
- Hold music diagnostics and playback control.
- Callback queue insertion, listing, status updates, and queue notifications.
- Telnyx webhook logging for AI, call, and recording events.
- Debug endpoints for recent events and call-level logs.

Main code:

- `app/telnyx_tools.py`
- `app/sms.py`
- `app/config.py`
- `app/db.py`

## Runtime Architecture

### Entry Point

The application starts in `app/main.py` as a FastAPI app.

It:

- exposes root and health endpoints,
- mounts static assets,
- loads Jinja templates,
- defines the compliance and utility routes,
- includes the Telnyx router from `app/telnyx_tools.py`.

### Configuration Model

`app/config.py` defines a Pydantic settings model driven by environment variables.

The service requires, at minimum:

- `SECRET_KEY`
- `BASE_URL`
- `MONGO_URI`
- `MONGO_DB`
- `TELNYX_TOOL_TOKEN`

Optional features are controlled by additional variables:

- Twilio credentials for SMS fallback.
- Telnyx messaging credentials for preferred agent notifications.
- AWS S3 credentials for image storage.
- IP geolocation provider selection.
- Office routing JSON.
- Office schedule JSON.
- Hold music URL.
- Webhook shared secret.

### Data Layer

`app/db.py` initializes MongoDB and exposes collection handles.

Collections used by the service:

- `persons`
- `custody_events`
- `inquiries`
- `logs`
- `callback_queue`
- `cases`
- `checkins`
- `links`

Index creation is performed at startup and is safe to rerun.

## Public and Operator Flows

### Compliance Check-In Flow

1. A case exists in `cases` with case metadata.
2. Admin calls `POST /admin/send_link/{case_id}`.
3. The app builds a preview link and a direct check-in link using a one-time JWT.
4. The person opens `GET /p/{case_id}` and then `GET /checkin?tok=...`.
5. The browser attempts geolocation and camera capture.
6. The app accepts `POST /api/checkin` and stores GPS, optional image URL, and metadata.
7. If the person declines, `POST /api/refusal` stores a refusal record.
8. Operators can inspect `GET /admin/last_area/{case_id}` for the most recent coarse geo event.

### Inmate Lookup and Bail Flow

1. Telnyx AI calls `POST /telnyx/find_person`.
2. The app searches simple collections first, then canonical collections.
3. Telnyx AI calls `POST /telnyx/get_bail_status`.
4. The app returns a normalized bail view with human-review hints where needed.
5. Telnyx AI can persist a lead through `POST /telnyx/create_bail_inquiry`.
6. Telnyx AI can attach caller details to a case through `POST /telnyx/attach_caller`.

### Transfer and Hold Flow

1. Telnyx AI calls `POST /telnyx/warm_transfer_plan`.
2. The app returns ordered dial targets, hold music URL, whisper text, DTMF digits, and transfer metadata.
3. Telnyx AI may call `POST /telnyx/notify_agent` or `POST /telnyx/notify_group`.
4. Telnyx AI or external workflow starts hold music playback through playback endpoints.
5. If the office places the call on hold, `POST /telnyx/handle_office_hold` returns a caller-choice prompt.
6. If callback is chosen, `POST /telnyx/enqueue_callback` inserts the request into `callback_queue`.
7. Operators or automation can inspect or update the callback queue through queue endpoints.

## Lookup Strategy and Data Sources

### Fast Path

`app/telnyx_tools.py` first checks whether lightweight county collections exist:

- `simple_harris`
- `simple_brazoria`
- `simple_galveston`
- `simple_fortbend`

These are used for quick lookup and bail extraction when present.

### Fallback Path

If no good fast-path match is found, the app queries:

- `persons`
- `custody_events`

The most recent matching custody record is selected, optionally biased by county.

### Bail Normalization

The code supports:

- direct numeric amounts,
- dollar-string parsing,
- textual labels such as `No Bond` or `PR Bond`,
- a `needs_human_review` hint when numeric determination is unavailable.

## Security Model

### Tool Authentication

All `/telnyx/*` tool endpoints require:

- `Authorization: Bearer <TELNYX_TOOL_TOKEN>`

### Webhook Authentication

Optional webhook routes can additionally require:

- `X-Telnyx-Secret: <TELNYX_WEBHOOK_SECRET>`

### Check-In Link Security

Public check-in links use JWTs signed with `SECRET_KEY` and time-bounded expiration.

### Operational Security Notes

The `logs` collection is sensitive because it may contain:

- call identifiers,
- webhook payloads,
- caller information,
- transfer debug data,
- check-in metadata.

`SECURITY.md` correctly treats secret handling as critical.

## Outbound Dependencies

### Telnyx

Used for:

- AI assistant tool integration,
- call-control playback,
- optional messaging,
- transfer workflow support,
- webhook events,
- possible object-storage-backed hold music delivery.

### Twilio

Used as SMS fallback when configured.

### AWS S3

Used for uploaded compliance photos when configured.

### IP Geolocation Providers

Used for coarse IP-to-location lookup through `ipinfo` or `ipapi`.

## Route Inventory

### Main App Routes

- `GET /`
- `HEAD /`
- `GET /healthz`
- `GET /hold_music/moonlightdrive.mp3`
- `POST /ai/playback_start`
- `POST /ai/playback_stop`
- `POST /dynamic-variables`
- `POST /expanded_whisper`
- `GET /px/{case_id}`
- `GET /css/{case_id}.css`
- `GET /p/{case_id}`
- `GET /checkin`
- `POST /api/checkin`
- `POST /api/refusal`
- `GET /admin/last_area/{case_id}`
- `POST /admin/send_link/{case_id}`

### Telnyx Router Routes

- `POST /telnyx/find_person`
- `POST /telnyx/get_bail_status`
- `POST /telnyx/create_bail_inquiry`
- `POST /telnyx/attach_caller`
- `POST /telnyx/transfer_target`
- `POST /telnyx/transfer_plan`
- `POST /telnyx/warm_transfer_plan`
- `GET /telnyx/hold_music`
- `GET /telnyx/hold_music_test`
- `GET /telnyx/hold_music/moonlightdrive.mp3`
- `GET /telnyx/schedule_status`
- `POST /telnyx/notify_agent`
- `GET /telnyx/agents`
- `GET /telnyx/agent_phone`
- `POST /telnyx/notify_group`
- `POST /telnyx/ai_events`
- `POST /telnyx/call_events`
- `GET /telnyx/sms_status`
- `POST /telnyx/recording_ready`
- `POST /telnyx/playback_start`
- `POST /telnyx/playback_stop`
- `GET /telnyx/debug_recent`
- `GET /telnyx/call_log`
- `POST /telnyx/enqueue_callback`
- `GET /telnyx/callback_queue`
- `PATCH /telnyx/callback_queue/{queue_entry_id}`
- `POST /telnyx/handle_office_hold`
- `POST /telnyx/notify_callback_queue`

## What Is Active Versus Supporting

### Active Source of Truth

- `app/main.py`
- `app/telnyx_tools.py`
- `app/config.py`
- `app/db.py`
- `app/sms.py`
- `app/storage.py`
- `app/tokens.py`
- `app/geo.py`

### Active Operational Docs

- `docs/System_Overview.md`
- `docs/Telnyx_Integration.md`
- `docs/Current-Telnyx-Agent-working-instructions.md`
- `docs/Two-Stage-Whisper-Instructions.md`
- `docs/Minimal_Transfer_Only.md`

### Supporting or Historical

- `docs/agent-instructions-archive/*`
- `call_logs_debug/*`
- helper scripts in `scripts/`

## Best Current Description

AI Agent Warrant is a FastAPI middleware service for a bail-bond operation that combines a compliance evidence-capture workflow with a Telnyx AI assistant backend for inmate lookup, bail triage, office routing, transfer orchestration, hold handling, and callback management.

## Source Basis

This report was derived from:

- executable code in `app/`
- active docs in `docs/`
- environment contract in `.env.example`
- dependency contract in `requirements.txt`

When a document conflicts with code, code should be treated as authoritative.