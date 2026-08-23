# AI Agent Warrant System Flow Ground Truth

Added: 2026-05-01  
Status: Derived from current code paths in `app/main.py` and `app/telnyx_tools.py`

## Overview

This diagram shows the as-built request and data flow for the current service. It covers both major subsystems:

- compliance check-in,
- Telnyx voice operations.

```mermaid
flowchart TD
    User[Public user or caller]
    Admin[Admin or office operator]
    TelnyxAI[Telnyx AI Assistant]
    TelnyxVoice[Telnyx Voice and Call Control]
    App[FastAPI app\napp/main.py + app/telnyx_tools.py]
    Templates[Jinja templates and static assets]
    Mongo[(MongoDB Atlas)]
    S3[S3 or local static uploads]
    Geo[IP geolocation providers\nipinfo or ipapi]
    Messaging[Telnyx Messaging or Twilio]
    Office[Office agents and on-call phones]

    subgraph Compliance_Check_In
        Admin -->|send link| App
        App -->|SMS check-in link| Messaging
        Messaging --> User
        User -->|open preview and check-in pages| Templates
        Templates -->|browser requests| App
        App -->|verify token| App
        User -->|GPS and optional selfie| App
        App -->|store checkin, links, logs, cases access| Mongo
        App -->|upload photo if configured| S3
        App -->|coarse geo lookup on refusal or logging| Geo
        Admin -->|view last known area| App
        App --> Templates
    end

    subgraph Voice_And_Transfer
        TelnyxAI -->|Bearer-auth tool calls| App
        App -->|persons, custody_events, inquiries, callback_queue, logs, cases| Mongo
        App -->|agent SMS notifications| Messaging
        App -->|transfer plan and callback prompts| TelnyxAI
        TelnyxAI -->|transfer and playback actions| TelnyxVoice
        App -->|playback_start and playback_stop requests| TelnyxVoice
        TelnyxVoice -->|connect call legs| Office
        Office -->|may place caller on hold| TelnyxAI
        TelnyxAI -->|hold-handling and callback enqueue| App
        App -->|callback queue summary| Messaging
    end

    TelnyxVoice -->|AI, call, recording events| App
    App -->|event logging and debug traces| Mongo
```

## Flow Notes

### Compliance Flow

- The service generates time-limited JWT-based check-in links.
- The check-in page attempts both GPS and a selfie capture.
- Refusals are explicitly recorded.
- The admin map is driven by the most recent stored geo event.

### Voice Operations Flow

- Telnyx tools are authenticated with a bearer token.
- The app uses fast-path simple county collections when available, then falls back to canonical person and custody collections.
- Transfer planning is schedule-aware and county-aware.
- Warm transfer responses include DTMF choices and hold music metadata.
- The callback queue is a first-in, first-out Mongo-backed operational queue.

### Logging Model

- The `logs` collection is the cross-cutting event sink.
- It captures playback actions, webhook payloads, SMS attempts, routing diagnostics, and compliance events.

## Canonical Source Files

- `app/main.py`
- `app/telnyx_tools.py`
- `app/db.py`
- `app/config.py`
- `app/sms.py`
- `app/storage.py`
- `app/tokens.py`
- `app/geo.py`