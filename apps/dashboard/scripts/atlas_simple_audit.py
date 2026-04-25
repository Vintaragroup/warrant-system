#!/usr/bin/env python3
"""
Atlas Simple Collections Auditor
--------------------------------
Scans MongoDB collections named "simple_*" and writes a concise TXT report
so you can quickly see what fields exist, how complete they are, and whether
key values (county, time_bucket, booking_date, bond_amount, etc.) look right.

Usage:
  python atlas_simple_audit.py \
      --uri "mongodb+srv://.../"
      --db warrantdb \
      --sample 1000 \
      --report ./debug_reports/simple_audit.txt

Environment variables (fallbacks):
  MONGO_URI, MONGO_DB

Notes:
- Designed for your normalized "simple_*" collections (simple_harris, simple_galveston, etc.)
- Computes field coverage, basic type distribution, top value counts for categorical fields,
  date ranges for booking_date, and quick stats for numeric fields like bond_amount.
"""

import argparse
import collections
import datetime as dt
import json
import math
import os
import re
import statistics
from typing import Any, Dict, List, Tuple, Iterable

from pymongo import MongoClient
from pymongo.collection import Collection

# ---------- Helpers ----------

def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not (isinstance(x, float) and math.isnan(x))

def is_date_like(x: Any) -> bool:
    return isinstance(x, (dt.datetime,))  # Mongo returns datetime for date fields

def sample_documents(coll: Collection, sample: int) -> List[Dict[str, Any]]:
    # Prefer $sample if large collections; fallback to limit if small
    try:
        pipeline = [{"$sample": {"size": sample}}]
        return list(coll.aggregate(pipeline, allowDiskUse=True))
    except Exception:
        return list(coll.find({}).limit(sample))

def type_name(x: Any) -> str:
    if x is None:
        return "null"
    if isinstance(x, bool):
        return "bool"
    if isinstance(x, int):
        return "int"
    if isinstance(x, float):
        return "float"
    if isinstance(x, str):
        return "str"
    if isinstance(x, dt.datetime):
        return "datetime"
    if isinstance(x, list):
        return "list"
    if isinstance(x, dict):
        return "dict"
    return type(x).__name__

def explode_seq(seq: Iterable[Any]) -> Iterable[Any]:
    """Yield scalar items from a sequence where elements may be scalars or lists."""
    for v in seq:
        if isinstance(v, list):
            for item in v:
                yield item
        else:
            yield v

def flatten_keys(d: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """Flattens one level of nested dicts into dotted keys; lists remain intact."""
    out = {}
    for k, v in d.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            sub = flatten_keys(v, key)
            out.update(sub)
        else:
            out[key] = v
    return out

def safe_preview(val: Any, maxlen: int = 120) -> str:
    try:
        s = json.dumps(val, default=str, ensure_ascii=False)
    except Exception:
        s = str(val)
    if len(s) > maxlen:
        s = s[: maxlen - 3] + "..."
    return s

def numeric_stats(values: List[float]) -> Dict[str, Any]:
    values = [v for v in values if is_number(v)]
    if not values:
        return {}
    return {
        "count": len(values),
        "min": min(values),
        "p25": statistics.quantiles(values, n=4, method="inclusive")[0] if len(values) >= 4 else min(values),
        "median": statistics.median(values),
        "p75": statistics.quantiles(values, n=4, method="inclusive")[2] if len(values) >= 4 else max(values),
        "max": max(values),
        "mean": statistics.fmean(values),
    }

def daterange(values: List[dt.datetime]) -> Dict[str, Any]:
    values = [v for v in values if is_date_like(v)]
    if not values:
        return {}
    return {"min": min(values).isoformat(), "max": max(values).isoformat()}

def top_counts(values: List[Any], topn: int = 10) -> List[Tuple[str, int]]:
    c = collections.Counter()
    for v in explode_seq(values):
        if v is None:
            continue
        key = safe_preview(v, 80)
        c[key] += 1
    return c.most_common(topn)

# ---------- Analysis ----------

KEY_FIELDS = [
    "county",
    "category",
    "full_name",
    "first_name",
    "last_name",
    "booking_date",
    "offense",
    "charge",
    "bond_amount",
    "case_number",
    "spn",
    "source",
    "time_bucket",
]

CATEGORICAL_HINTS = set(["county", "category", "offense", "charge", "source", "time_bucket"])
NUMERIC_HINTS = set(["bond_amount"])
DATETIME_HINTS = set(["booking_date", "filed_date", "dob", "date_of_birth"])  # extend as needed

def analyze_collection(coll: Collection, sample_size: int, max_examples: int = 5) -> str:
    total_docs = coll.estimated_document_count()
    docs = sample_documents(coll, sample_size if sample_size else min(1000, total_docs))
    flat_docs = [flatten_keys(d) for d in docs]

    # Gather per-field stats
    field_keys = set()
    for d in flat_docs:
        field_keys.update(d.keys())

    field_stats = {}
    for k in sorted(field_keys):
        values = [d.get(k, None) for d in flat_docs]
        present = sum(v is not None for v in values)
        types = collections.Counter(type_name(v) for v in values if v is not None)
        examples = [safe_preview(v) for v in values if v is not None][:max_examples]
        entry = {
            "present_pct": 0 if not docs else round(100 * present / len(docs), 1),
            "types": dict(types),
            "examples": examples,
        }
        # Numeric stats
        if k in NUMERIC_HINTS or all((is_number(v) or isinstance(v, list) or v is None) for v in values):
            nums = [float(v) for v in explode_seq(values) if is_number(v)]
            ns = numeric_stats(nums)
            if ns:
                entry["numeric"] = ns
        # Date ranges
        if k in DATETIME_HINTS or any(is_date_like(v) for v in explode_seq(values) if v is not None):
            dates = [v for v in explode_seq(values) if is_date_like(v)]
            dr = daterange(dates)
            if dr:
                entry["dates"] = dr
        # Top counts for likely categorical small-cardinality fields (handle lists)
        distinct_vals = set(safe_preview(v, 80) for v in explode_seq(values) if v is not None)
        if k in CATEGORICAL_HINTS or (0 < len(distinct_vals) <= 50):
            entry["top_counts"] = top_counts(values, 10)
        field_stats[k] = entry

    # Quick dashboards
    county_vals = list(explode_seq([d.get("county") for d in flat_docs]))
    time_buckets = list(explode_seq([d.get("time_bucket") for d in flat_docs]))
    booking_dates = [v for v in explode_seq([d.get("booking_date") for d in flat_docs]) if is_date_like(v)]
    offenses = [v for v in explode_seq([d.get("offense") for d in flat_docs]) if v is not None]
    charges = [v for v in explode_seq([d.get("charge") for d in flat_docs]) if v is not None]
    bonds = [v for v in explode_seq([d.get("bond_amount") for d in flat_docs]) if is_number(v)]

    lines = []
    lines.append(f"Collection: {coll.name}")
    lines.append(f"Total docs (est.): {total_docs:,}")
    lines.append(f"Sample analyzed: {len(docs):,}")
    lines.append("")

    # KPI-style summaries
    def fmt_counts(title: str, arr: List[Any]):
        tc = top_counts(arr, 10)
        if not tc:
            lines.append(f"{title}: (no data)")
            return
        lines.append(f"{title}:")
        for v, c in tc:
            lines.append(f"  - {v}: {c}")
        lines.append("")

    fmt_counts("Top counties", county_vals)
    fmt_counts("Top time_buckets", time_buckets)
    fmt_counts("Top offenses", offenses or charges)

    # Bond stats
    if bonds:
        ns = numeric_stats(bonds)
        lines.append("Bond Amount (numeric) stats:")
        for k, v in ns.items():
            if isinstance(v, float):
                lines.append(f"  {k:>6}: {v:,.2f}")
            else:
                lines.append(f"  {k:>6}: {v}")
        lines.append("")
    # Booking date range
    if booking_dates:
        dr = daterange(booking_dates)
        lines.append("Booking Date range:")
        lines.append(f"  min: {dr.get('min')}")
        lines.append(f"  max: {dr.get('max')}")
        lines.append("")

    # Required key coverage
    lines.append("Required key coverage:")
    for k in KEY_FIELDS:
        st = field_stats.get(k)
        pct = st.get("present_pct") if st else 0
        lines.append(f"  - {k:12}: {pct:>5}%")
    lines.append("")

    # Detailed field by field (compact)
    lines.append("Field-by-field detail (sample-based):")
    for k in sorted(field_stats.keys()):
        st = field_stats[k]
        lines.append(f"- {k}: present={st['present_pct']}% types={st['types']}")
        if "numeric" in st:
            ns = st["numeric"]
            ns_compact = ", ".join(f"{kk}={ns[kk]:,.2f}" if isinstance(ns[kk], float) else f"{kk}={ns[kk]}" for kk in ["count","min","p25","median","p75","max","mean"] if kk in ns)
            lines.append(f"    numeric: {ns_compact}")
        if "dates" in st:
            dr = st["dates"]
            lines.append(f"    dates: {dr.get('min')} → {dr.get('max')}")
        if "top_counts" in st:
            tops = ", ".join([f"{v}({c})" for v, c in st["top_counts"][:5]])
            lines.append(f"    top_counts: {tops}")
        if st["examples"]:
            ex = "; ".join(st["examples"][:3])
            lines.append(f"    examples: {ex}")
    lines.append("")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Audit MongoDB 'simple_*' collections and write a TXT report.")
    parser.add_argument("--uri", default=os.getenv("MONGO_URI"), help="MongoDB connection string")
    parser.add_argument("--db", default=os.getenv("MONGO_DB"), help="Database name")
    parser.add_argument("--sample", type=int, default=1000, help="Sample size per collection")
    parser.add_argument("--report", default=None, help="Path to TXT report (default: ./debug_reports/simple_audit_YYYYmmdd_HHMM.txt)")
    parser.add_argument("--max-examples", type=int, default=5, help="Max example values to show per field")
    args = parser.parse_args()

    if not args.uri or not args.db:
        raise SystemExit("Error: provide --uri and --db or set MONGO_URI and MONGO_DB env vars.")

    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M")
    report_path = args.report or os.path.join("debug_reports", f"simple_audit_{ts}.txt")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)

    client = MongoClient(args.uri, tz_aware=True)
    db = client[args.db]

    # Find collections that start with "simple_"
    simple_colls = [name for name in db.list_collection_names() if name.startswith("simple_")]
    simple_colls.sort()

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# Simple Collections Audit\nGenerated: {utcnow_iso()}\nDB: {args.db}\nURI: (hidden)\n\n")
        if not simple_colls:
            f.write("No collections matching 'simple_*' were found.\n")
        for name in simple_colls:
            coll = db[name]
            try:
                block = analyze_collection(coll, args.sample, args.max_examples)
            except Exception as e:
                block = f"Collection: {name}\nERROR analyzing collection: {e}\n"
            f.write(block)
            f.write("\n" + "="*80 + "\n\n")

    print(f"Wrote report → {report_path}")


if __name__ == "__main__":
    main()
