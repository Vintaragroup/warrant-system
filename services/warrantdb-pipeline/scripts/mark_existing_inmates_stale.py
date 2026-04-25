"""
mark_existing_inmates_stale.py — One-time migration: suppress historical backlog.

Marks all inmates in inmate_enrichment.inmates that are NOT in a protected
enrichment state (ENRICHED, COMPLETE, COMPLETED, FAILED, ERROR) as STALE,
preventing them from being picked up by the enrichment worker.

This implements the 72-hour rolling window policy retroactively: any record
that was inserted before this policy existed is considered pre-policy backlog
and must be suppressed.

Usage:
    python -m scripts.mark_existing_inmates_stale          # dry-run (default)
    python -m scripts.mark_existing_inmates_stale --apply  # write changes

Environment:
    ENRICHMENT_MONGO_URI            Enrichment MongoDB URI (falls back to MONGO_URI)
    ENRICHMENT_MONGO_DB             Enrichment database name (default: inmate_enrichment)
    ENRICHMENT_SUBJECTS_COLLECTION  Target collection name (default: inmates)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

# ---------------------------------------------------------------------------
# Environment bootstrap
# ---------------------------------------------------------------------------

_ROOT_DOTENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ROOT_DOTENV)

_ENRICHMENT_MONGO_URI: str = (
    os.getenv("ENRICHMENT_MONGO_URI")
    or os.getenv("MONGO_URI", "mongodb://localhost:27017")
)
ENRICHMENT_MONGO_DB: str = os.getenv("ENRICHMENT_MONGO_DB", "inmate_enrichment")
ENRICHMENT_SUBJECTS_COLLECTION: str = os.getenv("ENRICHMENT_SUBJECTS_COLLECTION", "inmates")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROTECTED_STATUSES = ["ENRICHED", "COMPLETE", "COMPLETED", "FAILED", "ERROR"]

# Filter: records eligible to be marked stale (not already in a final state)
_STALE_FILTER = {"enrichment_status": {"$nin": PROTECTED_STATUSES}}

# Update: set stale markers
_STALE_UPDATE = {
    "$set": {
        "enrichment_status": "STALE",
        "enrichment_flag": False,
        "stale_reason": "preexisting_backlog_before_72_hour_policy",
    }
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(apply: bool) -> int:
    """Mark pre-existing inmates as STALE. Returns 0 on success, 1 on error."""
    mode = "APPLY" if apply else "DRY RUN"
    print(f"=== MARK EXISTING INMATES STALE — {mode} ===")
    print(f"target: {ENRICHMENT_MONGO_DB}.{ENRICHMENT_SUBJECTS_COLLECTION}")
    print(f"filter: enrichment_status NOT IN {PROTECTED_STATUSES}")
    print()

    try:
        client = MongoClient(_ENRICHMENT_MONGO_URI)
        col = client[ENRICHMENT_MONGO_DB][ENRICHMENT_SUBJECTS_COLLECTION]

        matched = col.count_documents(_STALE_FILTER)
        print(f"matched_count: {matched}")

        if not apply:
            print("modified_count: (dry-run — no writes performed)")
            print()
            print("Pass --apply to write changes.")
            return 0

        result = col.update_many(_STALE_FILTER, _STALE_UPDATE)
        print(f"modified_count: {result.modified_count}")
        return 0

    except PyMongoError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        try:
            client.close()  # type: ignore[possibly-undefined]
        except Exception:
            pass


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mark_existing_inmates_stale",
        description=(
            "One-time migration: mark pre-existing inmates as STALE to enforce "
            "the 72-hour rolling enrichment window policy."
        ),
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes to MongoDB. Without this flag, runs in dry-run mode.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    raise SystemExit(run(apply=args.apply))
