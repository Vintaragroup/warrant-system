# Telnyx Pre-Signed URL: Correct Approach

## What You Learned

From Telnyx documentation, the correct way to get a pre-signed URL is:

1. **Use Telnyx Cloud Storage Companion API**
   - Endpoint: `POST /api/cloud-storage-companion/create-presigned-object-url`
   - Body: `{"object_path": "hold-music/moonlightdrive.mp3", "region": "us-central-1"}`
   - Returns: Pre-signed URL with `X-AMZ-Security-Token` query parameter

2. **Use the returned URL in playback_start**
   ```
   audio_url: https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3?X-AMZ-Security-Token=...
   ```

---

## Problem: API Endpoint Requires Different Authentication

The Cloud Storage Companion API endpoint appears to require:
- Different token type or permission level
- Account verification (Level 2 verified account for longer TTLs)
- Possibly different API key format

---

## Alternative Solution: Use Your Render Server as Proxy

Since your Render server can reach the Telnyx private storage, we can create a **public proxy endpoint** that:

1. Your Render server fetches the audio from private Telnyx storage (internal access)
2. Returns it publicly to Telnyx playback_start API
3. Playback_start can then access your public endpoint

### Implementation:

Add to `app/telnyx_tools.py`:

```python
@router.get("/hold_music/moonlightdrive.mp3")
async def serve_hold_music():
    """
    Proxy endpoint that serves hold music from Telnyx private storage.
    Accessible to Telnyx playback_start API (public URL).
    """
    import requests
    
    # Direct Telnyx URL (accessible from Render's internal network)
    telnyx_url = "https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3"
    
    try:
        res = requests.get(telnyx_url, timeout=30)
        res.raise_for_status()
        
        return StreamingResponse(
            content=res.content,
            media_type="audio/mpeg",
            headers={"Content-Length": len(res.content)}
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch hold music: {e}")
```

### Then set in Render:

```
HOLD_MUSIC_URL=https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3
```

This URL is:
- ✅ Publicly accessible (Telnyx can reach it)
- ✅ Served from your Render server
- ✅ Proxies the audio from Telnyx private storage
- ✅ No pre-signed URL needed

---

## Which Approach to Use?

**Option A: Cloud Storage API (If you can verify account)**
- Contact Telnyx support
- Verify your account to Level 2
- Use the Cloud Storage Companion API
- Get a real pre-signed URL

**Option B: Render Proxy (Immediate solution)**
- Add the proxy endpoint to your code
- No account verification needed
- Works immediately
- Slight overhead (proxying through your server)

---

## Recommendation

**Use Option B (Render Proxy) for now:**

1. It works immediately
2. No account verification needed
3. Simple to implement
4. Telnyx documentation says pre-signed URLs are for users with verified accounts

Would you like me to implement Option B (the proxy approach)?
