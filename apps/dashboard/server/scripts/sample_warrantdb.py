#!/usr/bin/env python3
"""
sample_warrantdb.py

Pull up to 10 random documents from each listed MongoDB collection and
write them to per-collection JSONL files inside an output folder.

Usage:
  python sample_warrantdb.py --mongo-uri "mongodb+srv://user:pass@cluster/..."
  # optional:
  # python sample_warrantdb.py --db warrantdb --out ./warrantdb_samples
"""

import argparse
import os
import sys
import json
import gzip
from datetime import datetime
from pathlib import Path

from pymongo import MongoClient
from pymongo.errors import PyMongoError
from bson.json_util import dumps as bson_dumps

COLLECTIONS = [
    # raw-ish collections
    "brazoria_inmates",
    "custody_events",
    "fortbend_inmates",
    "galveston_events",
    "harris_bond",
    "harris_misfel",
    "harris_nafiling",
    "jefferson_events",
    # normalized/simple collections
    "simple_brazoria",
    "simple_fortbend",
    "simple_galveston",
    "simple_harris",
    "simple_jefferson",
]

def parse_args():
    parser = argparse.ArgumentParser(description="Sample random docs from warrantdb collections.")
    parser.add_argument(
        "--mongo-uri",
        default=os.getenv("MONGO_URI"),
        help="MongoDB connection string (default: $MONGO_URI)."
    )
    parser.add_argument(
        "--db",
        default=os.getenv("MONGO_DB", "warrantdb"),
        help="Database name (default: $MONGO_DB or 'warrantdb')."
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output folder (default: ./warrantdb_samples_YYYYmmdd_HHMMSS)."
    )
    parser.add_argument(
        "--per-collection",
        type=int,
        default=10,
        help="Max samples per collection (default: 10)."
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON in files (uses more space)."
    )
    parser.add_argument(
        "--gzip",
        action="store_true",
        help="Gzip-compress output files (writes *.jsonl.gz)."
    )
    parser.add_argument(
        "--combine",
        action="store_true",
        help="Also write a combined file with all samples across collections."
    )
    args = parser.parse_args()

    if not args.mongo_uri:
        parser.error("Mongo URI is required (set $MONGO_URI or use --mongo-uri).")

    return args

def ensure_out_dir(base_out: str | None) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(base_out or f"./warrantdb_samples_{ts}")
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir

def collection_exists(db, coll_name: str) -> bool:
    try:
        return coll_name in db.list_collection_names()
    except Exception:
        # If permissions restrict listing, fall back to a quick count which will raise if missing
        try:
            db[coll_name].estimated_document_count()
            return True
        except Exception:
            return False

def sample_collection(db, coll_name: str, k: int):
    coll = db[coll_name]
    # Use estimatedDocumentCount (fast, may be approximate, good enough for choosing min size)
    try:
        est = coll.estimated_document_count()
    except Exception:
        # fallback if server version/permissions differ
        est = coll.count_documents({})
    if est == 0:
        return []

    size = min(est, k)
    # $sample requires size <= actual collection size; with estimated count it should be fine,
    # but we still guard with try/except and fallback to a deterministic small slice if needed.
    try:
        docs = list(coll.aggregate(
            [{"$sample": {"size": size}}],
            allowDiskUse=True,
            maxTimeMS=60_000
        ))
        return docs
    except PyMongoError:
        # Fallback: just take first N docs
        return list(coll.find({}, limit=size))

def write_jsonl(path: Path, docs: list, pretty: bool = False, use_gzip: bool = False):
    if use_gzip:
        opener = lambda p: gzip.open(p, "wt", encoding="utf-8")
    else:
        opener = lambda p: open(p, "w", encoding="utf-8")

    with opener(path) as f:
        for d in docs:
            if pretty:
                f.write(bson_dumps(d, indent=2) + "\n")
            else:
                # Compact extended JSON to preserve ObjectId/Date types without heavy whitespace
                f.write(bson_dumps(d) + "\n")

def main():
    args = parse_args()
    out_dir = ensure_out_dir(args.out)

    try:
        client = MongoClient(args.mongo_uri)
        db = client[args.db]
        try:
            existing = set(db.list_collection_names())
        except Exception:
            existing = None
    except PyMongoError as e:
        print(f"❌ Failed to connect to MongoDB: {e}", file=sys.stderr)
        sys.exit(1)

    summary = []
    combined = []
    print(f"[INFO] Output folder: {out_dir.resolve()}")
    for coll in COLLECTIONS:
        if existing is not None and coll not in existing:
            print(f"[WARN] Skipping {args.db}.{coll} (collection does not exist).", file=sys.stderr)
            summary.append({"collection": coll, "count_written": 0, "skipped": "not found"})
            continue

        full_name = f"{args.db}.{coll}"
        print(f"[INFO] Sampling from {full_name} ...")
        try:
            docs = sample_collection(db, coll, args.per_collection)
            if args.combine:
                # annotate with collection for the combined file
                for d in docs:
                    if isinstance(d, dict) and "_collection" not in d:
                        d["_collection"] = coll
                combined.extend(docs)

            suffix = ".jsonl.gz" if args.gzip else ".jsonl"
            out_file = out_dir / f"{coll}{suffix}"
            write_jsonl(out_file, docs, pretty=args.pretty, use_gzip=args.gzip)
            summary.append({"collection": coll, "count_written": len(docs), "file": str(out_file)})
            print(f"[OK]  Wrote {len(docs)} docs → {out_file.name}")
        except PyMongoError as e:
            print(f"[WARN] Skipped {full_name} due to error: {e}", file=sys.stderr)
            summary.append({"collection": coll, "count_written": 0, "error": str(e)})

    if args.combine:
        suffix = ".jsonl.gz" if args.gzip else ".jsonl"
        combined_path = out_dir / f"_combined{suffix}"
        write_jsonl(combined_path, combined, pretty=args.pretty, use_gzip=args.gzip)
        summary.append({"collection": "_combined", "count_written": len(combined), "file": str(combined_path)})
        print(f"[INFO] Combined file written → {combined_path.name}")

    # Also write a small manifest for quick review
    manifest_path = out_dir / "_manifest.json"
    with manifest_path.open("w", encoding="utf-8") as mf:
        json.dump(
            {
                "database": args.db,
                "per_collection_requested": args.per_collection,
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "pretty": bool(args.pretty),
                "gzip": bool(args.gzip),
                "combine": bool(args.combine),
                "outputs": summary,
            },
            mf,
            ensure_ascii=False,
            indent=2,
        )
    print(f"[INFO] Manifest written → {manifest_path.name}")
    print("[DONE] Sampling complete.")

if __name__ == "__main__":
    main()