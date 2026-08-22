# Hold Music Setup for Telnyx Warm Transfer

## Overview

Telnyx **does NOT automatically play hold music from a URL** during transfers. Instead, you must:

1. **Upload** MP3 to Telnyx Object Storage
2. **Get a pre-signed URL** from Telnyx
3. **Call `playback_start`** API when transfer begins to actually play it

This document walks through each step.

---

## Step 1: Upload Hold Music to Telnyx Object Storage

### Option A: Via Telnyx Portal (Easiest)

1. Log in to **Telnyx Mission Control** → https://mission-control.telnyx.com
2. Navigate to **Developer** → **Object Storage**
3. Click **Upload File**
4. Select your `moonlightdrive.mp3`
5. Wait for upload to complete
6. **Note the pre-signed URL** that appears (or generate one if not shown)

### Option B: Via API (Programmatic)

```bash
# First, get your Telnyx API key from Mission Control → Account → API Keys
export TOKEN="<your-telnyx-api-key>"
export FILE_PATH="/path/to/moonlightdrive.mp3"

# Upload to Telnyx Object Storage
curl -X POST https://api.telnyx.com/v2/object_storage/uploads \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: audio/mpeg" \
  --data-binary @"$FILE_PATH"
```

**Response example:**
```json
{
  "data": {
    "id": "obj_abc123xyz",
    "filename": "moonlightdrive.mp3",
    "size": 5242880,
    "created_at": "2025-10-27T22:00:00Z",
    "signed_url": "https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=...&Expires=1698453600"
  }
}
```

**Copy the `signed_url`** — this is what you'll use in `playback_start`.

---

## Step 2: Set the Pre-Signed URL in Render Env

Once you have the Telnyx object storage URL, update your Render environment:

1. Go to **Render Dashboard** → Your service → **Environment**
2. Add/update this variable:
   ```
   HOLD_MUSIC_URL=https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=...&Expires=...
   ```
3. **Deploy** the service

Your FastAPI will now have access to this URL via `settings.HOLD_MUSIC_URL`.

---

## Step 3: Agent Calls `playback_start` During Transfer

In your Agent Prompt, when initiating warm transfer:

```
Tell caller: "One moment while I connect you with a representative. Please hold."

Then IMMEDIATELY call playback_start tool with:
{
  "audio_url": "<value from warm_transfer_plan.response.hold_music_url>",
  "loop": true
}
```

**How it works:**
- `warm_transfer_plan` endpoint returns `hold_music_url` (the pre-signed Telnyx URL)
- Agent calls `playback_start` with that URL
- Your FastAPI endpoint calls Telnyx API: `POST /v2/calls/{call_control_id}/actions/playback_start`
- Hold music begins playing immediately on the caller's line

---

## Step 4: Agent Stops Music When Agent Answers

After transfer succeeds (agent presses 1 to accept), Agent must call `playback_stop`:

```
Agent presses 1 to accept transfer.
Call playback_stop tool with: { }

(No parameters needed; call_control_id comes from context)
```

This stops hold music before the agent comes on line so they can hear each other.

---

## Step 5: Test the Flow

### Test Sequence:

1. **Place inbound call** to your Telnyx number (+17133256085)
2. **Agent greets caller**, collects inmate info, bail status, caller name
3. **Agent initiates transfer**:
   - Calls `warm_transfer_plan` → gets `hold_music_url`
   - Calls `playback_start` with that URL
   - Initiates **Voice Transfer** to +16263796590
4. **On caller's phone**: Should hear hold music (not dead air!)
5. **Your phone rings** with agent whisper text
6. **Press 1** to accept transfer
7. **Agent calls `playback_stop`**
8. **You hear**: Agent on the line (no more music)

---

## Troubleshooting

### Hold Music Not Playing?

1. **Verify pre-signed URL is still valid**
   - URLs expire after a time (typically 1 hour to 7 days)
   - If expired, generate a new one in Telnyx portal
   - Update `HOLD_MUSIC_URL` in Render env and redeploy

2. **Check Telnyx logs for playback_start errors**
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     "https://ai-agent-warrant.onrender.com/telnyx/debug_recent?types=telnyx_playback_start*"
   ```
   Look for `telnyx_playback_start_error` logs.

3. **Verify `call_control_id` is being passed**
   - Agent prompt must reference the current call's control ID
   - Telnyx AI Assistant provides this automatically in tool calls

4. **Test `playback_start` directly**:
   ```bash
   TOKEN="<your-bearer-token>"
   CALL_ID="<call-control-id-from-call>"
   MUSIC_URL="<your-telnyx-object-storage-url>"
   
   curl -X POST https://ai-agent-warrant.onrender.com/telnyx/playback_start \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d "{
       \"call_control_id\": \"$CALL_ID\",
       \"audio_url\": \"$MUSIC_URL\",
       \"loop\": true
     }"
   ```

### Call Control ID Not Available?

If Agent can't call `playback_start` because `call_control_id` isn't exposed:

1. Telnyx AI Assistant **automatically** provides `call_control_id` in function calls
2. Your Agent prompt may need to explicitly reference it in the tool call context
3. Consult **Telnyx AI Assistant documentation** for how to access current call metadata

---

## References

- **Telnyx Object Storage Docs**: https://developers.telnyx.com/docs/object-storage
- **Playback Start API**: https://developers.telnyx.com/docs/api/v2/call-control/call-commands#playbackStart
- **Playback Stop API**: https://developers.telnyx.com/docs/api/v2/call-control/call-commands#playbackStop
- **Call Control API**: https://developers.telnyx.com/docs/api/v2/call-control

---

## Summary

| Step | What | Where |
|------|------|-------|
| 1 | Upload MP3 to Telnyx | Mission Control → Object Storage |
| 2 | Copy pre-signed URL | Telnyx response |
| 3 | Set in Render env | `HOLD_MUSIC_URL=...` |
| 4 | Agent calls playback_start | During transfer (via warm_transfer_plan) |
| 5 | Agent calls playback_stop | When agent answers |
| 6 | Test | Place inbound call, trigger transfer, listen for music |

**Next Action**: Upload your `moonlightdrive.mp3` to Telnyx Object Storage and share the pre-signed URL. Then I'll help you wire it into the Agent.
