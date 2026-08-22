# app/storage.py
import os
import time
import mimetypes
from pathlib import Path

# Read config from env; if S3_BUCKET is missing, we run in "local dev" mode
_BUCKET = os.getenv("S3_BUCKET") or os.getenv("S3_BUCKET_NAME")
_REGION = os.getenv("AWS_REGION", "us-east-2")
_BASE_URL = os.getenv("BASE_URL", "").rstrip("/")

USE_S3 = bool(_BUCKET)  # ✅ fixed here

if USE_S3:
    # Only import boto3 when actually using S3
    import boto3
    _s3 = boto3.client("s3", region_name=_REGION)

def _guess_content_type(filename: str, default: str = "image/jpeg") -> str:
    ctype, _ = mimetypes.guess_type(filename or "")
    return ctype or default

def upload_photo(content: bytes, key_prefix: str, filename: str = "photo.jpg") -> str | None:
    """
    Upload a photo and return a public URL.

    - If S3 is configured: upload to S3 and return the S3 URL.
    - If S3 is NOT configured: save to app/static/dev_uploads and return a local URL
      (served by FastAPI's StaticFiles mount at /static). If BASE_URL is set, we return
      an absolute URL; otherwise we return a relative path.
    """
    ts = int(time.time())
    ext = (os.path.splitext(filename)[1] or ".jpg").lower()
    safe_prefix = (key_prefix or "unknown").strip().replace("/", "_")
    key = f"checkins/{safe_prefix}/{ts}{ext}"

    if USE_S3:
        _s3.put_object(
            Bucket=_BUCKET,
            Key=key,
            Body=content,
            ContentType=_guess_content_type(filename),
        )
        return f"https://{_BUCKET}.s3.{_REGION}.amazonaws.com/{key}"

    # ---- Local dev fallback (no S3) ----
    local_dir = Path(__file__).resolve().parent / "static" / "dev_uploads" / "checkins" / safe_prefix
    local_dir.mkdir(parents=True, exist_ok=True)
    local_path = local_dir / f"{ts}{ext}"
    try:
        with open(local_path, "wb") as f:
            f.write(content)
    except Exception:
        # If something goes wrong writing locally, just return None (optional photo)
        return None

    # Build a URL under /static that FastAPI already serves
    relative_url = f"/static/dev_uploads/checkins/{safe_prefix}/{ts}{ext}"
    return f"{_BASE_URL}{relative_url}" if _BASE_URL else relative_url