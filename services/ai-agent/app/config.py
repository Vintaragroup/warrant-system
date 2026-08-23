# app/config.py
from typing import Optional, Literal
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Base
    APP_ENV: str = "dev"
    SECRET_KEY: str                         # REQUIRED
    BASE_URL: str                           # REQUIRED (e.g., https://yourservice.onrender.com)

    # MongoDB
    MONGO_URI: str                          # REQUIRED
    MONGO_DB: str                           # REQUIRED

    # AWS S3 (optional; safe to leave unset if you're not uploading images)
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: str = "us-east-2"
    S3_BUCKET: Optional[str] = None

    # Twilio (optional; used if Telnyx Messaging is not configured)
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_FROM_NUMBER: Optional[str] = None
    # Optional: prefer sending via a Twilio Messaging Service for A2P 10DLC
    TWILIO_MESSAGING_SERVICE_SID: Optional[str] = None
    # Optional: enable WhatsApp sending via Twilio
    # When enabled, messages will be sent using the WhatsApp channel instead of SMS.
    # Requires a WhatsApp-enabled sender (sandbox or business number) in E.164 without prefix.
    TWILIO_USE_WHATSAPP: bool = False
    TWILIO_WHATSAPP_FROM: Optional[str] = None

    # Telnyx Messaging (preferred for notify_agent SMS)
    # Provide either a dedicated sending number (recommended) OR a messaging profile ID.
    # API key must be set for either mode.
    TELNYX_API_KEY: Optional[str] = None
    TELNYX_MESSAGING_FROM_NUMBER: Optional[str] = None
    TELNYX_MESSAGING_PROFILE_ID: Optional[str] = None

    # Telnyx tool token (required for your webhooks)
    TELNYX_TOOL_TOKEN: str                  # REQUIRED
    # Optional shared secret for Telnyx webhooks (X-Telnyx-Secret header)
    TELNYX_WEBHOOK_SECRET: Optional[str] = None

    # On-call roster (optional)
    # JSON mapping of agent display names to phone and optional aliases, e.g.:
    # {
    #   "Alex": {"phone": "+17135550111", "aliases": ["Alejandro", "Alexander"]},
    #   "Maria": {"phone": "+17135550112"}
    # }
    ONCALL_AGENTS_JSON: Optional[str] = None

    # Optional: County → office phone routing
    # Provide JSON like: {"harris":"+18324101662","brazoria":"+18325550123"}
    OFFICE_ROUTES_JSON: Optional[str] = None
    # Optional: Fallback transfer number if county not mapped
    DEFAULT_OFFICE_NUMBER: Optional[str] = None
    # Optional: Static list of transfer targets (overrides schedule/routing when set)
    STATIC_TRANSFER_NUMBERS_JSON: Optional[str] = None

    # Optional: Outbound caller ID for transfer/warm-transfer calls
    # If not set, providers may use DEFAULT_OFFICE_NUMBER when placing outbound calls.
    OFFICE_CALLER_ID: Optional[str] = None

    # Optional: Time-aware office schedules per county
    # JSON format example:
    # {
    #   "harris": [
    #     {"days":["mon","tue","wed","thu","fri"],"start":"08:00","end":"18:00","numbers":["+18324100001","+18324100002"]},
    #     {"days":["mon","tue","wed","thu","fri"],"start":"18:00","end":"23:59","numbers":["+17130001111","+17130002222"]},
    #     {"days":["sat","sun"],"start":"00:00","end":"23:59","numbers":["+17130003333","+17130004444"]}
    #   ],
    #   "default": [
    #     {"days":["mon","tue","wed","thu","fri","sat","sun"],"start":"00:00","end":"23:59","numbers":["+18325550000"]}
    #   ]
    # }
    OFFICES_SCHEDULE_JSON: Optional[str] = None
    # Application timezone used to evaluate schedules (IANA tz database name)
    APP_TZ: str = "America/Chicago"
    # Suggested per-number attempt timeout (seconds) for the agent UI
    DIAL_ATTEMPT_TIMEOUT_SEC: int = 20

    # Optional: Hold music URL (MP3/PCM/Opus). Served to callers during warm transfer.
    # Provide a publicly accessible HTTPS URL, e.g., from S3 or /static/hold/music.mp3
    HOLD_MUSIC_URL: Optional[str] = None

    # Optional: DTMF digits used by agents to accept/decline the warm transfer
    TRANSFER_ACCEPT_DIGIT: str = "1"
    TRANSFER_DECLINE_DIGIT: str = "2"

    # IP geolocation (optional)
    IP_GEO_PROVIDER: Literal["ipinfo", "ipapi", "none"] = "none"
    IP_GEO_TOKEN: Optional[str] = None

    # Optional: build/commit identifier for deployment visibility
    BUILD_SHA: Optional[str] = None

    class Config:
        env_file = ".env"

settings = Settings()
