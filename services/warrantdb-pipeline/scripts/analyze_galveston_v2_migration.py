"""
scripts/analyze_galveston_v2_migration.py
───────────────────────────────────────────────────────────────────────────────
Read-only analysis of the Galveston legacy → v2 migration.

Reports:
  • doc counts (legacy galveston_events vs v2_galveston_events)
  • key field presence rates across all legacy docs
  • duplicate rates in each collection
  • overlap analysis using four key strategies:
      1. booking_number (direct field match)
      2. jacket_number (direct field match)
      3. source_url sha1[:12]  (legacy source_id equivalent)
      4. full_name + normalized source_url
  • records only in legacy (sampled)
  • records only in v2 (sampled)
  • sample mismatches / surprising fields
  • recommended migration strategy

IMPORTANT: This script never writes to MongoDB.

Usage
─────
  python3 scripts/analyze_galveston_v2_migration.py --limit 500
  python3 scripts/analyze_galveston_v2_migration.py --limit 500 --verbose
  python3 scripts/analyze_galveston_v2_migration.py --dry-run
  python3 scripts/analyze_galveston_v2_migration.py --limit 500 --json > report.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

# ── Constants ──────────────────────────────────────────────────────────────────

LEGACY_COLL = "galveston_events"
V2_COLL = "v2_galveston_events"

# Core fields that a healthy record should have (non-null)
LEGACY_REQUIRED = ["source_url", "scraped_at"]
V2_REQUIRED     = ["full_name", "county", "source", "scraped_at", "booking_number"]

_SEP = "─" * 72


# ── URL normalization (mirrors galveston_p2c.py) ───────────────────────────────

def _normalize_url(u: str) -> str:
    try:
        s = urlsplit(u)
        q = [(k, v) for k, v in parse_qsl(s.query, keep_blank_values=True)
             if k.lower() != "navid"]
        return urlunsplit((s.scheme, s.netloc.lower(), s.path.lower(), urlencode(q), ""))
    except Exception:
        return u or ""


def _url_hash(u: str) -> Optional[str]:
    n = _normalize_url(u)
    return sha1(n.encode()).hexdigest()[:12] if n else None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_dt(v: Any) -> Optional[datetime]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _age_str(dt: Optional[datetime]) -> str:
    if dt is None:
        return "never"
    delta = _utcnow() - dt
    h = int(delta.total_seconds() // 3600)
    d = h // 24
    if d >= 1:
        return f"{d}d {h % 24}h ago"
    m = int((delta.total_seconds() % 3600) // 60)
    return f"{h}h {m}m ago" if h > 0 else f"{m}m ago"


def _nonnull(doc: Dict[str, Any], field: str) -> bool:
    v = doc.get(field)
    return v is not None and v != "" and v != []


def _scrub(doc: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in doc.items() if k != "_id"}


def _safe_json(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe_json(i) for i in obj]
    return obj


def _pct(num: int, denom: int) -> str:
    if denom == 0:
        return "n/a"
    return f"{round(num / denom * 100, 1)}%"


def _print_section(title: str) -> None:
    print(f"\n{_SEP}\n  {title}\n{_SEP}")


def _row(label: str, value: Any, warn: bool = False) -> None:
    tag = "  WARN " if warn else "       "
    print(f"{tag}{label:<50} {value}")


# ── Collection profiler ────────────────────────────────────────────────────────

def _profile_collection(
    db,
    coll_name: str,
    limit: int,
    required_fields: List[str],
) -> Dict[str, Any]:
    coll = db[coll_name]
    total = coll.count_documents({})

    # Latest scraped_at / ingested_at
    ts_field = "ingested_at" if coll_name.startswith("v2_") else "scraped_at"
    latest_doc = coll.find_one(
        {ts_field: {"$exists": True}},
        sort=[(ts_field, -1)],
        projection={ts_field: 1},
    )
    latest_ts = _coerce_dt(latest_doc.get(ts_field)) if latest_doc else None

    # Sample
    sample: List[Dict[str, Any]] = list(
        coll.find({}, {"_id": 0}).sort(ts_field, -1).limit(limit)
    )

    # Field frequency
    field_freq: Counter = Counter()
    for doc in sample:
        for k in doc:
            if not k.startswith("_"):
                field_freq[k] += 1

    field_coverage = {
        k: round(c / max(len(sample), 1) * 100, 1)
        for k, c in field_freq.items()
    }

    # Required field missing counts
    missing: Dict[str, int] = {}
    for f in required_fields:
        mc = sum(1 for d in sample if not _nonnull(d, f))
        if mc:
            missing[f] = mc

    # Key field presence across the FULL collection (not just sample)
    key_presence: Dict[str, int] = {}
    for f in [
        "booking_number", "jacket_number", "source_id", "source_url",
        "full_name", "county", "booked_at", "booking_date",
    ]:
        key_presence[f] = coll.count_documents(
            {f: {"$exists": True, "$nin": [None, "", []]}}
        )

    # Duplicate detection by source_url hash in sample
    url_counter: Counter = Counter()
    for doc in sample:
        h = _url_hash(doc.get("source_url") or "")
        if h:
            url_counter[h] += 1
    dup_url_rate = sum(1 for c in url_counter.values() if c > 1) / max(len(url_counter), 1)

    # Index info
    indexes = list(db[coll_name].index_information().values())

    return {
        "collection": coll_name,
        "total": total,
        "ts_field": ts_field,
        "latest_ts": latest_ts,
        "sample_size": len(sample),
        "sample": sample,
        "field_coverage": field_coverage,
        "missing_required": missing,
        "key_presence": key_presence,
        "dup_url_rate_pct": round(dup_url_rate * 100, 2),
        "indexes": indexes,
    }


# ── Overlap analysis ───────────────────────────────────────────────────────────

def _build_legacy_keysets(
    legacy_sample: List[Dict[str, Any]],
) -> Dict[str, Set[Any]]:
    """
    Build four sets from the legacy sample:
      booking_number  — direct field (will be empty if all null)
      jacket_number   — direct field (will be empty if all null)
      url_hash        — sha1[:12] of normalized source_url
      name_url        — (normalized full_name, normalized_source_url) tuple
    """
    sets: Dict[str, Set] = defaultdict(set)
    for doc in legacy_sample:
        if bn := (doc.get("booking_number") or "").strip():
            sets["booking_number"].add(bn)
        if jn := (doc.get("jacket_number") or "").strip():
            sets["jacket_number"].add(jn)
        url = doc.get("source_url") or ""
        h = _url_hash(url)
        if h:
            sets["url_hash"].add(h)
        name = (doc.get("full_name") or "").strip().upper()
        nu = _normalize_url(url)
        if name and nu:
            sets["name_url"].add((name, nu))
    return dict(sets)


def _build_v2_keysets(
    v2_sample: List[Dict[str, Any]],
) -> Dict[str, Set[Any]]:
    sets: Dict[str, Set] = defaultdict(set)
    for doc in v2_sample:
        if bn := (doc.get("booking_number") or "").strip():
            sets["booking_number"].add(bn)
        if jn := (doc.get("jacket_number") or "").strip():
            sets["jacket_number"].add(jn)
        # v2 stores source_id as booking_number > jacket_number > sha1(url)[:12]
        # If booking_number is absent, source_id IS the url_hash
        if sid := (doc.get("source_id") or "").strip():
            if len(sid) == 12:  # sha1 hash
                sets["url_hash"].add(sid)
        url = doc.get("source_url") or ""
        h = _url_hash(url)
        if h:
            sets["url_hash"].add(h)
        name = (doc.get("full_name") or "").strip().upper()
        nu = _normalize_url(url)
        if name and nu:
            sets["name_url"].add((name, nu))
    return dict(sets)


def _analyze_overlap(
    legacy_sets: Dict[str, Set],
    v2_sets: Dict[str, Set],
    legacy_total: int,
    v2_total: int,
    legacy_sample_n: int,
    v2_sample_n: int,
) -> Dict[str, Any]:
    results: Dict[str, Any] = {}
    strategies = ["booking_number", "jacket_number", "url_hash", "name_url"]
    for strat in strategies:
        ls = legacy_sets.get(strat, set())
        vs = v2_sets.get(strat, set())
        both = ls & vs
        only_l = ls - vs
        only_v = vs - ls
        total_union = len(both) + len(only_l) + len(only_v)
        results[strat] = {
            "legacy_keys": len(ls),
            "v2_keys": len(vs),
            "in_both": len(both),
            "only_legacy": len(only_l),
            "only_v2": len(only_v),
            "match_rate_pct": round(len(both) / max(total_union, 1) * 100, 1),
            "only_legacy_examples": sorted(str(x) for x in list(only_l)[:5]),
            "only_v2_examples": sorted(str(x) for x in list(only_v)[:5]),
        }
    return results


# ── Field diff ─────────────────────────────────────────────────────────────────

def _field_diff(
    legacy_cov: Dict[str, float],
    v2_cov: Dict[str, float],
) -> Dict[str, Any]:
    lg = set(legacy_cov)
    v2 = set(v2_cov)
    only_legacy = sorted(lg - v2)
    only_v2 = sorted(v2 - lg)
    delta = {
        f: {"legacy_pct": legacy_cov[f], "v2_pct": v2_cov[f]}
        for f in lg & v2
        if abs(legacy_cov.get(f, 0) - v2_cov.get(f, 0)) > 15
    }
    return {
        "only_in_legacy": only_legacy,
        "only_in_v2": only_v2,
        "coverage_delta": delta,
    }


# ── Recommendation engine ──────────────────────────────────────────────────────

def _recommend(
    legacy: Dict[str, Any],
    v2: Dict[str, Any],
    overlap: Dict[str, Any],
) -> str:
    url_match = overlap.get("url_hash", {}).get("match_rate_pct", 0)
    bn_match = overlap.get("booking_number", {}).get("match_rate_pct", 0)
    v2_has_bn_pct = v2["key_presence"].get("booking_number", 0) / max(v2["total"], 1) * 100
    legacy_stale_days = (
        (_utcnow() - legacy["latest_ts"]).days if legacy["latest_ts"] else 999
    )
    v2_stale = (
        int((_utcnow() - v2["latest_ts"]).total_seconds() // 3600)
        if v2["latest_ts"] else 999
    )

    lines = [""]
    lines.append("  Based on the analysis above:")
    lines.append("")

    if legacy_stale_days > 30:
        lines.append(f"  ✓ Legacy collection is STALE ({legacy_stale_days} days) — v2 is the only active writer.")
    if v2_has_bn_pct >= 90:
        lines.append(f"  ✓ V2 records have booking_number in {v2_has_bn_pct:.0f}% of cases — stable upsert key available.")
    if url_match < 10:
        lines.append(f"  ⚠ Cross-match via source_url hash is {url_match}% — temporal gap; not a schema mismatch.")
    if legacy["key_presence"].get("booking_number", 0) == 0:
        lines.append("  ⚠ Legacy docs have NO booking_number — direct key backfill requires re-scraping or URL parsing.")

    lines.append("")
    lines.append("  RECOMMENDED MIGRATION PATH:")
    lines.append("    Phase 1 (now):     Enable v2-galveston-staging cron; accumulate 1 week of data.")
    lines.append("    Phase 2 (1 week):  Create galveston_events_v2 as production-adjacent collection.")
    lines.append("    Phase 3 (2 weeks): Point dashboard/API reads to v2 collection (read-only switchover).")
    lines.append("    Phase 4 (later):   Archive legacy galveston_events (rename to galveston_events_legacy).")
    lines.append("    Phase 5 (later):   Drop galveston_p2c_fast.py writer once v2 cron is stable.")
    lines.append("")
    lines.append("  KEY MIGRATION NOTE:")
    lines.append("    Do NOT upsert v2 records into legacy galveston_events — key strategies differ.")
    lines.append("    Run both collections in parallel during Phase 1–3; never merge them directly.")

    return "\n".join(lines)


# ── Printer ────────────────────────────────────────────────────────────────────

def _print_report(
    legacy: Dict[str, Any],
    v2: Dict[str, Any],
    overlap: Dict[str, Any],
    fd: Dict[str, Any],
    verbose: bool,
) -> None:
    print(f"\n[galveston-migration-analysis] {_utcnow().strftime('%Y-%m-%d %H:%M UTC')}")

    _print_section("1. Collection Counts and Freshness")
    _row("Legacy collection", LEGACY_COLL)
    _row("  total documents", f"{legacy['total']:,}")
    _row("  latest scraped_at", f"{legacy['latest_ts'].isoformat() if legacy['latest_ts'] else 'none'}  [{_age_str(legacy['latest_ts'])}]",
         warn=legacy["latest_ts"] is None or (legacy["latest_ts"] and (_utcnow() - legacy["latest_ts"]).days > 30))
    _row("  sample size used", legacy["sample_size"])
    _row("V2 collection", V2_COLL)
    _row("  total documents", f"{v2['total']:,}")
    _row("  latest ingested_at", f"{v2['latest_ts'].isoformat() if v2['latest_ts'] else 'none'}  [{_age_str(v2['latest_ts'])}]",
         warn=v2["latest_ts"] is None)
    _row("  sample size used", v2["sample_size"])

    _print_section("2. Key Field Presence")
    print(f"\n  {'Field':<35} {'Legacy':>12} {'V2':>12}  {'Legacy %':>10}  {'V2 %':>8}")
    print(f"  {'─'*35}  {'─'*10}  {'─'*10}  {'─'*10}  {'─'*8}")
    key_fields = ["booking_number", "jacket_number", "source_id", "source_url",
                  "full_name", "county", "booked_at", "booking_date"]
    for f in key_fields:
        lv = legacy["key_presence"].get(f, 0)
        vv = v2["key_presence"].get(f, 0)
        lp = _pct(lv, legacy["total"])
        vp = _pct(vv, v2["total"])
        warn = (f in ("booking_number", "source_url") and lv == 0)
        tag = "  WARN " if warn else "       "
        print(f"{tag}{f:<35} {lv:>12,}  {vv:>10,}  {lp:>10}  {vp:>8}")

    _print_section("3. Duplicate Rate (source_url hash deduplication)")
    _row("Legacy dup rate (by url_hash in sample)", f"{legacy['dup_url_rate_pct']}%",
         warn=legacy["dup_url_rate_pct"] > 1)
    _row("V2 dup rate (by url_hash in sample)", f"{v2['dup_url_rate_pct']}%",
         warn=v2["dup_url_rate_pct"] > 1)

    _print_section("4. Cross-Collection Overlap Analysis (sampled)")
    print("  Note: 0% match rates between old and new data are expected when there is no")
    print("  temporal overlap in the samples (legacy stale, v2 recent).  They do NOT")
    print("  indicate a schema mismatch.  url_hash is the most reliable bridge key.\n")
    strategies = [
        ("booking_number",  "Direct booking_number match"),
        ("jacket_number",   "Direct jacket_number match"),
        ("url_hash",        "source_url sha1[:12] hash (most reliable bridge)"),
        ("name_url",        "full_name + normalized source_url"),
    ]
    for strat, desc in strategies:
        r = overlap[strat]
        print(f"  Strategy: {desc}")
        _row("    Legacy keys in sample", r["legacy_keys"])
        _row("    V2 keys in sample",     r["v2_keys"])
        _row("    Matched (in both)",      r["in_both"],
             warn=(r["legacy_keys"] > 0 and r["v2_keys"] > 0 and r["in_both"] == 0))
        _row("    Only in legacy sample",  f"{r['only_legacy']}  ex: {r['only_legacy_examples'][:3]}")
        _row("    Only in v2 sample",      f"{r['only_v2']}   ex: {r['only_v2_examples'][:3]}")
        _row("    Match rate",             f"{r['match_rate_pct']}%")
        print()

    _print_section("5. Field Coverage Differences")
    if fd["only_in_legacy"]:
        print(f"  Fields present only in legacy:\n    {', '.join(fd['only_in_legacy'])}")
    if fd["only_in_v2"]:
        print(f"\n  Fields present only in v2:\n    {', '.join(fd['only_in_v2'])}")
    if fd["coverage_delta"]:
        print("\n  Fields with >15pp coverage difference (same name, very different fill rate):")
        for f, d in fd["coverage_delta"].items():
            print(f"    {f:<35} legacy={d['legacy_pct']}%  v2={d['v2_pct']}%")

    _print_section("6. Missing Required Fields")
    if legacy["missing_required"]:
        print(f"  Legacy: {legacy['missing_required']}")
    else:
        print("  Legacy: all required fields present in sample")
    if v2["missing_required"]:
        print(f"  V2:     {v2['missing_required']}", end="")
        print("  ← WARN" if v2["missing_required"] else "")
    else:
        print("  V2:     all required fields present in sample")

    _print_section("7. Index Inventory")
    print(f"  Legacy ({LEGACY_COLL}):")
    for idx in legacy["indexes"]:
        print(f"    {idx.get('name')}: key={idx.get('key')}  unique={idx.get('unique', False)}")
    print(f"\n  V2 ({V2_COLL}):")
    for idx in v2["indexes"]:
        print(f"    {idx.get('name')}: key={idx.get('key')}  unique={idx.get('unique', False)}  sparse={idx.get('sparse', False)}")

    if verbose and legacy["sample"]:
        _print_section("8. Sample Records")
        print(f"  Legacy doc (1 of {legacy['sample_size']}):")
        print(json.dumps(_safe_json(_scrub(legacy["sample"][0])), indent=4))
        if v2["sample"]:
            print(f"\n  V2 doc (1 of {v2['sample_size']}):")
            print(json.dumps(_safe_json(_scrub(v2["sample"][0])), indent=4))

    _print_section("9. Migration Recommendation")
    print(_recommend(legacy, v2, overlap))


# ── Main ────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Read-only analysis of Galveston legacy→v2 migration readiness",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--limit", type=int, default=500,
                    help="Max docs to sample from each collection (default: 500)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Show what would be analyzed; no MongoDB connection")
    ap.add_argument("--verbose", action="store_true",
                    help="Print sample records")
    ap.add_argument("--json", dest="emit_json", action="store_true",
                    help="Emit results as JSON to stdout")
    args = ap.parse_args()

    if args.dry_run:
        print("[galveston-migration] DRY RUN — no MongoDB connection")
        print(f"  Would analyze: {LEGACY_COLL}  vs  {V2_COLL}")
        print(f"  Sample limit:  {args.limit} docs per collection")
        print("\n  Overlap strategies:")
        for s in ["booking_number", "jacket_number", "url_hash (sha1[:12])", "name_url"]:
            print(f"    {s}")
        return 0

    # Connect
    try:
        from storage.mongo_client import get_db  # noqa: PLC0415
        db = get_db()
    except Exception as exc:
        print(f"[galveston-migration] ERROR: MongoDB connection failed: {exc}", file=sys.stderr)
        return 2

    print(f"[galveston-migration] Profiling collections (limit={args.limit})…")

    legacy = _profile_collection(db, LEGACY_COLL, args.limit, LEGACY_REQUIRED)
    v2     = _profile_collection(db, V2_COLL, args.limit, V2_REQUIRED)

    print(f"  legacy: {legacy['total']:,} docs (sampled {legacy['sample_size']})")
    print(f"  v2:     {v2['total']:,} docs (sampled {v2['sample_size']})")

    legacy_sets = _build_legacy_keysets(legacy["sample"])
    v2_sets     = _build_v2_keysets(v2["sample"])

    overlap = _analyze_overlap(
        legacy_sets, v2_sets,
        legacy["total"], v2["total"],
        legacy["sample_size"], v2["sample_size"],
    )

    fd = _field_diff(legacy["field_coverage"], v2["field_coverage"])

    _print_report(legacy, v2, overlap, fd, args.verbose)

    if args.emit_json:
        out = {
            "legacy": {k: v for k, v in legacy.items() if k not in ("sample", "indexes")},
            "v2": {k: v for k, v in v2.items() if k not in ("sample", "indexes")},
            "overlap": overlap,
            "field_diff": fd,
        }
        print(json.dumps(_safe_json(out), indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
