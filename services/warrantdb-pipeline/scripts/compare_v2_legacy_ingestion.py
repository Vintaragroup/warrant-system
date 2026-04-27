"""
scripts/compare_v2_legacy_ingestion.py
───────────────────────────────────────────────────────────────────────────────
Read-only comparison between v2 staging collections and legacy production
collections.  Never writes to MongoDB.

Reports per source:
  • document counts (v2 vs legacy)
  • latest timestamps
  • sample records (v2 and legacy side-by-side)
  • field coverage differences (fields present in v2 but not legacy, and vice-versa)
  • duplicate rate (records sharing the same upsert key)
  • missing key fields (null/absent on required fields)
  • cross-collection match rate (records in v2 but not legacy, and vice-versa)

Usage
─────
  python3 scripts/compare_v2_legacy_ingestion.py --source galveston --limit 100
  python3 scripts/compare_v2_legacy_ingestion.py --source harris   --limit 100
  python3 scripts/compare_v2_legacy_ingestion.py --source lookups  --limit 100
  python3 scripts/compare_v2_legacy_ingestion.py --source all      --limit 25
  python3 scripts/compare_v2_legacy_ingestion.py --dry-run

Options
───────
  --source {galveston,harris,lookups,all}   Which source to compare (default: all)
  --limit N                                  Max docs to sample from each collection (default: 50)
  --dry-run                                  Show what would be compared; no MongoDB connection
  --json                                     Emit results as JSON to stdout
  --verbose                                  Print individual sample records
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple


# ── Collection pairs ───────────────────────────────────────────────────────────

# Each entry: (label, v2_collection, legacy_collections, v2_key_fields, legacy_key_fields)
# key_fields: used for cross-match and duplicate detection
_SOURCES: Dict[str, List[Tuple[str, str, List[str], List[str], List[str]]]] = {
    "galveston": [
        (
            "Galveston events",
            "v2_galveston_events",
            ["galveston_events"],
            ["county", "booking_number"],         # v2 upsert key
            ["county", "booking_number"],          # legacy (persons-routed, best match)
        ),
    ],
    "harris": [
        (
            "Harris bond",
            "v2_harris_reports",
            ["harris_bond"],
            ["county", "source", "kind", "case_number"],
            ["spn", "case_number", "group"],
        ),
        (
            "Harris misfel",
            "v2_harris_reports",
            ["harris_misfel"],
            ["county", "source", "kind", "case_number"],
            ["spn", "case_number", "group"],
        ),
        (
            "Harris nafiling",
            "v2_harris_reports",
            ["harris_nafiling"],
            ["county", "source", "kind", "case_number"],
            ["spn", "case_number", "group"],
        ),
    ],
    "lookups": [
        (
            "Brazoria lookup",
            "v2_lookup_results",
            ["brazoria_inmates"],
            ["county", "source", "booking_number"],
            ["booking_number"],
        ),
        (
            "Fort Bend lookup",
            "v2_lookup_results",
            ["fortbend_inmates"],
            ["county", "source", "booking_number"],
            ["booking_number"],
        ),
        (
            "Jefferson lookup",
            "v2_lookup_results",
            ["jefferson_events"],
            ["county", "source", "booking_number"],
            ["booking_number"],
        ),
    ],
}

# Core fields that MUST be present and non-null in a healthy record
_REQUIRED_V2_FIELDS: Dict[str, List[str]] = {
    "v2_galveston_events": [
        "full_name", "county", "source", "scraped_at", "booking_number",
    ],
    "v2_harris_reports": [
        "full_name", "county", "source", "kind", "scraped_at", "observed_at",
        "case_number",
    ],
    "v2_lookup_results": [
        "full_name", "county", "source", "scraped_at", "booking_number",
    ],
}

_REQUIRED_LEGACY_FIELDS: Dict[str, List[str]] = {
    "galveston_events": ["county", "booking_number", "scraped_at"],
    "harris_bond":      ["spn", "case_number", "group", "scraped_at"],
    "harris_misfel":    ["spn", "case_number", "group", "scraped_at"],
    "harris_nafiling":  ["spn", "case_number", "group", "scraped_at"],
    "brazoria_inmates": ["booking_number", "scraped_at"],
    "fortbend_inmates": ["booking_number", "scraped_at"],
    "jefferson_events": ["county", "scraped_at"],
}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_ts(v: Any) -> Optional[datetime]:
    """Coerce a stored timestamp (str ISO, datetime, None) to aware datetime."""
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
    m = int((delta.total_seconds() % 3600) // 60)
    if h >= 24:
        return f"{h // 24}d {h % 24}h ago"
    if h > 0:
        return f"{h}h {m}m ago"
    return f"{m}m ago"


def _flatten_keys(doc: Dict[str, Any], prefix: str = "") -> Set[str]:
    """Return the set of all top-level field names (not recursing into arrays)."""
    keys: Set[str] = set()
    for k, v in doc.items():
        if k.startswith("_"):
            continue
        full = f"{prefix}{k}"
        keys.add(full)
    return keys


def _key_tuple(doc: Dict[str, Any], fields: List[str]) -> Optional[tuple]:
    vals = [str(doc.get(f, "")) for f in fields]
    if all(v == "" or v == "None" for v in vals):
        return None
    return tuple(vals)


def _scrub(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Remove _id and internal fields for display."""
    return {k: v for k, v in doc.items() if k not in ("_id",)}


def _safe_json(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe_json(i) for i in obj]
    return obj


# ── Per-collection analysis ────────────────────────────────────────────────────

def _analyze_collection(
    db,
    coll_name: str,
    key_fields: List[str],
    required_fields: List[str],
    limit: int,
    county_filter: Optional[str] = None,
    kind_filter: Optional[str] = None,
) -> Dict[str, Any]:
    coll = db[coll_name]

    query: Dict[str, Any] = {}
    if county_filter:
        query["county"] = county_filter
    if kind_filter:
        query["kind"] = kind_filter

    total_count = coll.count_documents(query)

    # Latest scraped_at / ingested_at
    ts_field = "ingested_at" if coll_name.startswith("v2_") else "scraped_at"
    latest_doc = coll.find_one(
        {**query, ts_field: {"$exists": True}},
        sort=[(ts_field, -1)],
        projection={ts_field: 1},
    )
    latest_ts = _parse_ts(latest_doc.get(ts_field)) if latest_doc else None

    # Sample docs
    sample_docs: List[Dict[str, Any]] = list(
        coll.find(query, {"_id": 0}).sort(ts_field, -1).limit(limit)
    )

    # Field coverage: union of all keys in sample
    all_fields: Counter = Counter()
    for doc in sample_docs:
        for k in _flatten_keys(doc):
            all_fields[k] += 1

    field_coverage = {
        k: round(c / max(len(sample_docs), 1) * 100, 1)
        for k, c in all_fields.items()
    }

    # Required field missing rate
    missing: Dict[str, int] = {}
    for f in required_fields:
        missing_count = sum(1 for d in sample_docs if not d.get(f))
        if missing_count:
            missing[f] = missing_count

    # Duplicate detection
    key_counter: Counter = Counter()
    for doc in sample_docs:
        kt = _key_tuple(doc, key_fields)
        if kt is not None:
            key_counter[kt] += 1
    dup_keys = {str(k): v for k, v in key_counter.items() if v > 1}
    dup_rate = len(dup_keys) / max(len(key_counter), 1)

    # Key set for cross-match
    keyset: Set[tuple] = set()
    for doc in sample_docs:
        kt = _key_tuple(doc, key_fields)
        if kt:
            keyset.add(kt)

    return {
        "collection": coll_name,
        "total_count": total_count,
        "sample_size": len(sample_docs),
        "latest_ts": latest_ts,
        "ts_field": ts_field,
        "field_coverage": field_coverage,
        "missing_required": missing,
        "dup_keys": dup_keys,
        "dup_rate": round(dup_rate * 100, 2),
        "keyset": keyset,
        "sample_docs": sample_docs[:3],  # keep 3 for display
    }


# ── Cross-match ────────────────────────────────────────────────────────────────

def _cross_match(
    v2_result: Dict[str, Any],
    legacy_result: Dict[str, Any],
    v2_key_fields: List[str],
    legacy_key_fields: List[str],
) -> Dict[str, Any]:
    """
    Compare keysets from v2 and legacy samples.
    Note: Key fields may differ between v2 and legacy, so this is a best-effort
    match based on the fields available.  For Galveston and lookups the keys map
    1:1.  For Harris the v2 key includes 'kind' which legacy does not — compare
    on the common subset (case_number / booking_number).
    """
    # Find common logical key: prefer booking_number or case_number
    common_v2 = v2_key_fields
    common_lg = legacy_key_fields

    # Reduce to smallest common denominator
    v2_common_idx = [i for i, f in enumerate(common_v2) if f in ("booking_number", "case_number", "spn")]
    lg_common_idx = [i for i, f in enumerate(common_lg) if f in ("booking_number", "case_number", "spn")]

    v2_keys = v2_result["keyset"]
    lg_keys = legacy_result["keyset"]

    if v2_common_idx and lg_common_idx:
        # Project both keysets to the common field
        v2_proj = {k[v2_common_idx[0]] for k in v2_keys if k}
        lg_proj = {k[lg_common_idx[0]] for k in lg_keys if k}
    else:
        # Fall back to full key tuple comparison (may miss cross-format)
        v2_proj = {str(k) for k in v2_keys}
        lg_proj = {str(k) for k in lg_keys}

    only_v2 = v2_proj - lg_proj
    only_legacy = lg_proj - v2_proj
    in_both = v2_proj & lg_proj

    total_union = len(only_v2) + len(only_legacy) + len(in_both)
    match_rate = round(len(in_both) / max(total_union, 1) * 100, 1)

    return {
        "only_v2_count": len(only_v2),
        "only_legacy_count": len(only_legacy),
        "in_both_count": len(in_both),
        "match_rate_pct": match_rate,
        "only_v2_examples": sorted(only_v2)[:5],
        "only_legacy_examples": sorted(only_legacy)[:5],
        "note": (
            "Keys projected to common field (booking_number/case_number/spn). "
            "Cross-collection match is sampled, not exhaustive."
        ),
    }


# ── Field diff ─────────────────────────────────────────────────────────────────

def _field_diff(
    v2_cov: Dict[str, float],
    lg_cov: Dict[str, float],
) -> Dict[str, Any]:
    v2_fields = set(v2_cov)
    lg_fields = set(lg_cov)
    only_v2 = sorted(v2_fields - lg_fields)
    only_legacy = sorted(lg_fields - v2_fields)
    # Fields present in both but with notably different coverage
    coverage_delta = {
        f: {"v2_pct": v2_cov[f], "legacy_pct": lg_cov[f]}
        for f in v2_fields & lg_fields
        if abs(v2_cov.get(f, 0) - lg_cov.get(f, 0)) > 20
    }
    return {
        "only_in_v2": only_v2,
        "only_in_legacy": only_legacy,
        "coverage_delta": coverage_delta,
    }


# ── Output formatting ──────────────────────────────────────────────────────────

_SEP = "─" * 72


def _print_header(title: str) -> None:
    print(f"\n{_SEP}")
    print(f"  {title}")
    print(_SEP)


def _print_summary_row(label: str, value: Any, warn: bool = False) -> None:
    tag = "  WARN " if warn else "       "
    print(f"{tag}{label:<45} {value}")


def _print_comparison(
    label: str,
    v2: Dict[str, Any],
    legacy_list: List[Dict[str, Any]],
    v2_key_fields: List[str],
    legacy_key_fields: List[str],
    verbose: bool,
) -> Dict[str, Any]:
    _print_header(label)

    print(f"\n  V2  ({v2['collection']})")
    _print_summary_row("Total documents", f"{v2['total_count']:,}")
    _print_summary_row("Sample size", v2["sample_size"])
    _print_summary_row(
        f"Latest {v2['ts_field']}",
        f"{v2['latest_ts'].isoformat() if v2['latest_ts'] else 'none'}  [{_age_str(v2['latest_ts'])}]",
        warn=(v2["latest_ts"] is None),
    )
    _print_summary_row(
        "Missing required fields",
        v2["missing_required"] or "none",
        warn=bool(v2["missing_required"]),
    )
    _print_summary_row(
        "Duplicate key rate",
        f"{v2['dup_rate']}%",
        warn=v2["dup_rate"] > 1,
    )

    for lg in legacy_list:
        print(f"\n  Legacy  ({lg['collection']})")
        _print_summary_row("Total documents", f"{lg['total_count']:,}")
        _print_summary_row("Sample size", lg["sample_size"])
        _print_summary_row(
            f"Latest {lg['ts_field']}",
            f"{lg['latest_ts'].isoformat() if lg['latest_ts'] else 'none'}  [{_age_str(lg['latest_ts'])}]",
            warn=(lg["latest_ts"] is None),
        )
        _print_summary_row(
            "Missing required fields",
            lg["missing_required"] or "none",
            warn=bool(lg["missing_required"]),
        )
        _print_summary_row(
            "Duplicate key rate",
            f"{lg['dup_rate']}%",
            warn=lg["dup_rate"] > 1,
        )

        # Cross-match
        xm = _cross_match(v2, lg, v2_key_fields, legacy_key_fields)
        print(f"\n  Cross-match (sample, {lg['collection']}→{v2['collection']})")
        _print_summary_row("Match rate (sampled)", f"{xm['match_rate_pct']}%")
        _print_summary_row("In both", xm["in_both_count"])
        _print_summary_row(
            "Only in v2 (not in legacy sample)",
            f"{xm['only_v2_count']}  ex: {xm['only_v2_examples'][:3]}",
            warn=xm["only_v2_count"] > 0,
        )
        _print_summary_row(
            "Only in legacy (not in v2 sample)",
            f"{xm['only_legacy_count']}  ex: {xm['only_legacy_examples'][:3]}",
            warn=xm["only_legacy_count"] > 0,
        )

        # Field diff
        fd = _field_diff(v2["field_coverage"], lg["field_coverage"])
        if fd["only_in_v2"]:
            print(f"\n  Fields only in v2:       {', '.join(fd['only_in_v2'])}")
        if fd["only_in_legacy"]:
            print(f"  Fields only in legacy:   {', '.join(fd['only_in_legacy'])}")
        if fd["coverage_delta"]:
            print("  Coverage delta (>20pp):")
            for f, d in fd["coverage_delta"].items():
                print(f"    {f:<35} v2={d['v2_pct']}%  legacy={d['legacy_pct']}%")

    if verbose and v2["sample_docs"]:
        print(f"\n  Sample v2 record ({v2['collection']}):")
        print(json.dumps(_safe_json(_scrub(v2["sample_docs"][0])), indent=4))
        if legacy_list and legacy_list[0]["sample_docs"]:
            print(f"\n  Sample legacy record ({legacy_list[0]['collection']}):")
            print(json.dumps(_safe_json(_scrub(legacy_list[0]["sample_docs"][0])), indent=4))

    return {
        "label": label,
        "v2": {
            k: v
            for k, v in v2.items()
            if k not in ("keyset", "sample_docs")
        },
        "legacy": [
            {k: v for k, v in lg.items() if k not in ("keyset", "sample_docs")}
            for lg in legacy_list
        ],
    }


# ── Main ────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description="Compare v2 staging collections against legacy production collections (read-only)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--source",
        choices=["galveston", "harris", "lookups", "all"],
        default="all",
        help="Which source to compare (default: all)",
    )
    ap.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Max docs to sample from each collection (default: 50)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be compared; no MongoDB connection",
    )
    ap.add_argument(
        "--json",
        dest="emit_json",
        action="store_true",
        default=False,
        help="Emit results as JSON to stdout",
    )
    ap.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Print sample records",
    )
    args = ap.parse_args()

    sources_to_run = (
        list(_SOURCES.keys()) if args.source == "all" else [args.source]
    )
    # Flatten to unique collection pairs for display
    all_pairs = [pair for src in sources_to_run for pair in _SOURCES[src]]

    if args.dry_run:
        print(f"[compare-v2] DRY RUN — no MongoDB connection")
        print(f"  source={args.source}  limit={args.limit}\n")
        print("  Comparisons that would be run:")
        for label, v2_coll, legacy_colls, v2_kf, lg_kf in all_pairs:
            print(f"    {label}")
            print(f"      v2:     {v2_coll}")
            print(f"      legacy: {', '.join(legacy_colls)}")
        return 0

    # Connect
    try:
        from storage.mongo_client import get_db  # noqa: PLC0415
        db = get_db()
    except Exception as exc:
        print(f"[compare-v2] ERROR: MongoDB connection failed: {exc}", file=sys.stderr)
        return 2

    print(f"[compare-v2] source={args.source}  limit={args.limit}  {_utcnow().strftime('%Y-%m-%d %H:%M UTC')}")

    all_results: List[Dict[str, Any]] = []

    for label, v2_coll, legacy_colls, v2_kf, lg_kf in all_pairs:
        # Determine filters for v2 when multiple legacy sources share a v2 collection
        county_filter: Optional[str] = None
        kind_filter: Optional[str] = None

        if v2_coll == "v2_harris_reports":
            # Each Harris kind is a separate legacy collection
            kind_map = {
                "harris_bond": "bond",
                "harris_misfel": "misfel",
                "harris_nafiling": "nafiling",
            }
            kind_filter = kind_map.get(legacy_colls[0])

        if v2_coll == "v2_lookup_results":
            county_map = {
                "brazoria_inmates": "brazoria",
                "fortbend_inmates": "fortbend",
                "jefferson_events": "jefferson",
            }
            county_filter = county_map.get(legacy_colls[0])

        v2_result = _analyze_collection(
            db, v2_coll, v2_kf,
            _REQUIRED_V2_FIELDS.get(v2_coll, []),
            args.limit,
            county_filter=county_filter,
            kind_filter=kind_filter,
        )

        legacy_results: List[Dict[str, Any]] = []
        for lg_coll in legacy_colls:
            lg_result = _analyze_collection(
                db, lg_coll, lg_kf,
                _REQUIRED_LEGACY_FIELDS.get(lg_coll, []),
                args.limit,
            )
            legacy_results.append(lg_result)

        result = _print_comparison(
            label, v2_result, legacy_results, v2_kf, lg_kf, args.verbose
        )
        all_results.append(result)

    if args.emit_json:
        print(json.dumps(_safe_json(all_results), indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
