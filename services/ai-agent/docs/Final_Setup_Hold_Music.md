# Hold Music Setup: FINAL - Simple 3-Step Process

## What Changed

Telnyx's direct private storage URL won't work with `playback_start` API. **Solution:** Use your Render server as a proxy.

Your server now has a new endpoint:
```
GET /hold_music/moonlightdrive.mp3 → serves your hold music publicly
```

Telnyx can access this URL, fetch the audio, and play it during transfers.

---

## Step 1: Deploy Updated Code

Your code was just pushed with the proxy endpoint.

**Wait for Render to auto-deploy** (usually takes 2-5 minutes).

Check **Render Dashboard** → **Events** to see deployment status.

---

## Step 2: Set Hold Music URL (ONE Environment Variable)

Go to **Render Dashboard** → Your service → **Environment**

Add this variable:
```
HOLD_MUSIC_URL=https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3
```

Click **Save**. This will trigger a re-deploy.

---

## Step 3: Verify & Test

Once deployed, run this test:

```bash
# Test that the proxy endpoint works
curl -I https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3

# Should return:
# HTTP/2 200
# Content-Type: audio/mpeg
# Content-Length: 5971968
```

Then test the endpoint:

```bash
TOKEN="<your TELNYX_TOOL_TOKEN, from the ai-agent service env>"

curl -H "Authorization: Bearer $TOKEN" \
  https://ai-agent-warrant.onrender.com/telnyx/hold_music_test

# Should return:
# {
#   "ok": true,
#   "url": "https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3",
#   "status_code": 200,
#   "content_type": "audio/mpeg",
#   "error": null
# }
```

---

## Step 4: Update Agent & Test

Once verified:

1. **Update Telnyx AI Assistant** with `docs/Agent_Prompt_Simplified.md`
2. **Place a test call** to +17133256085
3. **Initiate a warm transfer**
4. **Listen for hold music** on your phone while waiting for agent to answer
5. **Agent presses 1** to accept
6. **Music stops** and you can speak to agent

---

## Architecture

```
Caller's Phone
    ↓
Telnyx AI Assistant (Burt)
    ↓
warm_transfer_plan() → returns hold_music_url
    ↓
playback_start(audio_url: "https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3")
    ↓
Render Server (proxy endpoint)
    ↓
Telnyx Private Storage (https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3)
    ↓
Audio streamed back to Telnyx
    ↓
Caller hears hold music ✅
```

---

## Why This Works

- ✅ **No pre-signed URLs needed** (those require account verification)
- ✅ **No authentication** (proxy endpoint is public)
- ✅ **Your Render server can access private Telnyx storage** (internal network access)
- ✅ **Telnyx API can access your public Render endpoint**
- ✅ **Audio streams seamlessly** from storage → proxy → Telnyx → caller

---

## Summary

| Step | Action | Status |
|------|--------|--------|
| 1 | Deploy updated code | ⏳ Auto-deploy in progress |
| 2 | Set `HOLD_MUSIC_URL` env var | ⏳ YOU DO THIS |
| 3 | Verify proxy works with curl | ⏳ Test after step 2 |
| 4 | Update Agent prompt | ⏳ After verification |
| 5 | Test full transfer | ⏳ Final test |

---

## Next Action

1. **Wait for Render deployment** (watch Events tab)
2. **Set the environment variable** (see Step 2 above)
3. **Run verification test** (see Step 3 above)
4. **Tell me when it's done!** Then we'll do a full end-to-end test
