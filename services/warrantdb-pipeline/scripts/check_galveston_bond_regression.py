"""
scripts/check_galveston_bond_regression.py
───────────────────────────────────────────────────────────────────────────────
Regression check for Galveston bond enrichment.

Verifies:
  1. v2_galveston_events has records ingested within the last 48 hours.
  2. >= 70% of total docs have detail_fetch_status = "ok".
  3. >= 50% of total docs have bond_amount > 0.
  4. The dashboard server aggregation returns a non-zero Galveston bond total
     for the 7-day window (requires DASHBOARD_URL env var or --dashboard-url).

Exit code: 0 all checks pass, 1 if any check fails.

Usage
─────
  # MongoDB checks only (no dashboard):
  python3 scripts/check_galveston_bond_regression.py

  # Include dashboard API check:
  python3 scripts/check_galveston_bond_regression.py \\
      --dashboard-url http://localhost:3001 \\
      --dashboard-token <JWT>

  # Inside the admin-dev container:
  docker exec warrant-admin-dev-api-1 python3 \\
      /pipeline/scripts/check_galveston_bond_regression.py
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

# ── Thresholds ────────────────────────────────────────────────────────────────

MIN_DETAIL_OK_PCT   = 0.70   # >= 70% of docs must have detail_fetch_status=ok
MIN_BOND_PCT        = 0.50   # >= 50% of docs must have bond_amount > 0
MAX_RECENCY_HOURS   = 48     # at least one doc ingested within this window

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

def _check(label: str, passed: bool, detail: str = "") -> bool:
    status = PASS if passed else FAIL
    suffix = f"  ({detail})" if detail else ""
    print(f"  [{status}] {label}{suffix}")
    return passed


# ── Checks ────────────────────────────────────────────────────────────────────

def check_mongo(uri: str) -> bool:
    from pymongo import MongoClient  # type: ignore

    db  = MongoClient(uri)["warrantdb"]
    col = db["v2_galveston_events"]

    all_ok = True

    # 1. Recent records
    cutoff_dt = datetime.now(timezone.utc) - timedelta(hours=MAX_RECENCY_HOURS)
    cutoff_iso = cutoff_dt.isoformat()
    recent = col.count_documents({
        "county": "galveston",
        "scraped_at": {"$gte": cutoff_iso},
    })
    all_ok &= _check(
        f"Recent records (ingested within {MAX_RECENCY_HOURS}h)",
        recent > 0,
        f"found {recent}",
    )

    # 2. detail_fetch_status = ok rate
    total = col.count_documents({"county": "galveston"})
    if total == 0:
        _check("Total docs > 0", False, "collection is empty")
        return False

    ok_count = col.count_documents({"county": "galveston", "detail_fetch_status": "ok"})
    ok_pct   = ok_count / total
    all_ok  &= _check(
        f"detail_fetch_status=ok >= {MIN_DETAIL_OK_PCT:.0%}",
        ok_pct >= MIN_DETAIL_OK_PCT,
        f"{ok_count}/{total} = {ok_pct:.1%}",
    )

    # 3. bond_amount > 0 rate
    with_bond = col.count_documents({"county": "galveston", "bond_amount": {"$gt": 0}})
    bond_pct  = with_bond / total
    all_ok   &= _check(
        f"bond_amount > 0 >= {MIN_BOND_PCT:.0%}",
        bond_pct >= MIN_BOND_PCT,
        f"{with_bond}/{total} = {bond_pct:.1%}",
    )

    # 4. 7-day bond total > 0
    cutoff_7d = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
    pipeline  = [
        {"$match": {"county": "galveston", "booking_date": {"$gte": cutoff_7d}, "bond_amount": {"$gt": 0}}},
        {"$group": {"_id": None, "total": {"$sum": "$bond_amount"}, "count": {"$sum": 1}}},
    ]
    result     = list(col.aggregate(pipeline))
    bond_total = result[0]["total"] if result else 0
    bond_docs  = result[0]["count"] if result else 0
    all_ok    &= _check(
        "7-day bond total > 0",
        bond_total > 0,
        f"${bond_total:,.2f} across {bond_docs} docs",
    )

    return all_ok


def check_dashboard(base_url: str, token: Optional[str]) -> bool:
    import urllib.request
    import json

    url = f"{base_url.rstrip('/')}/api/dashboard/summary?window=7d"
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as exc:
        _check("Dashboard API reachable", False, str(exc))
        return False

    _check("Dashboard API reachable", True, url)

    per_county = data.get("perCounty") or []
    galv = next(
        (c for c in per_county if (c.get("county") or "").lower() == "galveston"),
        None,
    )

    if galv is None:
        _check("Galveston present in perCounty", False, "key not found")
        return False

    bond_val = galv.get("bondWindowValue") or 0
    has_bond = galv.get("hasBond") or 0
    passed   = _check(
        "Galveston bondWindowValue > 0",
        bond_val > 0,
        f"bondWindowValue={bond_val:,} hasBond={has_bond}",
    )
    return passed


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Galveston bond enrichment regression check")
    parser.add_argument("--dashboard-url",   default=os.getenv("DASHBOARD_URL"),    help="Dashboard server base URL")
    parser.add_argument("--dashboard-token", default=os.getenv("DASHBOARD_TOKEN"),  help="Auth token for dashboard API")
    parser.add_argument("--mongo-uri",       default=os.getenv("MONGO_URI"),        help="MongoDB connection URI")
    args = parser.parse_args()

    all_ok = True

    # ── MongoDB checks ────────────────────────────────────────────────────────
    mongo_uri = args.mongo_uri
    if not mongo_uri:
        print("[SKIP] MongoDB checks — MONGO_URI not set")
    else:
        print("── MongoDB checks ──────────────────────────────────────────────")
        all_ok &= check_mongo(mongo_uri)

    # ── Dashboard checks ──────────────────────────────────────────────────────
    if args.dashboard_url:
        print("── Dashboard API checks ────────────────────────────────────────")
        all_ok &= check_dashboard(args.dashboard_url, args.dashboard_token)
    else:
        print("[SKIP] Dashboard checks — --dashboard-url / DASHBOARD_URL not set")

    # ── Result ────────────────────────────────────────────────────────────────
    print()
    if all_ok:
        print(f"[{PASS}] All Galveston bond regression checks passed.")
    else:
        print(f"[{FAIL}] One or more checks FAILED — bond enrichment may have regressed.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
