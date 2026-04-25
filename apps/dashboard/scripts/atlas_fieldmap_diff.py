#!/usr/bin/env python3
"""
Field Map Diff: Sources vs Simple (Atlas)
-----------------------------------------
Pulls field names (keys) from your *source/origination* collections and from the
*simple/normalized* collections, then produces a side-by-side diff report to
verify that your normalizer maps fields correctly.

Usage examples:
  export MONGO_URI="mongodb+srv://..."
  export MONGO_DB="warrantdb"
  cd scripts

  # Use default source→simple pairs and write a dated report under debug_reports/
  python3 atlas_fieldmap_diff.py --diff

  # Custom pairs and sizes, write to a specific path
  python3 atlas_fieldmap_diff.py --diff \
      --pairs "galveston_events:simple_galveston,jefferson_events:simple_jefferson,harris_bond:simple_harris,harris_misfel:simple_harris,harris_nafiling:simple_harris,brazoria_inmates:simple_brazoria,fortbend_inmates:simple_fortbend" \
      --sample 1500 --report ./debug_reports/fieldmap_diff.txt
"""
import argparse
import datetime as dt
import os
from typing import Any, Dict, Iterable, List

from pymongo import MongoClient
from pymongo.collection import Collection

# ---------- Shared helpers ----------

def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def sample_documents(coll: Collection, sample: int) -> List[Dict[str, Any]]:
    try:
        pipeline = [{"$sample": {"size": sample}}]
        return list(coll.aggregate(pipeline, allowDiskUse=True))
    except Exception:
        return list(coll.find({}).limit(sample))

def flatten_keys(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    out = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            out.update(flatten_keys(v, key))
        else:
            out[key] = v
    return out

# ---------- Defaults & expectations ----------

# Default pairing from source → simple (override with --pairs).
DEFAULT_PAIRS = [
    ("brazoria_inmates", "simple_brazoria"),
    ("fortbend_inmates", "simple_fortbend"),
    ("galveston_events", "simple_galveston"),
    ("jefferson_events", "simple_jefferson"),
    ("harris_bond", "simple_harris"),
    ("harris_misfel", "simple_harris"),
    ("harris_nafiling", "simple_harris"),
]

# Keys we *expect* in simple_* (dashboard contract). Used only for hints.
EXPECTED_SIMPLE_KEYS = {
    "name", "first_name", "last_name", "full_name",
    "offense", "charges", "bond_amount", "bond_total", "total_bond",
    "booking_date", "booking_date_iso", "booked_at", "arrest_date",
    "agency", "facility", "county", "status", "race", "sex",
    "time_bucket", "booking_priority", "booking_age_category",
    "source", "source_url", "scraped_at", "first_seen_at", "updated_at",
}

# ---------- Core ----------

def collect_field_set(coll: Collection, sample: int = 1000) -> set:
    docs = sample_documents(coll, sample)
    keys = set()
    for d in docs:
        keys.update(flatten_keys(d).keys())
    return keys

def parse_pairs_arg(pairs_str: str) -> list:
    pairs = []
    for item in pairs_str.split(","):
        if not item.strip():
            continue
        if ":" not in item:
            raise ValueError("--pairs items must be in form 'source:simple'")
        src, dst = item.split(":", 1)
        pairs.append((src.strip(), dst.strip()))
    return pairs

def write_fieldmap_diff(db, pairs: list, report_path: str, sample: int):
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# Field Map Diff (Sources vs Simple)\nGenerated: {utcnow_iso()}\nDB: {db.name}\n\n")
        names = set(db.list_collection_names())
        for src_name, simple_name in pairs:
            f.write(f"Pair: {src_name}  →  {simple_name}\n")
            if src_name not in names:
                f.write(f"  - WARN: source collection not found: {src_name}\n\n")
                continue
            if simple_name not in names:
                f.write(f"  - WARN: simple collection not found: {simple_name}\n\n")
                continue

            src_keys = collect_field_set(db[src_name], sample)
            dst_keys = collect_field_set(db[simple_name], sample)

            norm = lambda s: s.lower().strip()
            src_norm = {norm(k) for k in src_keys}
            dst_norm = {norm(k) for k in dst_keys}

            missing_in_simple = sorted(k for k in src_keys if norm(k) not in dst_norm)
            unused_in_simple  = sorted(k for k in dst_keys if norm(k) not in src_norm)

            f.write(f"  Source fields (sample-based, {len(src_keys)}):\n")
            for k in sorted(src_keys):
                f.write(f"    - {k}\n")

            f.write(f"\n  Simple fields (sample-based, {len(dst_keys)}):\n")
            for k in sorted(dst_keys):
                f.write(f"    - {k}\n")

            f.write("\n  Fields present in source but MISSING in simple (candidate mappings needed):\n")
            if not missing_in_simple:
                f.write("    (none)\n")
            else:
                for k in missing_in_simple:
                    # quick heuristic rename hints
                    hint = ""
                    lk = k.lower()
                    if lk in {"total_bond", "bond_total"}:
                        hint = " → map to simple.bond_amount (or simple.total_bond)"
                    elif lk in {"booked_at", "booking_date", "booking_date_iso", "arrest_date"}:
                        hint = " → map to simple.booking_date (ISO)"
                    elif lk in {"charges", "offense", "charges_summary"}:
                        hint = " → map to simple.offense (primary) and simple.charges (list)"
                    elif lk in {"agency", "arresting_agency"}:
                        hint = " → map to simple.agency"
                    elif lk in {"sex", "sex_code", "race", "race_code"}:
                        hint = " → map to simple.sex / simple.race"
                    f.write(f"    - {k}{hint}\n")

            f.write("\n  Fields present in simple but NOT found in source (verify normalizer/input):\n")
            if not unused_in_simple:
                f.write("    (none)\n")
            else:
                for k in unused_in_simple:
                    star = " *EXPECTED*" if k in EXPECTED_SIMPLE_KEYS else ""
                    f.write(f"    - {k}{star}\n")

            f.write("\n" + ("-" * 80) + "\n\n")
    print(f"Wrote field map diff → {report_path}")

# ---------- CLI ----------

def main():
    parser = argparse.ArgumentParser(description="Field map diff between source collections and simple collections.")
    parser.add_argument("--uri", default=os.getenv("MONGO_URI"), help="MongoDB connection string")
    parser.add_argument("--db",  default=os.getenv("MONGO_DB"), help="Database name")
    parser.add_argument("--sample", type=int, default=1000, help="Sample size per collection")
    parser.add_argument("--report", default=None, help="Path to TXT report (default: ./debug_reports/fieldmap_diff_YYYYmmdd_HHMM.txt)")
    parser.add_argument("--diff", action="store_true", help="Run the diff (if omitted, this script exits after parsing args).")
    parser.add_argument("--pairs", default=None, help="Comma-separated source:simple pairs. If omitted, DEFAULT_PAIRS is used.")
    args = parser.parse_args()

    if not args.diff:
        print("Nothing to do. Pass --diff to run the comparison.")
        return

    if not args.uri or not args.db:
        raise SystemExit("Error: provide --uri and --db or set MONGO_URI and MONGO_DB env vars.")

    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M")
    report_path = args.report or os.path.join("debug_reports", f"fieldmap_diff_{ts}.txt")

    client = MongoClient(args.uri, tz_aware=True)
    db = client[args.db]

    pairs = parse_pairs_arg(args.pairs) if args.pairs else DEFAULT_PAIRS
    write_fieldmap_diff(db, pairs, report_path, args.sample)

if __name__ == "__main__":
    main()
