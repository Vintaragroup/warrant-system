# Telnyx Object Storage URL Issue: 403 Forbidden

## What Happened

The URL you provided:
```
https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3
```

Returns **403 Forbidden**, which means the file exists but is not publicly accessible (likely requires authentication or a pre-signed URL).

## Solution: Get a Pre-Signed URL

### Via Telnyx Mission Control Portal (Easiest)

1. **Go to Telnyx Mission Control**: https://mission-control.telnyx.com
2. Navigate to: **Developer** → **Object Storage**
3. Find your uploaded file: `moonlightdrive.mp3`
4. Look for one of these options:
   - **Download** button → right-click and get the URL
   - **Share** button → generates a shareable/pre-signed URL
   - **More actions** (three dots) → look for "Get URL" or "Share"
5. The URL should look like:
   ```
   https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=abc123&Expires=1698453600
   ```
   OR
   ```
   https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3?Signature=xyz&Expires=123
   ```
6. **Copy this full URL** (including all query parameters!)

### Via Telnyx API (Programmatic)

If the portal doesn't show an obvious "Share" option, you can generate a pre-signed URL via API:

```bash
# Get your Telnyx API Key from Mission Control → Account → API Keys
export TOKEN="<your-telnyx-api-key>"

# List your object storage files to get the object ID
curl -s "https://api.telnyx.com/v2/object_storage/objects" \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# Find your moonlightdrive.mp3 object ID (e.g., "obj_abc123xyz")
# Then generate a pre-signed URL

curl -X POST "https://api.telnyx.com/v2/object_storage/objects/<OBJECT_ID>/signed_url" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "expires_in_seconds": 604800
  }'
```

This will return:
```json
{
  "data": {
    "signed_url": "https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=...&Expires=1698453600"
  }
}
```

## What To Do Next

1. **Get the pre-signed URL** using one of the methods above
2. **Share it with me** or **set it in Render**:
   - Render Dashboard → Your service → Environment
   - Add: `HOLD_MUSIC_URL=<your-presigned-url>`
   - Deploy
3. **Test with curl**:
   ```bash
   # Should return 200 OK with audio/mpeg content-type
   curl -I "https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3?Signature=..."
   ```
4. **Then test the endpoint**:
   ```bash
   curl -H "Authorization: Bearer $TOKEN" \
     https://ai-agent-warrant.onrender.com/telnyx/hold_music
   ```
   Should return:
   ```json
   {
     "ok": true,
     "hold_music_url": "https://us-central-1.telnyxcloudstorage.com/..."
   }
   ```

## Important Notes

- **Pre-signed URLs are time-limited** (usually 1 hour to 7 days)
- If it expires, you'll need to generate a new one and update Render
- For long-term use, consider generating a URL with a longer expiration (use `expires_in_seconds` parameter)
- The URL must be **publicly accessible** (not require additional auth headers)

## Testing the Final Result

Once you have the pre-signed URL set in Render:

```bash
# Place a test call to your Telnyx number
# When Agent initiates transfer:
#   1. warm_transfer_plan returns the HOLD_MUSIC_URL
#   2. playback_start gets called with that URL
#   3. Telnyx API uses the URL to download and play the audio
#   4. Caller hears hold music (NOT dead air!)
#   5. Agent answers and presses 1
#   6. playback_stop is called
#   7. Agent and caller can now speak
```

---

**Next Action**: Get the pre-signed URL from Telnyx portal and share it here, or set it directly in your Render environment.
