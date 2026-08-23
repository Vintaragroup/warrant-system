Hold music
===========

Place your MP3 (or WAV/Opus) hold music files in this folder to be served at:

  /static/hold/<filename>

Recommended:
- Keep the file small (10–30s loop, 64–128 kbps mono MP3)
- Use non‑copyrighted/CC0/your‑owned audio
- Normalize loudness; avoid jarring starts

Example Render env setting:

  HOLD_MUSIC_URL=https://ai-agent-warrant.onrender.com/static/hold/moonlightdrive.mp3

After you upload the file here and deploy, verify:
- HEAD the file URL returns 200 and Content-Type audio/mpeg
- GET /telnyx/hold_music (with Bearer token) returns the configured URL
