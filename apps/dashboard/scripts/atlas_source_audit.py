#!/usr/bin/env python3
"""
Atlas Source Collections Auditor
--------------------------------
Scans specified MongoDB collections (your *scraping/origination* sources) and writes
a concise TXT report so you can quickly see schemas, field coverage, types, and examples.
This helps debug normalization: if the data isn't present or is oddly shaped at the source,
we'll see it immediately.

Default target collections (override with --collections):
- brazoria_inmates
- fortbend_inmates
- galveston_events
- galveston_persons (alias: persons)
- jefferson_events
- harris_bond
- harris_misfel
- harris_nafiling

Usage:
  python atlas_source_audit.py \
      --uri "mongodb+srv://.../" \
      --db warrantdb \
      --sample 1000 \
      --report ./debug_reports/source_audit.txt \
      --collections brazoria_inmates,fortbend_inmates,galveston_events,galveston_persons,jefferson_events,harris_bond,harris_misfel,harris_nafiling

If --collections is omitted, the script will try to audit the defaults that exist in the DB.

Environment variables (fallbacks):
  MONGO_URI, MONGO_DB
"""

import argparse
import collections
import datetime as dt
import json
import math
import os
import statistics
from typing import Any, Dict, List, Tuple, Iterable

from pymongo import MongoClient
from pymongo.collection import Collection

import re
from zoneinfo import ZoneInfo

# ---------- Helpers ----------

def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not (isinstance(x, float) and math.isnan(x))

def is_date_like(x: Any) -> bool:
    return isinstance(x, (dt.datetime,))

def sample_documents(coll: Collection, sample: int) -> List[Dict[str, Any]]:
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
    """Flattens nested dicts into dotted keys; lists remain intact."""
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

# ---------- Derived parsing helpers (dates, money, nested lookups) ----------

CENTRAL_TZ = ZoneInfo("America/Chicago")

DATE_FIELDS_BY_COLLECTION = {
    # raw source collections → candidate booking fields in priority order
    "galveston_events": ["booked_at", "arrest_date", "booking_date"],
    "jefferson_events": ["booked_at", "arrest_date", "booking_date"],
    "brazoria_inmates": ["booking_date_iso", "booking_date", "first_seen_at", "detail_fetched_at"],
    "fortbend_inmates": ["booking_date_iso", "booking_date", "detail_fetched_at", "first_seen_at"],
    "harris_bond":      ["file_date"],
    "harris_nafiling":  ["file_date"],
    "harris_misfel":    ["file_date"],
    "galveston_persons": ["booked_at", "booking_date"],
    "persons": ["booked_at", "booking_date"],
}

BOND_FIELDS_BY_COLLECTION = {
    # try in order; supports dotted paths and arrays (e.g., charges.bail_amount_int)
    "galveston_events": ["total_bond", "bonds.amount"],
    "jefferson_events": ["total_bond", "bonds.amount"],
    "brazoria_inmates": ["bond_total", "charges.bond/type"],
    "fortbend_inmates": ["charges.bail_amount_int", "charges.bail_amount"],
    "harris_bond":      ["bond_amount"],
    "harris_nafiling":  ["bond_amount"],
    "harris_misfel":    ["bond_amount"],
    "galveston_persons": [],
    "persons": [],
}

NUMBER_KEYS = {"$numberInt", "$numberDouble", "$numberLong", "$numberDecimal"}

def _to_datetime(x):
    if x is None:
        return None
    if isinstance(x, dt.datetime):
        # ensure timezone aware
        return x if x.tzinfo else x.replace(tzinfo=dt.timezone.utc)
    if isinstance(x, (int, float)):
        # epoch seconds or ms
        sec = x/1000.0 if x > 1e12 else x
        try:
            return dt.datetime.fromtimestamp(sec, tz=dt.timezone.utc)
        except Exception:
            return None
    s = str(x).strip()
    if not s or s.upper() in {"BLACK", "N/A", "NULL"}:
        return None
    # try common formats
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            d = dt.datetime.strptime(s, fmt)
            return d.replace(tzinfo=dt.timezone.utc)
        except Exception:
            pass
    # ISO with offset
    try:
        d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return None

def _extract_first_numeric(obj):
    # dict with Mongo extended JSON numeric?
    if isinstance(obj, dict):
        for k in NUMBER_KEYS:
            if k in obj:
                try:
                    return float(obj[k])
                except Exception:
                    pass
    # list → try each element
    if isinstance(obj, list):
        for it in obj:
            v = _extract_first_numeric(it)
            if v is not None:
                return v
        return None
    # pure number
    if is_number(obj):
        return float(obj)
    # string with currency or embedded digits
    if isinstance(obj, str):
        m = re.search(r"[-+]?\d[\d,]*\.?\d*", obj)
        if m:
            try:
                return float(m.group(0).replace(",", ""))
            except Exception:
                return None
    return None

def _get_dotted(doc, path):
    """Get a possibly dotted path; supports arrays and returns a list of values when traversing arrays."""
    parts = path.split(".")
    def _walk(obj, idx):
        if obj is None:
            return []
        if idx == len(parts):
            return [obj]
        key = parts[idx]
        if isinstance(obj, list):
            out = []
            for item in obj:
                out.extend(_walk(item, idx))
            return out
        if isinstance(obj, dict) and key in obj:
            return _walk(obj[key], idx+1)
        return []
    return _walk(doc, 0)

def derive_booking_datetime(coll_name: str, doc: Dict[str, Any]) -> dt.datetime|None:
    fields = DATE_FIELDS_BY_COLLECTION.get(coll_name, [])
    for k in fields:
        vals = _get_dotted(doc, k)
        for v in vals:
            d = _to_datetime(v)
            if d:
                return d
    return None

def derive_bond_amount(coll_name: str, doc: Dict[str, Any]) -> float|None:
    fields = BOND_FIELDS_BY_COLLECTION.get(coll_name, [])
    for k in fields:
        vals = _get_dotted(doc, k)
        # If this points at an array (e.g., many charges), sum numeric parts
        numeric_vals = []
        for v in vals:
            n = _extract_first_numeric(v)
            if n is not None:
                numeric_vals.append(n)
        if numeric_vals:
            # For charges.* we sum; for scalar fields this is a single-element sum
            return float(sum(numeric_vals))
    return None

def window_bucket_counts(dates_and_bonds, now=None):
    """dates_and_bonds: iterable of (dt, bond_float_or_None)"""
    if now is None:
        now = dt.datetime.now(CENTRAL_TZ)
    now_utc = now.astimezone(dt.timezone.utc)
    w24 = now_utc - dt.timedelta(hours=24)
    w48 = now_utc - dt.timedelta(hours=48)
    w72 = now_utc - dt.timedelta(hours=72)
    buckets = {
        "24h": {"count": 0, "sum": 0.0},
        "48h": {"count": 0, "sum": 0.0},
        "72h": {"count": 0, "sum": 0.0},
    }
    for d, b in dates_and_bonds:
        if not d:
            continue
        # ensure utc compare
        du = d.astimezone(dt.timezone.utc)
        if du > now_utc:
            continue
        if du >= w24:
            buckets["24h"]["count"] += 1
            buckets["24h"]["sum"] += (b or 0.0)
        elif du >= w48:
            buckets["48h"]["count"] += 1
            buckets["48h"]["sum"] += (b or 0.0)
        elif du >= w72:
            buckets["72h"]["count"] += 1
            buckets["72h"]["sum"] += (b or 0.0)
    return buckets

def money_fmt(n):
    try:
        return f"${n:,.0f}"
    except Exception:
        return "$0"

# ---------- Analysis ----------

# Hints for common field names seen in sources; adapt as you add more connectors.
CATEGORICAL_HINTS = set([
    "county", "category", "facility", "agency", "status", "race", "race_code",
    "sex", "sex_code", "group", "source", "time_bucket", "city", "state"
])
NUMERIC_HINTS = set(["bond_amount", "total_bond", "amount", "fine", "age"])
DATETIME_HINTS = set([
    "booking_date", "booked_at", "release_date", "arrest_date", "file_date",
    "scraped_at", "first_seen_at", "inserted_at", "updated_at", "detail_fetched_at"
])

def analyze_collection(coll: Collection, sample_size: int, max_examples: int = 5) -> str:
    total_docs = coll.estimated_document_count()
    docs = sample_documents(coll, sample_size if sample_size else min(1000, total_docs))
    flat_docs = [flatten_keys(d) for d in docs]

    # Derived booking date + bond coverage (source-aware)
    derived_dates = []
    derived_bonds = []
    missing_date_reasons = collections.Counter()
    for raw in docs:
        ddt = derive_booking_datetime(coll.name, raw)
        if ddt is None:
            # capture a hint about why missing: look for candidate fields and record their type/value shape
            cand = DATE_FIELDS_BY_COLLECTION.get(coll.name, [])
            seen = []
            for c in cand:
                vals = _get_dotted(raw, c)
                if vals:
                    seen.append(type_name(vals[0]))
            if seen:
                missing_date_reasons[",".join(sorted(set(seen)))] += 1
            else:
                missing_date_reasons["no_candidate_field"] += 1
        derived_dates.append(ddt)
        b = derive_bond_amount(coll.name, raw)
        derived_bonds.append(b)

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

    # Quick snapshots for common pivots
    counties = list(explode_seq([d.get("county") for d in flat_docs]))
    agencies = list(explode_seq([d.get("agency") for d in flat_docs]))
    facilities = list(explode_seq([d.get("facility") for d in flat_docs]))
    sources = list(explode_seq([d.get("source") for d in flat_docs]))
    offenses = list(explode_seq([d.get("offense") for d in flat_docs]))
    charges = list(explode_seq([d.get("charge") for d in flat_docs]))
    bonds = [v for v in explode_seq([d.get("bond_amount") for d in flat_docs]) if is_number(v)]
    booking_dates = [v for v in explode_seq([d.get("booking_date") for d in flat_docs]) if is_date_like(v)]
    filed_dates = [v for v in explode_seq([d.get("file_date") for d in flat_docs]) if is_date_like(v)]

    lines = []
    lines.append(f"Collection: {coll.name}")
    lines.append(f"Total docs (est.): {total_docs:,}")
    lines.append(f"Sample analyzed: {len(docs):,}")
    lines.append("")

    def fmt_counts(title: str, arr: List[Any]):
        tc = top_counts(arr, 10)
        if not tc:
            lines.append(f"{title}: (no data)")
            return
        lines.append(f"{title}:")
        for v, c in tc:
            lines.append(f"  - {v}: {c}")
        lines.append("")

    fmt_counts("Top counties", counties)
    fmt_counts("Top agencies", agencies)
    fmt_counts("Top facilities", facilities)
    fmt_counts("Top sources", sources)
    # prefer offense, fallback to charge
    fmt_counts("Top offenses/charges", offenses or charges)

    # Derived coverage section
    total = len(docs) if docs else 0
    good_dates = sum(1 for d in derived_dates if d)
    good_bonds = sum(1 for v in derived_bonds if v is not None)
    if total:
        lines.append("Derived coverage:")
        lines.append(f"  booking_date (parsable): {good_dates}/{total} ({round(100*good_dates/total,1)}%)")
        lines.append(f"  bond_amount (numeric):  {good_bonds}/{total} ({round(100*good_bonds/total,1)}%)")
        if missing_date_reasons:
            top_miss = ", ".join(f"{k}:{c}" for k,c in missing_date_reasons.most_common(3))
            lines.append(f"  missing date hints: {top_miss}")
        lines.append("")

    if bonds:
        ns = numeric_stats(bonds)
        lines.append("Bond Amount (numeric) stats:")
        for k, v in ns.items():
            if isinstance(v, float):
                lines.append(f"  {k:>6}: {v:,.2f}")
            else:
                lines.append(f"  {k:>6}: {v}")
        lines.append("")

    if booking_dates:
        dr = daterange(booking_dates)
        lines.append("Booking Date range:")
        lines.append(f"  min: {dr.get('min')}")
        lines.append(f"  max: {dr.get('max')}")
        lines.append("")
    if filed_dates:
        drf = daterange(filed_dates)
        lines.append("File Date range:")
        lines.append(f"  min: {drf.get('min')}")
        lines.append(f"  max: {drf.get('max')}")
        lines.append("")

    # Window snapshot using derived fields (24h/48h/72h; America/Chicago)
    pairs = list(zip(derived_dates, (v if v is not None else 0.0 for v in derived_bonds)))
    win = window_bucket_counts(pairs)
    lines.append("Window snapshot (derived):")
    for w in ("24h","48h","72h"):
        lines.append(f"  {w:>3}: count={win[w]['count']:>5}  sum={money_fmt(win[w]['sum'])}")
    lines.append("")

    # Detailed field-by-field
    lines.append("Field-by-field detail (sample-based):")
    for k in sorted(field_stats.keys()):
        st = field_stats[k]
        lines.append(f"- {k}: present={st['present_pct']}% types={st['types']}")
        if "numeric" in st:
            ns = st["numeric"]
            ns_compact = ", ".join(
                f"{kk}={ns[kk]:,.2f}" if isinstance(ns[kk], float) else f"{kk}={ns[kk]}"
                for kk in ["count","min","p25","median","p75","max","mean"] if kk in ns
            )
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

DEFAULT_COLLECTIONS = [
    "brazoria_inmates",
    "fortbend_inmates",
    "galveston_events",
    "galveston_persons",  # alias for "persons" if that is the actual name
    "persons",
    "jefferson_events",
    "harris_bond",
    "harris_misfel",
    "harris_nafiling",
]

def existing_default_collections(db) -> List[str]:
    names = set(db.list_collection_names())
    return [c for c in DEFAULT_COLLECTIONS if c in names]

def main():
    parser = argparse.ArgumentParser(description="Audit MongoDB source scraping collections and write a TXT report.")
    parser.add_argument("--uri", default=os.getenv("MONGO_URI"), help="MongoDB connection string")
    parser.add_argument("--db", default=os.getenv("MONGO_DB"), help="Database name")
    parser.add_argument("--sample", type=int, default=1000, help="Sample size per collection")
    parser.add_argument("--report", default=None, help="Path to TXT report (default: ./debug_reports/source_audit_YYYYmmdd_HHMM.txt)")
    parser.add_argument("--collections", default=None, help="Comma-separated list of collection names to audit")
    parser.add_argument("--max-examples", type=int, default=5, help="Max example values to show per field")
    args = parser.parse_args()

    if not args.uri or not args.db:
        raise SystemExit("Error: provide --uri and --db or set MONGO_URI and MONGO_DB env vars.")

    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M")
    report_path = args.report or os.path.join("debug_reports", f"source_audit_{ts}.txt")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)

    client = MongoClient(args.uri, tz_aware=True)
    db = client[args.db]

    # Choose collections
    if args.collections:
        targets = [c.strip() for c in args.collections.split(",") if c.strip()]
    else:
        targets = existing_default_collections(db)
        if not targets:
            raise SystemExit("No target collections found. Provide --collections or ensure defaults exist in DB.")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# Source Collections Audit\nGenerated: {utcnow_iso()}\nDB: {args.db}\nURI: (hidden)\n\n")
        for name in targets:
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
