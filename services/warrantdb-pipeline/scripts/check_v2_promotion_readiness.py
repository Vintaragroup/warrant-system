"""
scripts/check_v2_promotion_readiness.py
───────────────────────────────────────────────────────────────────────────────
Evaluates whether each v2 staging source is ready to promote to production.

Per-source checks
─────────────────
  galveston        ≥3 days observed, success_rate ≥95%, latest_success <1h,
                   avg_records_written >0, no duplicate explosion
  harris_reports   ≥3 daily successes, success_rate ≥95%, latest_success <36h
  jefferson_lookup ≥3 days date-mode runs, success_rate ≥90%, latest <12h
  brazoria_lookup  always "watch" unless explicitly enabled
  fortbend_lookup  always "manual-only"

Global gate
───────────
  Required sources (galveston, harris_reports, jefferson_lookup) must all be
  "ready".  Any "blocked" source → overall "blocked".

Readiness values
────────────────
  ready        Meets all thresholds — safe to consider promotion
  watch        Marginal — more observation needed
  blocked      Hard failure condition detected
  manual-only  Source is not scheduled for continuous ingestion

Exit codes
──────────
  0  overall ready_to_promote
  1  watch or blocked
  2  MongoDB connection failed

Usage
─────
  # Human-readable summary
  PYTHONPATH=$PWD python3 scripts/check_v2_promotion_readiness.py --days 3

  # JSON output (for API integration)
  PYTHONPATH=$PWD python3 scripts/check_v2_promotion_readiness.py --days 3 --json

  # Dry-run — no MongoDB connection
  PYTHONPATH=$PWD python3 scripts/check_v2_promotion_readiness.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional


# ── Source definitions ────────────────────────────────────────────────────────

REQUIRED_SOURCES = {"galveston", "harris_reports", "jefferson_lookup"}

# (source_name, stale_threshold_hours, min_success_rate, min_days_observed)
_SOURCE_RULES: Dict[str, Dict[str, Any]] = {
    "galveston": {
        "stale_hours": 1,
        "min_success_rate": 0.95,
        "min_days_observed": 3,
        "required": True,
    },
    "harris_reports": {
        "stale_hours": 36,
        "min_success_rate": 0.95,
        "min_days_observed": 3,
        "required": True,
    },
    "jefferson_lookup": {
        "stale_hours": 12,
        "min_success_rate": 0.90,
        "min_days_observed": 3,
        "required": True,
    },
    "brazoria_lookup": {
        "stale_hours": 12,
        "min_success_rate": 0.90,
        "min_days_observed": 3,
        "required": False,
        "always_watch": True,
    },
    "fortbend_lookup": {
        "stale_hours": None,
        "min_success_rate": None,
        "min_days_observed": None,
        "required": False,
        "manual_only": True,
    },
}

_INGESTION_RUNS_COLLECTION = "ingestion_runs"
_DUP_WARNING_THRESHOLD = 50  # total duplicate_key_warnings in window → blocked


# ── Helpers ───────────────────────────────────────────────────────────────────

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


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.isoformat()


# ── Per-source evaluation ─────────────────────────────────────────────────────

def _evaluate_source(
    db,
    source: str,
    rules: Dict[str, Any],
    since: datetime,
) -> Dict[str, Any]:
    """Query ingestion_runs and compute readiness metrics for one source."""

    # Short-circuit for manual-only sources
    if rules.get("manual_only"):
        return {
            "source": source,
            "readiness": "manual-only",
            "blockers": ["source is manual-only — not scheduled for continuous ingestion"],
            "total_runs": 0,
            "success_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "success_rate": None,
            "days_observed": 0,
            "latest_success": None,
            "latest_failure": None,
            "stale": None,
            "stale_reason": None,
            "avg_records_written": None,
            "min_records_written": None,
            "max_records_written": None,
            "duplicate_key_warnings_total": None,
            "required_field_missing_count_total": None,
        }

    coll = db[_INGESTION_RUNS_COLLECTION]
    since_iso = since.isoformat()

    # All runs in the observation window for this source (exclude dry-runs for metrics)
    all_runs = list(
        coll.find(
            {"source": source, "started_at": {"$gte": since_iso}, "dry_run": False},
            {
                "_id": 0,
                "run_id": 1,
                "status": 1,
                "started_at": 1,
                "records_written": 1,
                "duplicate_key_warnings": 1,
                "required_field_missing_count": 1,
            },
        ).sort("started_at", -1)
    )

    total_runs = len(all_runs)
    success_runs = [r for r in all_runs if r.get("status") == "success"]
    failed_runs = [r for r in all_runs if r.get("status") == "failed"]
    skipped_runs = [r for r in all_runs if r.get("status") == "skipped"]

    success_count = len(success_runs)
    failed_count = len(failed_runs)
    skipped_count = len(skipped_runs)

    success_rate = (success_count / total_runs) if total_runs > 0 else 0.0

    # Latest timestamps
    latest_success_dt: Optional[datetime] = None
    latest_failure_dt: Optional[datetime] = None

    if success_runs:
        latest_success_dt = _parse_iso(success_runs[0].get("started_at"))
    if failed_runs:
        latest_failure_dt = _parse_iso(failed_runs[0].get("started_at"))

    # Days with at least one success
    success_days: set = set()
    for r in success_runs:
        dt = _parse_iso(r.get("started_at"))
        if dt:
            success_days.add(dt.date())
    days_observed = len(success_days)

    # Record write stats from successful runs
    written_values = [
        r.get("records_written", 0) or 0
        for r in success_runs
        if r.get("records_written") is not None
    ]
    avg_records_written = (sum(written_values) / len(written_values)) if written_values else None
    min_records_written = min(written_values) if written_values else None
    max_records_written = max(written_values) if written_values else None

    # Duplicate key warnings across all runs
    dup_warnings_total = sum(
        r.get("duplicate_key_warnings") or 0 for r in all_runs
    )
    missing_fields_total = sum(
        r.get("required_field_missing_count") or 0 for r in all_runs
    )

    # Staleness
    stale = False
    stale_reason: Optional[str] = None
    stale_hours = rules.get("stale_hours")
    if stale_hours is not None:
        if latest_success_dt is None:
            stale = True
            stale_reason = "no successful run in observation window"
        else:
            age_h = (_utcnow() - latest_success_dt).total_seconds() / 3600
            if age_h > stale_hours:
                stale = True
                stale_reason = f"latest success is {age_h:.1f}h old (threshold {stale_hours}h)"

    # ── Readiness determination ───────────────────────────────────────────────

    blockers: List[str] = []
    warnings: List[str] = []

    if rules.get("always_watch"):
        return {
            "source": source,
            "readiness": "watch",
            "blockers": ["source is disabled/optional — enable explicitly to evaluate"],
            "total_runs": total_runs,
            "success_count": success_count,
            "failed_count": failed_count,
            "skipped_count": skipped_count,
            "success_rate": round(success_rate, 4),
            "days_observed": days_observed,
            "latest_success": _iso(latest_success_dt),
            "latest_failure": _iso(latest_failure_dt),
            "stale": stale,
            "stale_reason": stale_reason,
            "avg_records_written": avg_records_written,
            "min_records_written": min_records_written,
            "max_records_written": max_records_written,
            "duplicate_key_warnings_total": dup_warnings_total,
            "required_field_missing_count_total": missing_fields_total,
        }

    min_days = rules.get("min_days_observed") or 3
    min_rate = rules.get("min_success_rate") or 0.90

    if total_runs == 0:
        blockers.append(f"no runs in the last {(rules.get('min_days_observed') or 3)} days")

    if days_observed < min_days:
        blockers.append(
            f"only {days_observed} day(s) with successful runs (need ≥{min_days})"
        )

    if total_runs > 0 and success_rate < min_rate:
        blockers.append(
            f"success rate {success_rate:.1%} is below threshold {min_rate:.0%}"
            f" ({success_count}/{total_runs} succeeded)"
        )

    if stale:
        blockers.append(f"data is stale: {stale_reason}")

    if avg_records_written is not None and avg_records_written == 0:
        blockers.append("avg_records_written = 0 — ingestion is not writing any records")

    if dup_warnings_total >= _DUP_WARNING_THRESHOLD:
        blockers.append(
            f"duplicate_key_warnings={dup_warnings_total} exceeds threshold {_DUP_WARNING_THRESHOLD}"
        )

    if blockers:
        readiness = "blocked"
    elif warnings:
        readiness = "watch"
    else:
        readiness = "ready"

    return {
        "source": source,
        "readiness": readiness,
        "blockers": blockers,
        "warnings": warnings,
        "total_runs": total_runs,
        "success_count": success_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "success_rate": round(success_rate, 4) if total_runs > 0 else None,
        "days_observed": days_observed,
        "latest_success": _iso(latest_success_dt),
        "latest_failure": _iso(latest_failure_dt),
        "stale": stale,
        "stale_reason": stale_reason,
        "avg_records_written": round(avg_records_written, 1) if avg_records_written is not None else None,
        "min_records_written": min_records_written,
        "max_records_written": max_records_written,
        "duplicate_key_warnings_total": dup_warnings_total,
        "required_field_missing_count_total": missing_fields_total,
    }


# ── Global readiness ──────────────────────────────────────────────────────────

def _global_readiness(source_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute overall promotion readiness from per-source results."""
    by_source = {r["source"]: r for r in source_results}

    required_ok = all(
        by_source.get(s, {}).get("readiness") == "ready"
        for s in REQUIRED_SOURCES
    )
    any_blocked = any(
        r.get("readiness") == "blocked"
        for s, r in by_source.items()
        if s in REQUIRED_SOURCES
    )

    if any_blocked:
        overall = "blocked"
    elif required_ok:
        overall = "ready_to_promote"
    else:
        overall = "watch"

    blocked_sources = [
        s for s in REQUIRED_SOURCES
        if by_source.get(s, {}).get("readiness") == "blocked"
    ]
    watch_sources = [
        s for s in REQUIRED_SOURCES
        if by_source.get(s, {}).get("readiness") == "watch"
    ]

    return {
        "overall": overall,
        "required_sources_ready": required_ok,
        "blocked_sources": blocked_sources,
        "watch_sources": watch_sources,
        "recommendation": _recommendation(overall, blocked_sources, watch_sources),
    }


def _recommendation(
    overall: str,
    blocked: List[str],
    watch: List[str],
) -> str:
    if overall == "ready_to_promote":
        return (
            "All required sources are healthy. Review metrics carefully before "
            "promoting. No automated promotion — manual sign-off required."
        )
    if overall == "blocked":
        return (
            f"Promotion blocked by: {', '.join(blocked)}. "
            "Resolve blockers and observe for at least 3 more days."
        )
    return (
        f"Sources need more observation time: {', '.join(watch or blocked)}. "
        "Continue monitoring scheduled runs."
    )


# ── Formatting ────────────────────────────────────────────────────────────────

_READINESS_LABEL = {
    "ready": "READY      ",
    "watch": "WATCH      ",
    "blocked": "BLOCKED    ",
    "manual-only": "MANUAL-ONLY",
    "ready_to_promote": "READY TO PROMOTE",
}


def _print_source(r: Dict[str, Any]) -> None:
    label = _READINESS_LABEL.get(r["readiness"], r["readiness"].upper())
    print(f"  [{label}] {r['source']}")

    if r.get("total_runs") is not None:
        rate_str = f"{r['success_rate']:.1%}" if r.get("success_rate") is not None else "n/a"
        print(
            f"            runs={r['total_runs']}  success={r['success_count']}"
            f"  failed={r['failed_count']}  skipped={r['skipped_count']}"
            f"  success_rate={rate_str}"
        )
        print(f"            days_observed={r['days_observed']}")

    if r.get("latest_success"):
        dt = _parse_iso(r["latest_success"])
        print(f"            latest_success: {_age_str(dt)}  ({r['latest_success']})")
    if r.get("latest_failure"):
        dt = _parse_iso(r["latest_failure"])
        print(f"            latest_failure: {_age_str(dt)}  ({r['latest_failure']})")

    if r.get("avg_records_written") is not None:
        print(
            f"            records_written  avg={r['avg_records_written']}"
            f"  min={r['min_records_written']}  max={r['max_records_written']}"
        )

    if r.get("duplicate_key_warnings_total"):
        print(f"            dup_key_warnings={r['duplicate_key_warnings_total']}")
    if r.get("required_field_missing_count_total"):
        print(f"            missing_fields={r['required_field_missing_count_total']}")

    if r.get("stale"):
        print(f"            ↳ STALE: {r.get('stale_reason')}")

    for b in r.get("blockers") or []:
        print(f"            ↳ BLOCKER: {b}")
    for w in r.get("warnings") or []:
        print(f"            ↳ WATCH:   {w}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Check v2 staging promotion readiness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--days",
        type=int,
        default=3,
        help="Observation window in days (default: 3)",
    )
    ap.add_argument(
        "--json",
        dest="output_json",
        action="store_true",
        default=False,
        help="Output JSON instead of human-readable text",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show configuration without connecting to MongoDB",
    )
    args = ap.parse_args()

    if args.dry_run:
        if args.output_json:
            print(json.dumps({"dry_run": True, "sources": list(_SOURCE_RULES.keys())}))
        else:
            print("[readiness] DRY RUN — no MongoDB connection")
            print(f"  Observation window: {args.days} days")
            print("  Sources configured:")
            for src, rules in _SOURCE_RULES.items():
                tag = "manual-only" if rules.get("manual_only") else (
                    "watch-only" if rules.get("always_watch") else "evaluated"
                )
                print(f"    {src:<25}  {tag}")
        return 0

    # ── Connect ───────────────────────────────────────────────────────────────
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
        msg = "MONGO_URI not set. Set MONGO_URI=... or use --dry-run."
        if args.output_json:
            print(json.dumps({"ok": False, "error": msg}))
        else:
            print(f"[readiness] ERROR: {msg}", file=sys.stderr)
        return 2

    try:
        from storage.mongo_client import get_db  # noqa: PLC0415
        db = get_db()
    except Exception as exc:
        msg = f"MongoDB connection failed: {exc}"
        if args.output_json:
            print(json.dumps({"ok": False, "error": msg}))
        else:
            print(f"[readiness] ERROR: {msg}", file=sys.stderr)
        return 2

    # ── Evaluate ──────────────────────────────────────────────────────────────
    since = _utcnow() - timedelta(days=args.days)
    source_results = [
        _evaluate_source(db, src, rules, since)
        for src, rules in _SOURCE_RULES.items()
    ]
    global_result = _global_readiness(source_results)

    now_str = _utcnow().isoformat()

    if args.output_json:
        print(json.dumps({
            "ok": True,
            "evaluated_at": now_str,
            "observation_days": args.days,
            "since": since.isoformat(),
            "global": global_result,
            "sources": source_results,
        }, default=str))
        return 0 if global_result["overall"] == "ready_to_promote" else 1

    # ── Human-readable output ─────────────────────────────────────────────────
    print(f"[readiness] evaluated at {_utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"[readiness] observation window: last {args.days} days")
    print()

    for r in source_results:
        _print_source(r)
        print()

    label = _READINESS_LABEL.get(global_result["overall"], global_result["overall"].upper())
    print(f"──────────────────────────────────────────────────────────────")
    print(f"OVERALL: {label}")
    print(f"  {global_result['recommendation']}")
    print()

    return 0 if global_result["overall"] == "ready_to_promote" else 1


if __name__ == "__main__":
    sys.exit(main())
