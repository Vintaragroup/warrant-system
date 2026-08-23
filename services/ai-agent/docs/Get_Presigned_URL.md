# Getting a Pre-Signed URL from Telnyx Object Storage

## Why You Need a Pre-Signed URL

The direct Telnyx Object Storage URL returns **403 Forbidden**:
```
https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3 → 403 Forbidden
```

This is because Telnyx Object Storage requires either:
1. **Authentication headers** (API key)
2. **Pre-signed URL** (temporary public access)

For the Telnyx `playback_start` API to access the audio file, we need a **pre-signed URL** that grants temporary public access.

---

## Step-by-Step: Get Pre-Signed URL from Portal

### 1. Go to Telnyx Mission Control
- **URL:** https://mission-control.telnyx.com
- **Login** with your account

### 2. Navigate to Object Storage
- Click **Developer** (left sidebar)
- Click **Object Storage**
- You should see a folder named `hold-music`

### 3. Find Your File
- Click the `hold-music` folder
- You should see `moonlightdrive.mp3` listed

### 4. Get Shareable URL (Two Options)

**Option A: Download Button**
1. Click on `moonlightdrive.mp3` to open details
2. Click the **Download** button
3. Right-click the download link → **Copy link address**
4. This is your pre-signed URL

**Option B: Share Button**
1. Click on `moonlightdrive.mp3` to open details
2. Look for a **Share** button or **Generate URL** button
3. Click it to generate a shareable link
4. Copy the URL shown

**Option C: Details Page (Like Your Screenshot)**
1. Click `moonlightdrive.mp3` to view details
2. Look for an **"Object URL"** field
3. Check if there's a **"Copy"** button next to it
4. If it shows query parameters (`?Signature=...&Expires=...`), use that

### 5. The URL Should Look Like One of These:

```
https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=abc123...&Expires=1698453600

OR

https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3?Signature=xyz&Expires=123
```

**Key indicators:**
- ✅ Contains `?Signature=...` (proves it's pre-signed)
- ✅ Contains `&Expires=...` (shows expiration timestamp)
- ✅ These query params grant temporary public access

---

## Verify Pre-Signed URL Works

Once you have the URL, test it:

```bash
# Replace with your actual pre-signed URL
PRESIGNED_URL="https://telnyx-uploads.s3.amazonaws.com/obj_abc123xyz?Signature=...&Expires=..."

# Test with HEAD request (doesn't download full file)
curl -I "$PRESIGNED_URL"

# Should return:
# HTTP/1.1 200 OK
# Content-Type: audio/mpeg
# Content-Length: 5971968
```

If you get **200 OK** with `audio/mpeg`, you're good to go!

---

## Set Pre-Signed URL in Render

1. Go to **Render Dashboard**
2. Select your service: **AI_Agent_Warrant**
3. Click **Environment** (left sidebar)
4. Find or create: `HOLD_MUSIC_URL`
5. **Paste the full pre-signed URL** (with all query parameters!)
6. Click **Save**
7. Wait for re-deploy to complete

---

## Important Notes

⚠️ **Pre-signed URLs expire!**
- Default expiration: 7 days (604800 seconds)
- After expiration, you'll need to generate a new one
- You can generate URLs with longer expiration if needed

⚠️ **Keep the full URL with query parameters**
- Do NOT remove `?Signature=...&Expires=...`
- These parameters are what grant access
- Without them, you'll get 403 Forbidden again

⚠️ **Only share this URL with Telnyx playback API**
- The URL itself is valid but temporary
- Anyone with it can access the audio while valid
- This is fine for internal use; not for public distribution

---

## Troubleshooting

### Can't Find Pre-Signed URL in Portal

If the Telnyx portal doesn't show a "Share" or download button:

1. **Try the API approach** (requires your Telnyx API Key):
   ```bash
   export TELNYX_API_KEY="your-api-key"
   export OBJECT_ID="obj_abc123xyz"  # from portal object details
   
   curl -X POST "https://api.telnyx.com/v2/object_storage/objects/$OBJECT_ID/signed_url" \
     -H "Authorization: Bearer $TELNYX_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"expires_in_seconds": 604800}'
   ```

2. **Contact Telnyx Support** if the API doesn't work

### Still Getting 403 After Setting URL

- Verify the URL includes query parameters (`?Signature=...`)
- Check if the URL has expired (look at the `Expires` timestamp)
- Regenerate a new pre-signed URL
- Redeploy in Render

---

## Next Action

1. **Get the pre-signed URL** from Telnyx portal (using steps above)
2. **Copy it** (with all query parameters)
3. **Share it here** OR set it in Render environment as `HOLD_MUSIC_URL`
4. **I'll verify** it works and we'll test the full flow
