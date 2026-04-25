#!/usr/bin/env python3
"""
Analyze MongoDB Atlas databases/collections to find fields that look "categorical".
Outputs:
  - categorical_fields_report.csv
  - categorical_fields_report.json

Heuristics (tunable via CLI):
  - A field is "categorical" if:
      * unique_values <= max_unique  OR
      * (unique_values / non_null_count) <= max_unique_ratio
  - Booleans are always categorical if present in >= min_count docs
  - Small integer code fields can be flagged (e.g., <= max_unique small ints)
  - We ignore very high-cardinality types (ObjectId, large numbers) by default.

Sampling:
  - Uses aggregation {$sample: {size: N}} per collection to avoid scanning huge datasets.

Requirements:
  pip install pymongo python-dotenv
"""
import os
import json
import csv
import argparse
from collections import defaultdict, Counter
from typing import Any, Dict, Tuple, Iterable

from bson.objectid import ObjectId
from pymongo import MongoClient
from dotenv import load_dotenv

# ---------- utils ----------

def flatten(doc: Dict[str, Any], parent_key: str = "", sep: str = ".") -> Dict[str, Any]:
    """Flatten nested dictionaries/lists using dot paths; lists become indexed paths."""
    items = []
    if isinstance(doc, dict):
        for k, v in doc.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            items.extend(flatten(v, new_key, sep=sep).items())
    elif isinstance(doc, list):
        # Represent lists as path[index]
        for i, v in enumerate(doc):
            new_key = f"{parent_key}[{i}]"
            items.extend(flatten(v, new_key, sep=sep).items())
        # Also add a synthetic key representing "list exists"
        items.append((parent_key + "[]", True))
    else:
        items.append((parent_key, doc))
    return dict(items)

def type_name(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int,)):
        return "int"
    if isinstance(v, (float,)):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, ObjectId):
        return "objectid"
    if isinstance(v, (bytes, bytearray)):
        return "bytes"
    if isinstance(v, list):
        return "list"
    if isinstance(v, dict):
        return "dict"
    return type(v).__name__

def summarize_values(counter: Counter, top_n: int = 10) -> str:
    # Return a compact "value:count" list for top values (stringified)
    parts = []
    for val, cnt in counter.most_common(top_n):
        val_s = repr(val)
        if len(val_s) > 60:
            val_s = val_s[:57] + "..."
        parts.append(f"{val_s}:{cnt}")
    return "; ".join(parts)

# ---------- core ----------

def scan_collection(
    coll,
    sample_size: int,
    max_docs: int = None
) -> Iterable[Dict[str, Any]]:
    """Yield sampled documents from a collection."""
    if sample_size <= 0:
        # Full scan (not recommended for huge collections)
        cursor = coll.find({}, no_cursor_timeout=True)
        for d in cursor:
            yield d
        return

    # Use $sample; if collection smaller than sample_size, Mongo will just return all
    try:
        for d in coll.aggregate([{"$sample": {"size": sample_size}}], allowDiskUse=True):
            yield d
    except Exception as e:
        # Fallback to limited find if $sample not allowed
        for d in coll.find({}).limit(sample_size):
            yield d

def analyze_collection(
    db_name: str,
    coll_name: str,
    coll,
    sample_size: int,
    max_unique: int,
    max_unique_ratio: float,
    min_count: int,
    include_index_hint: bool,
    treat_small_int_as_categorical: bool,
    small_int_max_unique: int
) -> Tuple[list, list]:
    """
    Returns (rows_for_csv, rows_for_json)
    Each row is a dict containing metrics & categorical decision.
    """
    # Gather stats
    field_stats = defaultdict(lambda: {
        "types": Counter(),
        "non_null_count": 0,
        "docs_with_field": 0,
        "values": Counter(),   # only for reasonable-sized uniques
        "too_many_uniques": False,
    })

    docs_seen = 0
    for doc in scan_collection(coll, sample_size):
        docs_seen += 1
        flat = flatten(doc)
        seen_fields_this_doc = set()
        for path, val in flat.items():
            # Skip root empty path (shouldn't happen)
            if not path:
                continue
            st = field_stats[path]
            tname = type_name(val)
            st["types"][tname] += 1
            if val is not None:
                st["non_null_count"] += 1

            if path not in seen_fields_this_doc:
                st["docs_with_field"] += 1
                seen_fields_this_doc.add(path)

            # Track values for distincts only while it's manageable
            if not st["too_many_uniques"]:
                if isinstance(val, (dict, list, bytes, bytearray)):
                    # Skip complex for values counting
                    continue
                # Represent ObjectId as str to avoid memory-heavy set
                norm_val = str(val) if isinstance(val, ObjectId) else val
                st["values"][norm_val] += 1
                # Guardrail: if we already exceeded 5000 unique values, stop counting values
                if len(st["values"]) > 5000:
                    st["too_many_uniques"] = True
                    st["values"].clear()

    # Index hints
    index_keys = set()
    if include_index_hint:
        try:
            idx = coll.index_information()
            for _, meta in idx.items():
                keys = meta.get("key", [])
                for (k, _dir) in keys:
                    index_keys.add(k)
        except Exception:
            pass

    # Decide categorical & build rows
    rows_csv = []
    rows_json = []

    for path, st in field_stats.items():
        non_null = st["non_null_count"]
        docs_with = st["docs_with_field"]
        types = list(st["types"].items())  # [(type, count), ...]
        unique_values = None
        unique_ratio = None
        top_values_str = ""
        categorical = False
        reasons = []

        if not st["too_many_uniques"]:
            unique_values = len(st["values"])
            if non_null > 0:
                unique_ratio = unique_values / max(1, non_null)
            top_values_str = summarize_values(st["values"], top_n=10)
        else:
            reasons.append("too_many_uniques_to_count")

        # Heuristics
        # 1) bools are categorical if present enough
        if st["types"].get("bool", 0) >= min_count:
            categorical = True
            reasons.append("bool_field")

        # 2) low-unique absolute or ratio
        if not categorical and unique_values is not None:
            if unique_values <= max_unique:
                categorical = True
                reasons.append(f"unique_values<=max_unique({unique_values}<={max_unique})")
            elif unique_ratio is not None and unique_ratio <= max_unique_ratio:
                categorical = True
                reasons.append(f"unique_ratio<=max_unique_ratio({unique_ratio:.4f}<={max_unique_ratio})")

        # 3) small int code fields
        if not categorical and treat_small_int_as_categorical:
            if st["types"].get("int", 0) >= min_count and unique_values is not None and unique_values <= small_int_max_unique:
                categorical = True
                reasons.append(f"small_int_code(unique_values<={small_int_max_unique})")

        # 4) Exclude known high-cardinality identifiers unless forced
        if any(k in path.lower() for k in ("_id", "uuid", "guid")):
            if categorical:
                reasons.append("overridden_by_identifier_name")
            categorical = False

        # Prepare outputs
        row_common = {
            "database": db_name,
            "collection": coll_name,
            "field": path,
            "docs_seen": docs_seen,
            "docs_with_field": docs_with,
            "non_null_count": non_null,
            "types": dict(st["types"]),
            "unique_values": unique_values,
            "unique_ratio": round(unique_ratio, 6) if unique_ratio is not None else None,
            "top_values": top_values_str,
            "indexed": (path in index_keys),
            "categorical": categorical,
            "reasons": reasons,
        }

        rows_json.append(row_common)
        # CSV-friendly
        rows_csv.append({
            "database": db_name,
            "collection": coll_name,
            "field": path,
            "docs_seen": docs_seen,
            "docs_with_field": docs_with,
            "non_null_count": non_null,
            "types": json.dumps(row_common["types"], ensure_ascii=False),
            "unique_values": unique_values if unique_values is not None else "",
            "unique_ratio": row_common["unique_ratio"] if row_common["unique_ratio"] is not None else "",
            "top_values": top_values_str,
            "indexed": "yes" if path in index_keys else "no",
            "categorical": "yes" if categorical else "no",
            "reasons": "|".join(reasons),
        })

    return rows_csv, rows_json


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description="Analyze Atlas collections to find categorical fields.")
    parser.add_argument("--mongo-uri", default=os.getenv("MONGO_URI", ""), help="Mongo connection string (or set MONGO_URI).")
    parser.add_argument("--include-dbs", nargs="*", default=["warrantdb"], help="Only analyze these databases (space-separated). Default: warrantdb.")
    parser.add_argument("--exclude-dbs", nargs="*", default=["admin", "local", "config"], help="Skip these databases.")
    parser.add_argument("--sample-size", type=int, default=5000, help="Documents to sample per collection (0 = full scan).")
    parser.add_argument("--max-unique", type=int, default=25, help="Max unique values for absolute categorical flag.")
    parser.add_argument("--max-unique-ratio", type=float, default=0.1, help="Max unique/rows ratio for categorical flag.")
    parser.add_argument("--min-count", type=int, default=25, help="Minimum occurrences to consider a field at all.")
    parser.add_argument("--include-index-hint", action="store_true", help="Mark fields that are indexed.")
    parser.add_argument("--small-int-as-cat", action="store_true", help="Treat small int code fields as categorical.")
    parser.add_argument("--small-int-max-unique", type=int, default=12, help="Max unique for small int code fields.")
    parser.add_argument("--out-csv", default="categorical_fields_report.csv", help="CSV output path.")
    parser.add_argument("--out-json", default="categorical_fields_report.json", help="JSON output path.")
    parser.add_argument("--include-coll", nargs="*", default=[], help="Only analyze these collections (name match) per DB.")
    parser.add_argument("--exclude-coll", nargs="*", default=[], help="Skip these collections (name match) per DB.")
    args = parser.parse_args()

    if not args.mongo_uri:
        raise SystemExit("ERROR: Provide --mongo-uri or set MONGO_URI in your environment.")

    client = MongoClient(args.mongo_uri)
    db_names = sorted(client.list_database_names())

    if args.include_dbs:
        db_names = [d for d in db_names if d in args.include_dbs]
    if args.exclude_dbs:
        db_names = [d for d in db_names if d not in args.exclude_dbs]

    all_rows_csv = []
    all_rows_json = []

    for db_name in db_names:
        db = client[db_name]
        try:
            coll_names = sorted(db.list_collection_names())
        except Exception as e:
            print(f"[WARN] Could not list collections for db={db_name}: {e}")
            continue

        if args.include_coll:
            coll_names = [c for c in coll_names if c in args.include_coll]
        if args.exclude_coll:
            coll_names = [c for c in coll_names if c not in args.exclude_coll]

        for coll_name in coll_names:
            coll = db[coll_name]
            print(f"[INFO] Analyzing {db_name}.{coll_name} ...")
            try:
                rows_csv, rows_json = analyze_collection(
                    db_name=db_name,
                    coll_name=coll_name,
                    coll=coll,
                    sample_size=args.sample_size,
                    max_unique=args.max_unique,
                    max_unique_ratio=args.max_unique_ratio,
                    min_count=args.min_count,
                    include_index_hint=args.include_index_hint,
                    treat_small_int_as_categorical=args.small_int_as_cat,
                    small_int_max_unique=args.small_int_max_unique
                )
                all_rows_csv.extend(rows_csv)
                all_rows_json.extend(rows_json)
            except Exception as e:
                print(f"[WARN] Failed to analyze {db_name}.{coll_name}: {e}")

    # Write CSV
    if all_rows_csv:
        fieldnames = [
            "database","collection","field","docs_seen","docs_with_field","non_null_count",
            "types","unique_values","unique_ratio","top_values","indexed","categorical","reasons"
        ]
        with open(args.out_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in all_rows_csv:
                writer.writerow(r)
        print(f"[OK] Wrote CSV → {args.out_csv}")

    # Write JSON
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(all_rows_json, f, ensure_ascii=False, indent=2)
    print(f"[OK] Wrote JSON → {args.out_json}")

    print("[DONE] Tip: open the CSV and filter `categorical == yes` to see your candidate label fields.")

if __name__ == "__main__":
    main()