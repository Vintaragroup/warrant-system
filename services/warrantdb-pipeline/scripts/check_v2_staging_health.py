"""
scripts/check_v2_staging_health.py
───────────────────────────────────────────────────────────────────────────────
Health check for v2 staging collections.

Reports per collection:
  • document count
  • latest ingested_at timestamp
  • whether data is stale based on expected cadence
  • last scrape_audit entry (if available)

Exit codes
──────────
  0  all collections healthy (or --dry-run)
  1  one or more collections are stale or have no documents
  2  MongoDB connection failed

Usage
─────
  # Dry-run — show what would be checked, no MongoDB connection
  PYTHONPATH=$PWD python3 scripts/check_v2_staging_health.py --dry-run

  # Live check
  PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
    python3 scripts/check_v2_staging_health.py

  # Verbose — include last audit entry per source
  PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb \
    python3 scripts/check_v2_staging_health.py --verbose
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple


# ── Collection definitions ─────────────────────────────────────────────────────

# (collection_name, expected_source, stale_after_hours)
# stale_after_hours=None means no staleness check for that collection.
_COLLECTIONS: List[Tuple[str, Optional[str], Optional[int]]] = [
    ("v2_galveston_events",       "galveston_p2c",         1),     # 15-min interval; stale if > 1h
    ("v2_harris_reports",         "harris_district_clerk", 36),    # nightly at 01:30 CT; stale if > 36h
    ("v2_lookup_results",         None,                    12),    # jefferson 3x/day; stale if > 12h
    ("v2_report_manifest",        "harris_district_clerk", 36),    # follows harris cadence
    ("v2_galveston_p2c_endpoint", None,                    None),  # endpoint cache; rarely changes
]

_AUDIT_COLLECTION = "scrape_audit"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _age_str(dt: Optional[datetime]) -> str:
    if dt is None:
        return "never"
    delta = _utcnow() - dt
    h = int(delta.total_seconds() // 3600)
    m = int((delta.total_seconds() % 3600) // 60)
    if h >= 24:
        return f"{h // 24}d {h % 24}h ago"
    if h > 0:
        return f"{h}h {m}m ago"
    return f"{m}m ago"


def _status_symbol(ok: bool) -> str:
    return "OK  " if ok else "WARN"


# ── Per-collection check ────────────────────────────────────────────────────────

def _check_collection(
    db,
    collection_name: str,
    expected_source: Optional[str],
    stale_hours: Optional[int],
    verbose: bool,
) -> Dict[str, Any]:
    coll = db[collection_name]

    count = coll.count_documents({})

    # Latest ingested_at
    latest_doc = coll.find_one(
        {"ingested_at": {"$exists": True}},
        sort=[("ingested_at", -1)],
        projection={"ingested_at": 1, "county": 1, "source": 1, "scraped_at": 1},
    )
    latest_ingested_at_str: Optional[str] = (
        latest_doc.get("ingested_at") if latest_doc else None
    )
    latest_dt = _parse_iso(latest_ingested_at_str)

    # Staleness check
    stale = False
    stale_reason = ""
    if count == 0:
        stale = True
        stale_reason = "no documents"
    elif stale_hours is not None and latest_dt is not None:
        age_h = (_utcnow() - latest_dt).total_seconds() / 3600
        if age_h > stale_hours:
            stale = True
            stale_reason = f"latest doc is {age_h:.1f}h old (threshold {stale_hours}h)"

    result: Dict[str, Any] = {
        "collection": collection_name,
        "count": count,
        "latest_ingested_at": latest_ingested_at_str,
        "latest_dt": latest_dt,
        "stale": stale,
        "stale_reason": stale_reason,
    }

    # Last audit entry for this source (verbose only)
    if verbose and expected_source:
        audit_doc = db[_AUDIT_COLLECTION].find_one(
            {"county": expected_source.split("_")[0]},
            sort=[("started_at", -1)],
            projection={"county": 1, "event": 1, "started_at": 1, "note": 1, "errors": 1},
        )
        if audit_doc:
            audit_doc.pop("_id", None)
        result["last_audit"] = audit_doc

    return result


# ── Formatting ─────────────────────────────────────────────────────────────────

def _print_result(r: Dict[str, Any], verbose: bool) -> None:
    sym = _status_symbol(not r["stale"])
    age = _age_str(r["latest_dt"])
    count_str = f"{r['count']:>7,}"

    print(f"  [{sym}] {r['collection']:<35}  docs={count_str}  latest={age}")

    if r["stale"] and r["stale_reason"]:
        print(f"          ↳ STALE: {r['stale_reason']}")

    if verbose:
        audit = r.get("last_audit")
        if audit:
            print(f"          ↳ last audit: event={audit.get('event')}  "
                  f"started={audit.get('started_at', 'n/a')}  "
                  f"errors={audit.get('errors', 0)}")
            if audit.get("note"):
                print(f"            note: {audit['note']}")
        elif r.get("last_audit") is None and r["count"] > 0:
            print("          ↳ no audit record found for this source")


# ── Main ────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Health check for v2 staging collections",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be checked without connecting to MongoDB",
    )
    ap.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Include last audit entry per source",
    )
    args = ap.parse_args()

    now_str = _utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[v2-health] check at {now_str}")

    if args.dry_run:
        print("[v2-health] DRY RUN — no MongoDB connection")
        print()
        print("Collections that would be checked:")
        for coll_name, source, stale_h in _COLLECTIONS:
            cadence = f"stale after {stale_h}h" if stale_h else "no cadence check"
            print(f"  {coll_name:<35}  source={source or 'n/a':<30}  {cadence}")
        print()
        print("Pass MONGO_URI and MONGO_DB to run a live check.")
        return 0

    # Connect
    mongo_uri = os.getenv("MONGO_URI")
    if not mongo_uri:
        try:
            from pathlib import Path
            env_path = Path(__file__).resolve().parents[1] / ".env"
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        os.environ.setdefault(k.strip(), v.strip())
            mongo_uri = os.getenv("MONGO_URI")
        except Exception:
            pass

    if not mongo_uri:
        print(
            "[v2-health] ERROR: MONGO_URI not set.\n"
            "  Set MONGO_URI=... or use --dry-run.",
            file=sys.stderr,
        )
        return 2

    try:
        from storage.mongo_client import get_db  # noqa: PLC0415
        db = get_db()
    except Exception as exc:
        print(f"[v2-health] ERROR: MongoDB connection failed: {exc}", file=sys.stderr)
        return 2

    print()
    stale_count = 0
    for coll_name, source, stale_h in _COLLECTIONS:
        result = _check_collection(db, coll_name, source, stale_h, args.verbose)
        _print_result(result, args.verbose)
        if result["stale"]:
            stale_count += 1

    print()
    if stale_count == 0:
        print(f"[v2-health] ALL OK — {len(_COLLECTIONS)} collections checked")
        return 0
    else:
        print(
            f"[v2-health] {stale_count}/{len(_COLLECTIONS)} collection(s) STALE or empty",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
