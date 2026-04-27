"""
scheduler/audit.py
──────────────────────────────────────────────────────────────────────────────
Creates and updates ingestion_runs documents for per-run audit trail.

SECURITY: Never store secrets, MONGO_URI, env vars, or credentials in any
field.  All text captures are truncated to prevent unbounded document growth.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_COLLECTION = "ingestion_runs"
_STDOUT_TAIL_CHARS = 4000
_STDERR_TAIL_CHARS = 4000
_ERROR_TAIL_CHARS = 2000

# Patterns to redact from any stored text
_REDACT_PATTERNS = [
    (re.compile(r"mongodb\+srv://[^\s@]+@\S+", re.I), "mongodb+srv://[REDACTED]"),
    (re.compile(r"mongodb://[^\s@]+@\S+", re.I), "mongodb://[REDACTED]"),
    (
        re.compile(
            r"(MONGO_URI|MONGO_URL|DATABASE_URL|API_KEY|SECRET|PASSWORD|TOKEN)"
            r"=\S+",
            re.I,
        ),
        r"\1=[REDACTED]",
    ),
]


# ── Public API ────────────────────────────────────────────────────────────────

def create_run(
    db,
    source: str,
    trigger: str,
    mode: str,
    dry_run: bool,
    created_by: str = "system",
    command: Optional[str] = None,
) -> str:
    """
    Insert a new ingestion_runs document with status="running".
    Returns the run_id string.

    `command` should be a safe representation of the command with no secrets.
    It will be additionally redacted before storage.
    """
    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "run_id": run_id,
        "source": source,
        "trigger": trigger,
        "mode": mode,
        "dry_run": dry_run,
        "started_at": now,
        "completed_at": None,
        "duration_ms": None,
        "status": "running",
        "skip_reason": None,
        "records_seen": 0,
        "records_written": 0,
        "records_failed": 0,
        "command": _redact(command) if command else None,
        "stdout_tail": None,
        "stderr_tail": None,
        "error": None,
        "created_by": created_by,
    }
    db[_COLLECTION].insert_one(doc)
    return run_id


def finish_run(
    db,
    run_id: str,
    status: str,
    records_seen: int = 0,
    records_written: int = 0,
    records_failed: int = 0,
    stdout_tail: Optional[str] = None,
    stderr_tail: Optional[str] = None,
    error: Optional[str] = None,
    skip_reason: Optional[str] = None,
) -> None:
    """
    Update an existing ingestion_runs document with final status and metrics.
    All text fields are redacted and truncated before storage.
    """
    existing = db[_COLLECTION].find_one(
        {"run_id": run_id},
        {"started_at": 1},
    )
    duration_ms = None
    if existing:
        started_at = _parse_ts(existing.get("started_at"))
        if started_at:
            now = datetime.now(timezone.utc)
            duration_ms = int((now - started_at).total_seconds() * 1000)

    now_iso = datetime.now(timezone.utc).isoformat()
    db[_COLLECTION].update_one(
        {"run_id": run_id},
        {"$set": {
            "completed_at": now_iso,
            "duration_ms": duration_ms,
            "status": status,
            "skip_reason": skip_reason,
            "records_seen": records_seen,
            "records_written": records_written,
            "records_failed": records_failed,
            "stdout_tail": _truncate(_redact(stdout_tail), _STDOUT_TAIL_CHARS),
            "stderr_tail": _truncate(_redact(stderr_tail), _STDERR_TAIL_CHARS),
            "error": _truncate(_redact(error), _ERROR_TAIL_CHARS),
        }},
    )


def list_runs(
    db,
    source: Optional[str] = None,
    limit: int = 100,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Return recent ingestion_runs sorted newest-first."""
    query: Dict[str, Any] = {}
    if source:
        query["source"] = source
    if status:
        query["status"] = status
    cursor = (
        db[_COLLECTION]
        .find(query, {"_id": 0})
        .sort("started_at", -1)
        .limit(min(limit, 200))
    )
    return list(cursor)


def get_source_status(db, source: str) -> Dict[str, Any]:
    """
    Return a summary dict for a single source with:
      last_run, last_success, last_error
    """
    def _latest(extra_filter: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        q = {"source": source, **extra_filter}
        doc = db[_COLLECTION].find_one(
            q,
            {"_id": 0},
            sort=[("started_at", -1)],
        )
        return doc

    return {
        "source": source,
        "last_run": _latest({}),
        "last_success": _latest({"status": "success"}),
        "last_error": _latest({"status": "failed"}),
    }


# ── Private helpers ───────────────────────────────────────────────────────────

def _redact(text: Optional[str]) -> Optional[str]:
    """Apply secret-stripping patterns to a string. Returns None unchanged."""
    if not text:
        return text
    for pattern, replacement in _REDACT_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def _truncate(text: Optional[str], max_chars: int) -> Optional[str]:
    """Keep the last max_chars characters of text, prefixed with a truncation note."""
    if not text:
        return text
    if len(text) <= max_chars:
        return text
    return "...[truncated]\n" + text[-max_chars:]


def _parse_ts(ts) -> Optional[datetime]:
    """Parse an ISO string or datetime to a timezone-aware datetime."""
    if ts is None:
        return None
    try:
        if isinstance(ts, str):
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if isinstance(ts, datetime):
            return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except Exception:
        return None
    return None
