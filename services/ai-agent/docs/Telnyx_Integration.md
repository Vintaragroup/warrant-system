# Telnyx Integration Guide

This document explains how the Telnyx AI Assistant integrates with this FastAPI app via the endpoints in `app/telnyx_tools.py`. It covers purpose, configuration, data flow, endpoints, payloads, and database usage.

## Purpose

Provide a minimal set of authenticated API endpoints for a Telnyx AI Assistant to:
- Find a person (inmate) by name and optional DOB.
- Retrieve bail status/amount.
- Create a bail inquiry record (lead intake).
 - Attach caller info to an existing case’s CRM when an inmate is confirmed.

The module is mounted under `/telnyx/*` and is intended for machine-to-machine calls from Telnyx tools, protected by a static Bearer token.

## Where it lives

- Router: `app/telnyx_tools.py`
- Mounted in app: `app.main` → `app.include_router(telnyx_router)`
- Config: `app/config.py` (reads `TELNYX_TOOL_TOKEN`)
  - Optional office routing: `OFFICE_ROUTES_JSON`, `DEFAULT_OFFICE_NUMBER`
  - Optional schedule routing: `OFFICES_SCHEDULE_JSON`, `APP_TZ`, `DIAL_ATTEMPT_TIMEOUT_SEC`
- DB collections: declared in `app/db.py` (MongoDB)

## Authentication

All endpoints require an `Authorization: Bearer <TELNYX_TOOL_TOKEN>` header.
- Token is configured via environment: `TELNYX_TOOL_TOKEN` in `.env`.
 - For transfers, you can configure a county → office phone map using `OFFICE_ROUTES_JSON` and a default with `DEFAULT_OFFICE_NUMBER`.
- Validation is enforced by the `_auth(request)` helper.
- Missing token → 401. Invalid token → 403.

## Data sources and lookup strategy

Two data paths are used:

1) Fast path: simple_* collections
- Collections: `simple_harris`, `simple_brazoria`, `simple_galveston`, `simple_fortbend` (if present in DB)
- Queried by last/first name and optional DOB
- Heuristic scoring prefers: exact last, prefix first, DOB match, recent booking_date
- Returns a synthesized custody/bail view if matched

2) Fallback path: persons + custody_events
- `persons` collection stores canonical person documents
- `custody_events` stores snapshots/events keyed by `person_id`
- Queries by person full name (and optional DOB) or by `_id` when provided
- Uses most recent event by `scraped_at` (or county-filtered if "county" provided)

## Endpoints

Base path: `/telnyx`

### POST /telnyx/find_person
Find a person by full name and optional DOB; returns person and their latest custody snapshot.

Request JSON:
- `full_name` (string, required)
- `dob` (string, optional, e.g., `1990-01-01`)
- `county` (string, optional; used to prefer that county in lookups)

Response JSON examples:
- Found via simple_*:
```json
{
  "found": true,
  "person": { "id": null, "full_name": "DOE, JOHN", "dob": "1990-01-01", "aka": [] },
  "latest_custody": {
    "id": "...",
    "status": "In Custody",
    "facility": "Harris",
    "county": "Harris",
    "booking_number": "...",
    "total_bond": "$2,500.00",
    "arrest_date": "2024-09-14",
    "source_url": null,
    "scraped_at": 1726351200
  }
}
```
- Found via persons/custody_events:
```json
{
  "found": true,
  "person": {
    "id": "6510f...",
    "full_name": "John A Smith",
    "dob": "1988-03-02",
    "aka": []
  },
  "latest_custody": {
    "id": "6510f...",
    "status": "In Custody",
    "facility": "County Jail",
    "county": "Harris",
    "booking_number": "BN123",
    "total_bond": "$5,000.00",
    "arrest_date": "2024-09-14",
    "source_url": "https://...",
    "scraped_at": 1726351200
  }
}
```
- Not found:
```json
{ "found": false }
```

Errors:
- 400 if `full_name` missing
- 401/403 on auth failures

### POST /telnyx/get_bail_status
Return simplified bail eligibility and amount for a given person.

Request JSON:
- Either:
  - `person_id` (Mongo `_id` as string), or
  - `full_name` (string) and optional `dob`
- Optional: `county` to bias simple_* lookup

Response JSON when found:
```json
{
  "found": true,
  "has_custody": true,
  "status": "In Custody",
  "total_bond": "$5,000.00",
  "amount_numeric": 5000.0,
  "eligible": true
}
```
- If person exists but no custody: `{ "found": true, "has_custody": false }`
- If not found at all: `{ "found": false }`

Errors:
- 400 if neither `person_id` nor `full_name` provided
- 400 if `person_id` is not a valid ObjectId

Notes on eligibility:
- Converts `total_bond` string to numeric when possible
- Marks `eligible` False if custody status contains "release" or bond string contains "no bond"
 - For Harris simple_* records, also attempts to parse `bond_label`/`dbg_bond_note` when `bond` and `bond_amount` are missing.
 - Both bail endpoints now include `bond_text` (the human-readable source text) and `needs_human_review` (true when a numeric bond is unavailable and the text implies follow-up like “refer to magistrate”).

### POST /telnyx/create_bail_inquiry
Create a bail inquiry (lead) record. Does not alter custody; writes to `inquiries`.

Request JSON:
- One of: `person_id` or `inmate_name`/`full_name`
- `caller_name` (string, required)
- `caller_phone` (string, E.164, required)
- `relationship` (string, optional)
- `intends_to_post` (bool, optional)
- `notes` (string, optional)

Response JSON:
```json
{ "ok": true, "inquiry_id": "6521a..." }
```

Errors:
- 400 if neither person_id nor full_name
- 400 if name/phone missing or phone not E.164

## Helper functions

- `_auth(request)`: Validates Bearer token.
- `_e164(phone)`: Returns E.164 or None.
- `_objid(s)`: Parses MongoDB ObjectId.
- `_latest_custody(person_id)`: Most recent `custody_events` by `scraped_at`.
- `_parse_bond_str(total_bond)`: Safely parse "$x,xxx.xx" → float.
 - `_parse_bond_label(s)`: Extract numeric bond and simple eligibility from label strings (handles “No Bond”, “PR Bond”, “$5,000.00”).
- `_split_name(full_name)`: Heuristics for "Last, First" and spaced names.
- `_score_simple_hit(...)`: Scores simple_* match candidates.
- `_find_in_simple(full_name, dob, county_hint)`: Executes fast-path search.

### POST /telnyx/transfer_target

Resolve the best transfer phone number (E.164) for an office based on county.

Input JSON:

```
{ "county": "Harris" }
```

Response:

```
{ "ok": true, "phone": "+18324101662" }
```

Configuration:

```
OFFICE_ROUTES_JSON='{"harris":"+18324101662","brazoria":"+18325550123","galveston":"+18325550987","fortbend":"+18325550777"}'
DEFAULT_OFFICE_NUMBER='+18325550000'
```

Notes:
- Match is case-insensitive. Keys are compared on lowercase; a trailing “ county” is tolerated.
- If no county matches, the `DEFAULT_OFFICE_NUMBER` is returned (if set), otherwise `phone` is null.

### POST /telnyx/transfer_plan

Return an ordered list of numbers to dial based on county and time-of-day/day-of-week.

Input JSON:

```
{ "county": "Harris", "lang": "es" }  // lang optional; use for Spanish route if configured
```

Response:

```
{
  "ok": true,
  "numbers": ["+18324100001", "+17130001111"],
  "attempt_timeout_sec": 20
}
```

Configuration:

```
OFFICES_SCHEDULE_JSON='{
  "harris": [
    {"days":["mon","tue","wed","thu","fri"],"start":"08:00","end":"18:00","numbers":["+18324100001","+18324100002"]},
    {"days":["mon","tue","wed","thu","fri"],"start":"18:00","end":"07:59","numbers":["+17130001111","+17130002222"]},
    {"days":["sat","sun"],"start":"00:00","end":"23:59","numbers":["+17130003333","+17130004444"]}
  ],
  "brazoria": [
    {"days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"17:00","numbers":["+18325550101","+18325550102"]},
    {"days":["sat","sun"],"start":"00:00","end":"23:59","numbers":["+17130005555","+17130006666"]}
  ],
  "galveston": [
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"00:00","end":"23:59","numbers":["+18325550987"]}
  ],
  "fortbend": [
    {"days":["mon","tue","wed","thu","fri"],"start":"07:00","end":"19:00","numbers":["+18325550777","+18325550778"]},
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"19:00","end":"06:59","numbers":["+17130007777"]}
  ],
  "default": [
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"00:00","end":"23:59","numbers":["+18325550000"]}
  ]
}'
APP_TZ='America/Chicago'
DIAL_ATTEMPT_TIMEOUT_SEC=20
```

Notes:
 - Harris policy: when matching the `harris` schedule (non‑Spanish), if the first on‑call number doesn’t answer within the attempt timeout (roughly 3 rings), the next attempt will automatically be Alex (Spanish line) before trying any other fallbacks. Set `DIAL_ATTEMPT_TIMEOUT_SEC` to ~18–20 seconds to align with ~3 rings.

Example: Harris county schedule (with real numbers)

```
// People on rota (for your reference only):
// Jennie (Weekdays 8:30 AM–2:59 PM)
// Dylo (Mon/Wed/Fri 3:00 PM–7:59 PM; Sat/Sun 8:30 AM–2:59 PM)
// KG   (Tue/Thu 3:00 PM–7:59 PM; Sat/Sun 3:00 PM–7:59 PM)
// Jerry (Overnight daily 8:00 PM–7:00 AM)
// Alex  (Spanish calls)

OFFICES_SCHEDULE_JSON='{
  "harris": [
    {"days":["mon","tue","wed","thu","fri"],"start":"08:30","end":"14:59","numbers":["+18326101254"]},  // Jennie
    {"days":["mon","wed","fri"],"start":"15:00","end":"19:59","numbers":["+18324339385"]},               // Dylo
    {"days":["tue","thu"],"start":"15:00","end":"19:59","numbers":["+17134464076"]},                      // KG
    {"days":["sat","sun"],"start":"08:30","end":"14:59","numbers":["+18324339385"]},                       // Dylo (weekend midday)
    {"days":["sat","sun"],"start":"15:00","end":"19:59","numbers":["+17134464076"]},                       // KG (weekend afternoon)
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"20:00","end":"07:00","numbers":["+14098536685"]} // Jerry overnight
  ],
  "harris_es": [
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"00:00","end":"23:59","numbers":["+18328732866"]}  // Alex (Spanish)
  ],
  "default": [
    {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"00:00","end":"23:59","numbers":["+17132252727"]}    // Main number fallback
  ]
}'
```

Replace the +1… placeholders with your actual E.164 numbers.
- `_bail_view_from_simple(doc)`: Shapes a uniform bail response from simple_* docs.

## MongoDB schema expectations (minimal)

- `persons`: `{ _id, full_name, dob?, aka?[] }`
- `custody_events`: `{ _id, person_id, status, facility?, county?, booking_number?, total_bond?, arrest_date?, source_url?, scraped_at }`
- `inquiries`: `{ _id, person_id?, full_name?, caller_name, caller_phone, relationship?, intends_to_post, notes?, created_ts }`
- `simple_*`: lightweight booking records with fields used above: `first_name`, `last_name`, `full_name`, `dob?`, `booking_date?`, `bond` or `bond_amount`, `county`, `booking_number`, `normalized_at`

## Configuration

Set these in `.env`:
- `TELNYX_TOOL_TOKEN` (required)
 - `OFFICE_ROUTES_JSON` and `DEFAULT_OFFICE_NUMBER` (optional for transfer routing)
- Database: `MONGO_URI`, `MONGO_DB`

Optional (elsewhere in the app): S3, IP geo, Twilio.

## Error handling and responses

- Auth failures throw HTTPException 401/403.
- Invalid inputs return HTTP 400 with a short message.
- Lookups return stable JSON shapes with `found` flags to simplify Telnyx tool logic.

## Usage from Telnyx

Configure your Telnyx AI Assistant tool to POST to the relevant endpoint with JSON body and include `Authorization: Bearer <TELNYX_TOOL_TOKEN>`.

Example tool definition (pseudocode):
- name: "find_person"
- method: POST
- url: `${BASE_URL}/telnyx/find_person`
- headers: `{ Authorization: 'Bearer ${TELNYX_TOOL_TOKEN}' }`
- input schema: `{ full_name: string, dob?: string, county?: string }`

Repeat similarly for `get_bail_status` and `create_bail_inquiry`.

See also: `docs/AI_Agent_Voice_Script.md` for the recommended call flow and prompts leveraging `bond_text` and `needs_human_review`.

## Telnyx Portal setup (step-by-step)

1) Assign your phone number to an AI Assistant
- In Telnyx → AI → Assistants → Create (or edit existing)
- Voice: choose ElevenLabs Lina (or your preferred voice)
- Model: Anthropic Claude 3.7 Sonnet (recommended)
- Phone Numbers: assign +1 713-225-2727 to this Assistant

2) Add Tools for your backend endpoints
- Tools → Add HTTP Tool for each endpoint:
  - POST ${BASE_URL}/telnyx/find_person
  - POST ${BASE_URL}/telnyx/get_bail_status
  - POST ${BASE_URL}/telnyx/create_bail_inquiry
  - POST ${BASE_URL}/telnyx/attach_caller
  - POST ${BASE_URL}/telnyx/transfer_plan (primary)
  - POST ${BASE_URL}/telnyx/transfer_target (fallback)
- Headers (for each Tool): Authorization: Bearer ${TELNYX_TOOL_TOKEN}

3) Configure environment in your app
- In your .env:
  - BASE_URL=https://YOUR_DOMAIN
  - TELNYX_TOOL_TOKEN=your-long-random-token
  - OFFICES_SCHEDULE_JSON=... (see Harris example above)
  - APP_TZ=America/Chicago
  - DIAL_ATTEMPT_TIMEOUT_SEC=20

4) Optional: Add webhooks for transcripts and call analytics
- In Telnyx → Assistants → Webhooks → set Event Webhook URL:
  - ${BASE_URL}/telnyx/ai_events
- Optional Shared Secret (recommended): set a random secret; in your .env set:
  - TELNYX_WEBHOOK_SECRET=the-same-secret
- (Optional) Call status webhooks (if you also use Call Control app):
  - Webhook URL: ${BASE_URL}/telnyx/call_events
- (Optional) Recording webhooks (if you enable recording):
  - Webhook URL: ${BASE_URL}/telnyx/recording_ready

Request format Telnyx will POST (examples vary):
```json
{
  "type": "ai.event",
  "data": {
    "session_id": "...",
    "event": "transcript.final",
    "text": "caller: ..."
  }
}
```

Verification:
- Telnyx will include X-Telnyx-Secret: <secret> if configured; the app verifies it.
- These webhook endpoints do not require the Bearer tool token.

## Phone number setup checklist (attach your +1 number)

When you buy/see a number in Telnyx, it will show warnings like “Required for calls” and “Required for SMS” until it’s attached. Attach it in two places:

1) Connection/Application → AI Assistant (for calls)
  - Telnyx → Numbers → find your number → pencil icon.
  - Under Connection/Application, choose AI → select your Assistant (e.g., “ASAP Bail Bonds – Lina”).
  - Save. This routes inbound voice calls to your Assistant.

2) Messaging Profile (for SMS)
  - In the same number edit panel, choose a Messaging profile.
  - If you don’t have one yet: Messaging → Profiles → Create Profile → name it (e.g., “ASAP Agent”) → allow outbound SMS/MMS → Save.
  - Assign that profile to the number and Save.

3) Services check
  - Ensure the number shows Voice and SMS/MMS enabled (the service icons will be active, not greyed out).
  - Optional but recommended (US only): A2P 10DLC brand/campaign registration → attach to the Messaging Profile for best deliverability.

4) Backend envs for outbound SMS via Telnyx
  - Set the following in your app’s environment:
    - `TELNYX_API_KEY=...` (must have Messaging permissions)
    - Either `TELNYX_MESSAGING_FROM_NUMBER=+1xxx...` (the SMS‑enabled number you just attached)
     or `TELNYX_MESSAGING_PROFILE_ID=<uuid>` (Profile → copy ID)
  - With these set, `POST /telnyx/notify_agent` will send via Telnyx automatically.

5) Quick verification
  - Call your number: your AI Assistant should answer.
  - Send yourself a text via the app:
    - POST `${BASE_URL}/telnyx/notify_agent` with body `{ "to_phone": "+1YOURMOBILE" }` and Authorization header.
    - You should receive an SMS from your Telnyx number (or from the profile’s assigned sender).

Notes
- The voice Transfer tool’s “From” DID can be the same number or a different Telnyx number; it doesn’t affect SMS. Keep your current From DID if you prefer.
- Inbound SMS handling is optional for this project. If you later want to process replies, set a Messaging webhook on the profile and add an endpoint in your app.

### FAQ: Do I need to assign a number under AI Assistant → Messaging?

Not for this project’s notify_agent texts.

- The AI Assistant → Messaging tab is for running your Assistant over SMS with end‑users (two‑way conversational SMS where the Assistant itself replies by text). If you aren’t planning to text with callers directly, you can leave this unassigned.
- Our backend sends heads‑up texts via the Telnyx Messaging API using your Messaging Profile and/or From number. That only requires the number to be attached to a Messaging Profile (as described above), not to the Assistant’s Messaging tab.
- If, in the future, you want callers to text the Assistant and get automated SMS responses, then assign a number on AI Assistant → Messaging and configure Delivery Status / inbound webhooks accordingly.

## Assistant Instructions (drop-in)

Paste this into your Telnyx Assistant “Instructions” field. It adds the two tweaks you asked for: caller-facing progress announcements and retry logic, plus language-aware routing via `lang`.

```
Conversation style
- Be warm, concise, and professional. Use short sentences and natural pauses. If the caller prefers Spanish, switch to Spanish for the entire call.

Core flow
1) Intake: politely get the inmate’s name (and DOB if they know it), caller name/phone, relationship, and whether they intend to post bail.
2) Lookups: use the provided tools to find the inmate and bail status. If bail is unclear and the text suggests “refer to magistrate” or pending, tell the caller we’ll have a bondsman advise them.
3) Confirm transfer: “I’m going to bring an on‑call bondsman on the line now.”

Language handling
- Maintain a variable called language. If the caller speaks Spanish or asks for Spanish, set language = "es" and continue in Spanish; otherwise leave it empty.

Transfer behavior (announce progress + retry)
1) Say to the caller: “One moment while I connect you.”
2) Call the transfer_plan tool with the county and the language variable to get an ordered list of phone numbers and attempt_timeout_sec. Do not read numbers aloud.
   - Input JSON: { county: {{county}}, lang: {{language}} }
3) For each number (destination_number) in order:
   - Tell the caller: “Connecting you now.”
   - Place the transfer to that destination number using the Transfer tool.
   - If the call isn’t answered within attempt_timeout_sec seconds, tell the caller: “No answer, I’ll try the next number,” then try the next number.
4) If all attempts fail: apologize and offer to take a brief message or request a call‑back number. Let the caller know we’ll reach out shortly.

Important
- Keep the caller on the line during dialing so there’s no dead air; give a brief reassurance if waiting.
- Never expose raw JSON or read phone numbers out loud.
- Use the “Warm Transfer Instructions” configured inside the Transfer tool to briefly tell the bondsman what the call is about (e.g., bail inquiry and that the caller intends to post). Those whispers are heard by the agent, not the caller.
- If attempt_timeout_sec isn’t provided, assume 20 seconds.
```

Recommended assistant variables
- `county` (string): normalized county name, e.g., "Harris"
- `language` (string): empty or "es" when the caller prefers Spanish
- `inmate_name`, `inmate_dob` (strings)
- `caller_name`, `caller_phone` (strings, E.164 for phone when known)
- `caller_relationship` (string)
- `caller_intends_to_post` (boolean)

Transfer tool configuration
- From Number/SIP URI: `+17133256085` (Assistant DID)
- Targets → To Number/SIP URI: `{{destination_number}}` (use a variable)
- Warm Transfer Instructions (example):
  - “Hi, I’m connecting a caller about a {{county}} County bail inquiry for {{inmate_name}}. They confirmed intent to post. I’m bringing you on now.”

Update your transfer_plan tool body (Advanced JSON)
```json
{
  "county": "{{county}}",
  "lang": "{{language}}"
}
```
Notes:
- Passing `lang` allows the backend to prioritize Spanish routing (e.g., Alex) when `language` is "es". Harris also auto‑inserts Alex as the second attempt after the first no‑answer and uses Alex as a gap fallback when no schedule window matches.

### Tool config: Input Schema vs Request Body (transfer_plan)

In the Telnyx HTTP tool editor there are two different JSON areas:
- Input Schema (optional): defines what the assistant is allowed to pass.
- Request Body (Advanced): the actual JSON sent to your API. This should reference assistant variables like `{{county}}` and `{{language}}`.

Recommended Input Schema for transfer_plan:
```json
{
  "type": "object",
  "properties": {
    "county": {
      "type": "string",
      "description": "County name, e.g. 'Harris' or 'Harris County'. Case-insensitive."
    },
    "lang": {
      "type": "string",
      "enum": ["es"],
      "description": "Language code. Use 'es' for Spanish routing only; omit for English/default."
    }
  },
  "required": ["county"]
}
```

Request Body (Advanced) for transfer_plan:
```json
{
  "county": "{{county}}",
  "lang": "{{language}}"
}
```

Why avoid `lang: "en"`?
- The backend treats `lang` as optional. When provided, it first checks a county‑specific key like `harris_es`. There is no `harris_en` key, so sending `"en"` just adds an unnecessary lookup before falling back to `harris`. Prefer sending `"es"` for Spanish or leaving `lang` blank/omitted for English.

## Webhook Tool: notify_agent (text summary)

Send a short SMS to the on‑call agent just before you dial them. The backend uses your Twilio configuration (`app/sms.py`) and logs outcomes in the `logs` collection.

- Method: POST
- URL: `${BASE_URL}/telnyx/notify_agent`
- Headers: `Authorization: Bearer ${TELNYX_TOOL_TOKEN}`

Minimal Request Body (Advanced mode):
```json
{
  "to_phone": "{{destination_number}}",
  "county": "{{county}}",
  "summary": "Connecting caller now about {{inmate_name}}."
}
```

Full Request Body (optional richer context):
```json
{
  "to_phone": "{{destination_number}}",
  "county": "{{county}}",
  "inmate": {
    "full_name": "{{inmate_name}}",
    "dob": "{{inmate_dob}}"
  },
  "bail": {
    "total_bond": "{{bail_total_bond}}",
    "amount_numeric": "{{bail_amount_numeric}}",
    "eligible": "{{bail_eligible}}",
    "bond_text": "{{bail_bond_text}}",
    "needs_human_review": "{{bail_needs_human_review}}"
  },
  "caller": {
    "name": "{{caller_name}}",
    "phone": "{{caller_phone}}",
    "relationship": "{{caller_relationship}}",
    "intends_to_post": "{{caller_intends_to_post}}"
  },
  "summary": "Caller confirmed posting intent. Bringing you on now."
}
```

Usage notes:
- Call this immediately before each Transfer attempt so the on‑call agent gets a heads‑up SMS.
- `to_phone` should be the same `{{destination_number}}` you’re about to dial.
- Only `to_phone` is required; other fields enrich the message.
- Example SMS format produced by the backend: `New transfer (Harris): Inmate John Doe (DOB 1990-01-01) | Bail $5,000.00 | Eligible | Caller Jane +18324101662 | intends to post | Summary: Connecting caller now...`

Enable SMS delivery (Twilio env vars)
- The app sends SMS via Twilio (`app/sms.py`). Set these in your `.env` and redeploy:
  - `TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
  - `TWILIO_AUTH_TOKEN=...`
  - `TWILIO_FROM_NUMBER=+1XXXXXXXXXX` (E.164)
- If these are not set, the endpoint will no‑op in dev mode (prints to logs) but won’t actually text the agent.

Quick verification (optional)
- Make a test POST to `POST ${BASE_URL}/telnyx/notify_agent` with your Bearer token and your own phone as `to_phone`. You should receive the SMS within a few seconds when Twilio creds are configured.

### POST /telnyx/attach_caller
Attach caller info to a case CRM if a case exists for the inmate; always records an inquiry.

Request JSON:
- One of: `person_id` or `inmate_name`/`full_name` (+optional `dob`)
- `caller_name` (string, required)
- `caller_phone` (E.164, required)
- `relationship` (string, optional)
- `intends_to_post` (bool, optional)
- `notes` (string, optional)

Response:
```json
{ "ok": true, "inquiry_id": "...", "linked_to_case": true, "case_id": "CASE123" }
```
If the person is unresolved or there is no case, `linked_to_case` will be false, but the inquiry will still be created.

## Notes and limitations

- The fast path only checks a fixed set of counties: Harris, Brazoria, Galveston, Fort Bend, and only if those collections exist.
- County hint biases which collection to check first; it does not hard-filter across all results.
- `eligible` is a heuristic; business rules may require refinement.
- When a person is found only in simple_* data, the `person.id` is null (not persisted in `persons`).
