"""
scheduler/config.py
──────────────────────────────────────────────────────────────────────────────
Mongo-backed scheduler configuration for v2 ingestion sources.

Each source has one document in the `admin_config` collection.
This module provides helpers to read, write, and seed default configs.

All defaults are safe: every source starts disabled and in dry-run mode.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# ── Constants ─────────────────────────────────────────────────────────────────

SUPPORTED_SOURCES = [
    "galveston",
    "harris_reports",
    "fortbend_lookup",
    "jefferson_lookup",
    "brazoria_lookup",
]

_COLLECTION = "admin_config"

# ── Default configs ───────────────────────────────────────────────────────────
# All sources start with enabled=False and dry_run_default=True.
# Callers must explicitly enable and opt out of dry-run when ready.

DEFAULT_SOURCE_CONFIGS: Dict[str, Dict[str, Any]] = {
    "galveston": {
        "type": "ingestion_source",
        "source": "galveston",
        "enabled": True,
        "mode": "staging",
        "dry_run_default": False,
        "schedule": {
            "strategy": "interval",
            "interval_minutes": 15,
            "run_times": [],
            "timezone": "America/Chicago",
            "skip_weekends": False,
            "max_runs_per_day": 64,
            "allowed_days": [1, 2, 3, 4, 5, 6, 7],
        },
        "limits": {
            "default_limit": 250,
            "max_limit": 500,
        },
        "read_flags": {
            "use_galveston_v2_reads": False,
        },
        "updated_at": None,
        "updated_by": "system",
    },
    "harris_reports": {
        "type": "ingestion_source",
        "source": "harris_reports",
        "enabled": True,
        "mode": "staging",
        "dry_run_default": False,
        "schedule": {
            "strategy": "run_times",
            "interval_minutes": None,
            "run_times": ["01:30"],
            "timezone": "America/Chicago",
            "skip_weekends": False,
            "max_runs_per_day": 1,
            "allowed_days": [1, 2, 3, 4, 5, 6, 7],
        },
        "limits": {
            "default_limit": 4,
            "max_limit": 4,
        },
        "read_flags": {},
        "updated_at": None,
        "updated_by": "system",
    },
    "fortbend_lookup": {
        "type": "ingestion_source",
        "source": "fortbend_lookup",
        "enabled": False,
        "mode": "staging",
        "dry_run_default": True,
        "schedule": {
            # strategy=manual: only runs when explicitly triggered via CLI or Admin UI.
            # Do NOT add to Render cron until a confirmed staging write succeeds.
            "strategy": "manual",
            "interval_minutes": None,
            "run_times": [],
            "timezone": "America/Chicago",
            "skip_weekends": False,
            "max_runs_per_day": 0,
            "allowed_days": [1, 2, 3, 4, 5, 6, 7],
        },
        "limits": {
            "default_limit": 10,
            "max_limit": 50,
        },
        "read_flags": {},
        "updated_at": None,
        "updated_by": "system",
    },
    "jefferson_lookup": {
        "type": "ingestion_source",
        "source": "jefferson_lookup",
        "enabled": True,
        "mode": "staging",
        "dry_run_default": False,
        "schedule": {
            "strategy": "run_times",
            "interval_minutes": None,
            "run_times": ["06:15", "12:15", "18:15"],
            "timezone": "America/Chicago",
            "skip_weekends": False,
            "max_runs_per_day": 3,
            "allowed_days": [1, 2, 3, 4, 5, 6, 7],
        },
        "limits": {
            "default_limit": 100,
            "max_limit": 250,
        },
        # default_args: resolved automatically when --respect-schedule is active.
        # booking_date="today" resolves to current CT date (America/Chicago).
        "default_args": {
            "booking_date": "today",
        },
        "read_flags": {},
        "updated_at": None,
        "updated_by": "system",
    },
    "brazoria_lookup": {
        "type": "ingestion_source",
        "source": "brazoria_lookup",
        # Disabled: keep commented out of Render cron until a successful staging
        # write is confirmed outside the local network.
        "enabled": False,
        "mode": "staging",
        "dry_run_default": False,
        "schedule": {
            "strategy": "run_times",
            "interval_minutes": None,
            "run_times": ["07:00", "19:00"],
            "timezone": "America/Chicago",
            "skip_weekends": False,
            "max_runs_per_day": 2,
            "allowed_days": [1, 2, 3, 4, 5, 6, 7],
        },
        "limits": {
            "default_limit": 100,
            "max_limit": 250,
        },
        "default_args": {
            "booking_date": "today",
        },
        "read_flags": {},
        "updated_at": None,
        "updated_by": "system",
    },
}


# ── Public API ────────────────────────────────────────────────────────────────

def get_source_config(db, source: str) -> Optional[Dict[str, Any]]:
    """
    Load config for `source` from admin_config collection.
    Falls back to DEFAULT_SOURCE_CONFIGS if the document is missing.
    Returns None only if `source` is not in SUPPORTED_SOURCES.
    """
    if source not in SUPPORTED_SOURCES:
        return None
    doc = db[_COLLECTION].find_one(
        {"type": "ingestion_source", "source": source},
        {"_id": 0},
    )
    if doc:
        return doc
    # Return a deep copy so callers can mutate freely without side effects
    return copy.deepcopy(DEFAULT_SOURCE_CONFIGS[source])


def upsert_source_config(
    db,
    source: str,
    patch: Dict[str, Any],
    updated_by: str = "system",
) -> Dict[str, Any]:
    """
    Merge `patch` into the existing config for `source` and persist.

    Uses MongoDB $set with dot-path expansion so nested sub-fields are merged
    rather than replaced.  Returns the full updated config after write.

    Raises ValueError for unknown sources.
    """
    if source not in SUPPORTED_SOURCES:
        raise ValueError(f"Unknown source: {source!r}")

    now = datetime.now(timezone.utc).isoformat()

    # Flatten nested patch dict into dot-notation keys for precise $set
    flat = _flatten_dict(patch)
    flat["updated_at"] = now
    flat["updated_by"] = updated_by
    flat["type"] = "ingestion_source"
    flat["source"] = source

    db[_COLLECTION].update_one(
        {"type": "ingestion_source", "source": source},
        {"$set": flat},
        upsert=True,
    )
    return get_source_config(db, source)


def ensure_default_configs(db) -> None:
    """
    Seed admin_config documents for all supported sources that don't yet exist.
    Safe to call on every startup — never overwrites existing documents.
    """
    for source, defaults in DEFAULT_SOURCE_CONFIGS.items():
        existing = db[_COLLECTION].find_one(
            {"type": "ingestion_source", "source": source},
        )
        if not existing:
            now = datetime.now(timezone.utc).isoformat()
            doc = copy.deepcopy(defaults)
            doc["updated_at"] = now
            db[_COLLECTION].insert_one(doc)
            print(f"[scheduler.config] Seeded default config for source={source}")


# ── Private helpers ───────────────────────────────────────────────────────────

def _flatten_dict(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """Flatten a nested dict to dot-notation keys suitable for MongoDB $set."""
    out: Dict[str, Any] = {}
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(_flatten_dict(v, prefix=full_key))
        else:
            out[full_key] = v
    return out
