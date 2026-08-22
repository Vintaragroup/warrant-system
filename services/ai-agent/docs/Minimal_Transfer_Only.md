# Minimal Transfer-Only Setup

Goal: Use the AI Agent only to return a transfer number for Telnyx to dial. No SMS, no CRM writes, no webhooks required beyond tools.

## What you need to set

In `.env` (copy from `.env.example`):

- Required core
  - `APP_ENV=dev`
  - `BASE_URL=https://your-public-url` (use ngrok/cloudflared in dev)
  - `SECRET_KEY=...`
- MongoDB (still required by app startup)
  - `MONGO_URI=...` (Atlas URI)
  - `MONGO_DB=warrantdb`
- Telnyx tools auth
  - `TELNYX_TOOL_TOKEN=...` (used as Bearer for all `/telnyx/*` tool endpoints)
- Transfer-only routing
  - `DEFAULT_OFFICE_NUMBER=+1XXXXXXXXXX` (single universal number to transfer to)
  - Leave `OFFICE_ROUTES_JSON` and `OFFICES_SCHEDULE_JSON` blank for now.

No need to set any messaging (Telnyx/Twilio) variables for the transfer-only path.

## Telnyx Assistant wiring

Configure your AI Assistant tools to call the following endpoint to get the transfer target:

- `POST {BASE_URL}/telnyx/transfer_target`
  - Headers: `Authorization: Bearer ${TELNYX_TOOL_TOKEN}`
  - Body: `{ "county": "Harris" }` (county is optional; ignored when you use a single default)
  - Response: `{ ok: true, phone: "+1..." }`

In your Assistant flow, use the returned `phone` with Telnyx's connect/transfer action to bridge the live agent.

Optional advanced endpoint (not needed now):

- `POST {BASE_URL}/telnyx/transfer_plan` → returns an ordered array of numbers if/when you enable schedules.

## Local sanity checks

- Health: `GET {BASE_URL}/healthz`
- Transfer target (requires Bearer):

```bash
curl -sS -X POST "$BASE_URL/telnyx/transfer_target" \
 -H "Authorization: Bearer $TELNYX_TOOL_TOKEN" \
 -H 'Content-Type: application/json' \
 -d '{"county":"Harris"}' | jq
```

Expected output:

```json
{ "ok": true, "phone": "+1XXXXXXXXXX" }
```

## Notes

- The FastAPI app still initializes Mongo to keep the code paths intact, but for the transfer-only path the app will not modify collections.
- Leave SMS (`notify_agent`) and webhooks (`ai_events`, `call_events`, `recording_ready`) for future phases.
- When you’re ready to expand:
  - Add `OFFICE_ROUTES_JSON` and/or `OFFICES_SCHEDULE_JSON` for dynamic routing
  - Set messaging credentials and call `/telnyx/notify_agent` to text the on-call agent
  - Enable webhook secret (`TELNYX_WEBHOOK_SECRET`) and point Telnyx to `/telnyx/ai_events` for rich logging
