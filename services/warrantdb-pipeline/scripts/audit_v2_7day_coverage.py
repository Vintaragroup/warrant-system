"""
scripts/audit_v2_7day_coverage.py
──────────────────────────────────────────────────────────────────────────────
Ground-truth audit of v2 staging collections.

Reports per county:
  - total docs
  - docs with event/booking date >= CUTOFF_DATE (7 days ago)
  - docs grouped by date for the last 7 days
  - latest values for every known date field
  - field-presence counts (which date fields are populated)
  - sample of 5 recent docs

Date candidate priority (matches dashboard toYmd chain):
  booking_date > observed_at > arrest_date > booked_at > event_date
  > scraped_at > ingested_at

Usage:
  python3 scripts/audit_v2_7day_coverage.py
  python3 scripts/audit_v2_7day_coverage.py --cutoff 2026-04-21 --verbose

All reads are from STAGING collections only (v2_*).
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta, timezone, datetime
from typing import Dict, List, Optional

try:
    from pymongo import MongoClient
except ImportError:
    print("ERROR: pymongo not installed.  Run: pip install pymongo", file=sys.stderr)
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

STAGING_COLLECTIONS = {
    "galveston":  "v2_galveston_events",
    "harris":     "v2_harris_reports",
    "fortbend":   "v2_lookup_results",
    "jefferson":  "v2_lookup_results",
    "brazoria":   "v2_lookup_results",
}

DATE_CANDIDATES = [
    "booking_date",
    "observed_at",
    "arrest_date",
    "booked_at",
    "event_date",
    "scraped_at",
    "ingested_at",
]

# Only these fields represent actual booking/event dates — not scrape metadata.
# scraped_at and ingested_at are NOT used for 7-day range counting.
BOOKING_DATE_CANDIDATES = [
    "booking_date",
    "observed_at",
    "arrest_date",
    "booked_at",
    "event_date",
]

COVERAGE_TYPES = {
    "galveston":  "CURRENT_ROSTER_ONLY",
    "harris":     "REPORT_BASED",
    "fortbend":   "LOOKUP_ONLY",
    "jefferson":  "FULL_7DAY_COVERAGE",
    "brazoria":   "LOOKUP_ONLY",
}

CHICAGO_TZ = "America/Chicago"


def _connect() -> "MongoClient":
    uri = os.environ.get("MONGO_URI") or os.environ.get("MONGODB_URI")
    if not uri:
        print("ERROR: MONGO_URI not set", file=sys.stderr)
        sys.exit(1)
    return MongoClient(uri)


def _db_name() -> str:
    return os.environ.get("MONGO_DB", "warrantdb")


def _today_str() -> str:
    """Today in America/Chicago as YYYY-MM-DD (safe for date-only strings)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo(CHICAGO_TZ)).strftime("%Y-%m-%d")
    except Exception:
        return date.today().isoformat()


def _iso_to_date(s: Optional[str]) -> Optional[date]:
    """Safely parse a YYYY-MM-DD or ISO datetime string to a date."""
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _best_date(doc: dict) -> Optional[str]:
    """Return the best available date string for a document."""
    for field in DATE_CANDIDATES:
        val = doc.get(field)
        if val:
            d = _iso_to_date(str(val))
            if d:
                return d.isoformat()
    return None


def _sep(char="─", width=72):
    print(char * width)


def audit_county(
    db,
    county: str,
    collection_name: str,
    cutoff: date,
    verbose: bool = False,
) -> dict:
    """Audit a single county in a staging collection."""
    coll = db[collection_name]

    county_match = {"county": county} if county not in ("galveston",) else {}
    # galveston has its own collection — no county filter needed
    # harris also has its own collection
    if collection_name in ("v2_galveston_events", "v2_harris_reports"):
        county_match = {}
    else:
        county_match = {"county": county}

    total = coll.count_documents(county_match)

    # ── Latest values for every date field ──────────────────────────────────
    latest: Dict[str, Optional[str]] = {}
    for field in DATE_CANDIDATES:
        match_q = {**county_match, field: {"$exists": True, "$ne": None, "$ne": ""}}
        doc = coll.find_one(match_q, {field: 1}, sort=[(field, -1)])
        latest[field] = str(doc[field])[:19] if doc else None

    # ── Field presence counts ────────────────────────────────────────────────
    field_counts: Dict[str, int] = {}
    for field in DATE_CANDIDATES:
        field_counts[field] = coll.count_documents({**county_match, field: {"$exists": True, "$ne": None, "$ne": ""}})

    # ── 7-day breakdown using booking/event dates only (not scrape metadata) ─
    days_in_range: Dict[str, int] = {}
    total_in_range = 0
    today = date.today()
    num_days = (today - cutoff).days + 1  # inclusive of both endpoints
    for offset in range(num_days):
        d = cutoff + timedelta(days=offset)
        ds = d.isoformat()
        # Only count against actual booking/event date fields — never scraped_at/ingested_at
        count = 0
        for field in BOOKING_DATE_CANDIDATES:
            q = {**county_match, field: {"$regex": f"^{ds}"}}
            c = coll.count_documents(q)
            if c > 0:
                count = max(count, c)
                break  # use highest-priority field that has results
        days_in_range[ds] = count
        total_in_range += count

    # ── Sample recent docs ───────────────────────────────────────────────────
    sample_docs = []
    if verbose:
        cursor = coll.find(county_match, {"_id": 0, "raw": 0, "charges": 0}).sort(
            [("ingested_at", -1), ("scraped_at", -1)]
        ).limit(5)
        for doc in cursor:
            # Trim to useful fields
            sample_docs.append({k: doc[k] for k in (
                "county", "full_name", "booking_date", "observed_at",
                "arrest_date", "scraped_at", "ingested_at"
            ) if k in doc})

    return {
        "county": county,
        "collection": collection_name,
        "coverage_type": COVERAGE_TYPES.get(county, "UNKNOWN"),
        "total_docs": total,
        "total_in_7day_range": total_in_range,
        "days": days_in_range,
        "latest": latest,
        "field_presence": field_counts,
        "sample": sample_docs,
    }


def print_report(result: dict, cutoff: date) -> None:
    county = result["county"].upper()
    ctype = result["coverage_type"]
    _sep()
    print(f"  {county}  ({ctype})  —  collection: {result['collection']}")
    _sep()
    print(f"  Total docs in collection:   {result['total_docs']}")
    print(f"  Docs in 7-day window:       {result['total_in_7day_range']}")
    print()
    print(f"  Daily breakdown ({cutoff.isoformat()} → today):")
    for day, cnt in sorted(result["days"].items()):
        bar = "█" * min(cnt, 40)
        print(f"    {day}  {cnt:>5}  {bar}")
    print()
    print("  Latest date field values:")
    for field in DATE_CANDIDATES:
        val = result["latest"].get(field)
        print(f"    {field:<20}  {val or '—'}")
    print()
    print("  Field presence (# docs with field populated):")
    for field, cnt in result["field_presence"].items():
        pct = f"{cnt/max(result['total_docs'],1)*100:.0f}%" if result["total_docs"] else "—"
        print(f"    {field:<20}  {cnt:>6}  ({pct})")
    if result["sample"]:
        print()
        print("  Sample recent docs (5):")
        for doc in result["sample"]:
            print(f"    {doc}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit v2 staging collection 7-day coverage")
    parser.add_argument(
        "--cutoff",
        default=None,
        help="Start of 7-day window as YYYY-MM-DD (default: today-6 days)",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Include sample docs")
    args = parser.parse_args()

    today = _iso_to_date(_today_str())
    if args.cutoff:
        cutoff = _iso_to_date(args.cutoff)
        if not cutoff:
            print(f"Invalid --cutoff: {args.cutoff}", file=sys.stderr)
            sys.exit(1)
    else:
        cutoff = today - timedelta(days=6)

    client = _connect()
    db = client[_db_name()]

    print()
    print("=" * 72)
    print("  V2 STAGING COLLECTIONS — 7-DAY BOOKING COVERAGE AUDIT")
    print(f"  Run date: {_today_str()}  |  7-day window: {cutoff.isoformat()} → {today.isoformat()}")
    print("=" * 72)
    print()

    results = {}
    seen_collections = {}

    for county, collection_name in STAGING_COLLECTIONS.items():
        result = audit_county(db, county, collection_name, cutoff, verbose=args.verbose)
        results[county] = result
        print_report(result, cutoff)
        seen_collections.setdefault(collection_name, []).append(county)

    # ── Summary table ─────────────────────────────────────────────────────────
    _sep("═")
    print("  SUMMARY")
    _sep("═")
    print(f"  {'COUNTY':<12} {'TYPE':<25} {'TOTAL':>7} {'7-DAY':>7} {'LATEST booking_date':<22} {'STATUS'}")
    _sep()
    for county, r in results.items():
        total = r["total_docs"]
        in_range = r["total_in_7day_range"]
        latest_bd = r["latest"].get("booking_date") or r["latest"].get("observed_at") or "—"
        ctype = r["coverage_type"]
        status = "✓" if in_range > 0 else "✗ NO DATA"
        if ctype in ("LOOKUP_ONLY",):
            status = "— LOOKUP"
        print(f"  {county:<12} {ctype:<25} {total:>7} {in_range:>7} {latest_bd:<22} {status}")
    _sep()
    print()
    print("  Coverage type legend:")
    print("    FULL_7DAY_COVERAGE  — source supports querying any date range")
    print("    CURRENT_ROSTER_ONLY — source is a live roster, not historical")
    print("    REPORT_BASED        — coverage depends on which reports were downloaded")
    print("    LOOKUP_ONLY         — requires name search; no date-only feed available")
    print()


if __name__ == "__main__":
    main()
