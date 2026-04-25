"""
cleanup_stale_simple_docs.py

Removes stale normalized records from simple_fortbend and simple_galveston where
`_upsert_key.county` is null or missing.  These records were produced by an older
normalizer schema and cause E11000 conflicts that block corrected docs from being
upserted in their place.

Usage:
    # Dry-run (default) — prints counts and sample _ids, makes no changes:
    python3 -m scripts.cleanup_stale_simple_docs

    # Actually delete:
    python3 -m scripts.cleanup_stale_simple_docs --apply
"""

import argparse
import os
import sys

from pymongo import MongoClient

TARGET_COLLECTIONS = ["simple_fortbend", "simple_galveston"]
STALE_FILTER = {
    "$or": [
        {"_upsert_key.county": None},
        {"_upsert_key.county": {"$exists": False}},
    ]
}
SAMPLE_SIZE = 5


def _connect() -> tuple:
    uri = os.environ.get("MONGO_URI")
    db_name = os.environ.get("MONGO_DB", "warrantdb")
    if not uri:
        print("ERROR: MONGO_URI environment variable is not set.", file=sys.stderr)
        sys.exit(1)
    client = MongoClient(uri)
    return client, client[db_name]


def _inspect(db, collection_name: str, apply: bool) -> None:
    col = db[collection_name]

    count = col.count_documents(STALE_FILTER)

    samples = list(
        col.find(STALE_FILTER, {"_id": 1, "_upsert_key": 1}).limit(SAMPLE_SIZE)
    )
    sample_ids = [str(doc["_id"]) for doc in samples]

    print(f"\ncollection : {collection_name}")
    print(f"stale docs : {count}")
    if sample_ids:
        print(f"sample _ids: {', '.join(sample_ids)}")
    else:
        print("sample _ids: (none)")

    if count == 0:
        print("action     : nothing to do")
        return

    if apply:
        result = col.delete_many(STALE_FILTER)
        print(f"action     : DELETED {result.deleted_count} documents")
    else:
        print(f"action     : DRY RUN — would delete {count} documents (pass --apply to delete)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Remove stale null-county docs from simple_fortbend and simple_galveston."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Actually delete the stale documents. Without this flag the script is a dry run.",
    )
    args = parser.parse_args()

    if args.apply:
        print("=== CLEANUP — APPLY MODE ===")
        print("Stale docs will be permanently deleted.")
    else:
        print("=== CLEANUP — DRY RUN (no changes) ===")
        print("Pass --apply to perform deletions.")

    client, db = _connect()

    try:
        for collection_name in TARGET_COLLECTIONS:
            _inspect(db, collection_name, apply=args.apply)
    finally:
        client.close()

    print()


if __name__ == "__main__":
    main()
