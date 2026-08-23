from __future__ import annotations
import httpx
from typing import Optional
from .config import settings

def _send_telnyx_sms(to_e164: str, body: str, *, media_url: Optional[str] = None) -> dict:
    """Send SMS via Telnyx Messaging API.
    Requires TELNYX_API_KEY and either TELNYX_MESSAGING_FROM_NUMBER or TELNYX_MESSAGING_PROFILE_ID.
    API docs: https://developers.telnyx.com/docs/api/v2/messaging/Messages
    """
    if not (settings.TELNYX_API_KEY and (settings.TELNYX_MESSAGING_FROM_NUMBER or settings.TELNYX_MESSAGING_PROFILE_ID)):
        raise RuntimeError("Telnyx messaging not configured")

    url = "https://api.telnyx.com/v2/messages"
    headers = {
        "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
        "Content-Type": "application/json",
    }
    # Add per-request idempotency key to make retries safe and avoid accidental duplicates
    try:
        import uuid as _uuid
        headers["Idempotency-Key"] = _uuid.uuid4().hex
    except Exception:
        pass
    payload = {
        "to": to_e164,
        "text": body,
    }
    # Prefer explicit 'from' when provided; also include messaging_profile_id if available
    if settings.TELNYX_MESSAGING_FROM_NUMBER:
        payload["from"] = settings.TELNYX_MESSAGING_FROM_NUMBER
        if settings.TELNYX_MESSAGING_PROFILE_ID:
            payload["messaging_profile_id"] = settings.TELNYX_MESSAGING_PROFILE_ID
    elif settings.TELNYX_MESSAGING_PROFILE_ID:
        payload["messaging_profile_id"] = settings.TELNYX_MESSAGING_PROFILE_ID

    # Telnyx supports MMS via 'media_urls' array
    if media_url:
        payload["media_urls"] = [media_url]

    with httpx.Client(timeout=10.0) as client:
        r = client.post(url, json=payload, headers=headers)
        content = None
        try:
            content = r.json()
        except Exception:
            content = {"raw_text": r.text}
        # Raise for http errors, but include detailed response in the exception
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as he:
            detail = {
                "status_code": r.status_code,
                "response": content,
            }
            raise RuntimeError(f"Telnyx API error: {detail}") from he
        return {"provider": "telnyx", "status_code": r.status_code, "data": content}

def _send_twilio_sms(to_e164: str, body: str, *, media_url: Optional[str] = None) -> dict:
    """Send SMS via Twilio REST API.
    Uses Messaging Service if TWILIO_MESSAGING_SERVICE_SID is set; otherwise uses From number.
    """
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
        raise RuntimeError("Twilio not configured: missing account credentials")
    if not (settings.TWILIO_MESSAGING_SERVICE_SID or settings.TWILIO_FROM_NUMBER):
        raise RuntimeError("Twilio not configured: provide TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER")

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    # Prefer Messaging Service for A2P 10DLC compliance; fallback to direct From number
    if settings.TWILIO_MESSAGING_SERVICE_SID:
        data = {"To": to_e164, "Body": body, "MessagingServiceSid": settings.TWILIO_MESSAGING_SERVICE_SID}
    else:
        data = {"To": to_e164, "From": settings.TWILIO_FROM_NUMBER, "Body": body}
    if media_url:
        data["MediaUrl"] = media_url
    with httpx.Client(timeout=10.0) as client:
        r = client.post(url, data=data, auth=auth)
        content = None
        try:
            content = r.json()
        except Exception:
            content = {"raw_text": r.text}
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as he:
            detail = {
                "status_code": r.status_code,
                "response": content,
            }
            raise RuntimeError(f"Twilio API error: {detail}") from he
        return {"provider": "twilio", "status_code": r.status_code, "data": content}

def _send_twilio_whatsapp(to_e164: str, body: str) -> dict:
    """Send message via Twilio WhatsApp channel.
    Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM configured.
    """
    if not (settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN):
        raise RuntimeError("Twilio not configured: missing account credentials")
    if not settings.TWILIO_WHATSAPP_FROM:
        raise RuntimeError("Twilio WhatsApp not configured: set TWILIO_WHATSAPP_FROM")

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    data = {
        "To": f"whatsapp:{to_e164}",
        "From": f"whatsapp:{settings.TWILIO_WHATSAPP_FROM}",
        "Body": body,
    }
    with httpx.Client(timeout=10.0) as client:
        r = client.post(url, data=data, auth=auth)
        try:
            content = r.json()
        except Exception:
            content = {"raw_text": r.text}
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as he:
            detail = {"status_code": r.status_code, "response": content}
            raise RuntimeError(f"Twilio WhatsApp API error: {detail}") from he
        return {"provider": "twilio-whatsapp", "status_code": r.status_code, "data": content}

def send_sms(to_e164: str, body: str, *, media_url: Optional[str] = None) -> dict:
    """Send an SMS using the first available provider.
    Preference order: Twilio SMS → Telnyx → dev no-op.
    """
    twilio_err = None
    telnyx_err = None

    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
        if (getattr(settings, "TWILIO_MESSAGING_SERVICE_SID", None) or settings.TWILIO_FROM_NUMBER):
            try:
                return _send_twilio_sms(to_e164, body, media_url=media_url)
            except Exception as e:
                twilio_err = str(e)
                print(f"[WARN] Twilio SMS failed: {twilio_err}")

    if settings.TELNYX_API_KEY and (settings.TELNYX_MESSAGING_FROM_NUMBER or settings.TELNYX_MESSAGING_PROFILE_ID):
        try:
            return _send_telnyx_sms(to_e164, body, media_url=media_url)
        except Exception as e:
            telnyx_err = str(e)
            print(f"[WARN] Telnyx SMS failed: {telnyx_err}")

    print(f"[DEV] SMS to {to_e164}: {body} (media={media_url})")
    return {
        "provider": "dev-noop",
        "status_code": 200,
        "data": {"ok": True, "dev": True},
        "errors": {"telnyx": telnyx_err, "twilio_sms": twilio_err}
    }
