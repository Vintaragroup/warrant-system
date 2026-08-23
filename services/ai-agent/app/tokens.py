from __future__ import annotations
import time
import jwt
from .config import settings

ALG = "HS256"

def make_one_time_token(person_id: str, case_id: str, ttl_seconds: int = 1800) -> str:
    now = int(time.time())
    payload = {
        "iss": "rapid_locate",
        "sub": person_id,
        "case": case_id,
        "iat": now,
        "exp": now + ttl_seconds
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALG)

def verify_token(tok: str) -> dict:
    return jwt.decode(tok, settings.SECRET_KEY, algorithms=[ALG])
