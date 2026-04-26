"""
scripts/create_v2_indexes.py
───────────────────────────────────────────────────────────────────────────────
Create (or verify) MongoDB indexes on v2 staging collections.

Safe to rerun: all index creation uses create_index() which is idempotent —
MongoDB silently skips index creation if an equivalent index already exists.

Collections and indexes
────────────────────────
  v2_galveston_events
    • Unique compound on (county, booking_number)       ← primary stable dedup key
    • Non-unique compound on (county, source, full_name, source_url)  ← fallback key
    • Non-unique on scraped_at                           ← time-range queries

  v2_harris_reports
    • Compound on (report_type, report_date, case_number, full_name)
    • Non-unique on (county, source_system, kind)        ← kind-filtered queries
    • Non-unique on scraped_at

  v2_lookup_results
    • Compound on (county, source_system, full_name, booking_number)
    • Non-unique on (county, source)                     ← source-filtered queries
    • Non-unique on scraped_at

  v2_report_manifest
    • Unique compound on (source_system, report_id)      ← manifest dedup key
    • Non-unique on (source, url)                        ← URL-based lookup

Usage
─────
  # Dry-run: print what would be created, no writes
  PYTHONPATH=$PWD python3 scripts/create_v2_indexes.py --dry-run

  # Apply indexes (requires MONGO_URI / MONGO_DB env or .env file)
  PYTHONPATH=$PWD MONGO_URI=... MONGO_DB=warrantdb python3 scripts/create_v2_indexes.py

  # Apply indexes with verbose output
  PYTHONPATH=$PWD python3 scripts/create_v2_indexes.py --verbose
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, NamedTuple, Optional

import pymongo


# ── Index specification ───────────────────────────────────────────────────────

class IndexSpec(NamedTuple):
    collection: str
    keys: List[tuple]          # e.g. [("county", 1), ("booking_number", 1)]
    unique: bool = False
    sparse: bool = False
    name: Optional[str] = None # explicit name; auto-generated if None
    description: str = ""


_INDEXES: List[IndexSpec] = [
    # ── v2_galveston_events ──────────────────────────────────────────────────
    IndexSpec(
        collection="v2_galveston_events",
        keys=[("county", pymongo.ASCENDING), ("booking_number", pymongo.ASCENDING)],
        unique=True,
        sparse=True,   # some rows may lack booking_number — exclude those from unique check
        name="galveston_booking_number_uq",
        description="Primary dedup key: stable booking-system identifier per inmate",
    ),
    IndexSpec(
        collection="v2_galveston_events",
        keys=[
            ("county",    pymongo.ASCENDING),
            ("source",    pymongo.ASCENDING),
            ("full_name", pymongo.ASCENDING),
            ("source_url", pymongo.ASCENDING),
        ],
        unique=False,
        sparse=True,
        name="galveston_name_url_fallback",
        description="Fallback dedup key for rows without booking_number",
    ),
    IndexSpec(
        collection="v2_galveston_events",
        keys=[("scraped_at", pymongo.DESCENDING)],
        name="galveston_scraped_at",
        description="Time-range scan index",
    ),

    # ── v2_harris_reports ────────────────────────────────────────────────────
    IndexSpec(
        collection="v2_harris_reports",
        keys=[
            ("report_type",  pymongo.ASCENDING),
            ("report_date",  pymongo.ASCENDING),
            ("case_number",  pymongo.ASCENDING),
            ("full_name",    pymongo.ASCENDING),
        ],
        unique=False,
        name="harris_report_case",
        description="Compound query index: filter by report type + date + case",
    ),
    IndexSpec(
        collection="v2_harris_reports",
        keys=[
            ("county",        pymongo.ASCENDING),
            ("source_system", pymongo.ASCENDING),
            ("kind",          pymongo.ASCENDING),
        ],
        unique=False,
        name="harris_county_kind",
        description="Kind-filtered scan (bond / misfel / nafiling)",
    ),
    IndexSpec(
        collection="v2_harris_reports",
        keys=[("scraped_at", pymongo.DESCENDING)],
        name="harris_scraped_at",
        description="Time-range scan index",
    ),

    # ── v2_lookup_results ────────────────────────────────────────────────────
    IndexSpec(
        collection="v2_lookup_results",
        keys=[
            ("county",         pymongo.ASCENDING),
            ("source_system",  pymongo.ASCENDING),
            ("full_name",      pymongo.ASCENDING),
            ("booking_number", pymongo.ASCENDING),
        ],
        unique=False,
        sparse=True,
        name="lookup_county_name_booking",
        description="Primary lookup query index",
    ),
    IndexSpec(
        collection="v2_lookup_results",
        keys=[
            ("county", pymongo.ASCENDING),
            ("source", pymongo.ASCENDING),
        ],
        unique=False,
        name="lookup_county_source",
        description="Source-filtered scan",
    ),
    IndexSpec(
        collection="v2_lookup_results",
        keys=[("scraped_at", pymongo.DESCENDING)],
        name="lookup_scraped_at",
        description="Time-range scan index",
    ),

    # ── v2_report_manifest ───────────────────────────────────────────────────
    IndexSpec(
        collection="v2_report_manifest",
        keys=[
            ("source_system", pymongo.ASCENDING),
            ("report_id",     pymongo.ASCENDING),
        ],
        unique=True,
        sparse=True,
        name="manifest_source_report_id_uq",
        description="Primary dedup key for manifest entries",
    ),
    IndexSpec(
        collection="v2_report_manifest",
        keys=[
            ("source", pymongo.ASCENDING),
            ("url",    pymongo.ASCENDING),
        ],
        unique=False,
        sparse=True,
        name="manifest_source_url",
        description="URL-based manifest lookup (used by _is_report_processed)",
    ),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _existing_index_names(collection) -> set:
    return {idx["name"] for idx in collection.list_indexes()}


def _keys_to_str(keys: List[tuple]) -> str:
    return ", ".join(f"{k} {'ASC' if d == pymongo.ASCENDING else 'DESC'}" for k, d in keys)


# ── Main ──────────────────────────────────────────────────────────────────────

def create_indexes(db, dry_run: bool = False, verbose: bool = False) -> int:
    """
    Create all v2 staging indexes.  Returns the number of indexes created
    (or that would be created in dry-run mode).
    """
    created = skipped = 0

    for spec in _INDEXES:
        coll = db[spec.collection]
        existing = _existing_index_names(coll)
        auto_name = spec.name or "_".join(k for k, _ in spec.keys)

        if auto_name in existing:
            if verbose:
                print(f"  [skip] {spec.collection}.{auto_name} already exists")
            skipped += 1
            continue

        attrs = []
        if spec.unique:
            attrs.append("unique")
        if spec.sparse:
            attrs.append("sparse")
        attrs_str = f" ({', '.join(attrs)})" if attrs else ""

        if dry_run:
            print(
                f"  [DRY RUN] would create {spec.collection}.{auto_name}{attrs_str}: "
                f"{_keys_to_str(spec.keys)}"
            )
            if spec.description:
                print(f"            → {spec.description}")
            created += 1
            continue

        kwargs: Dict[str, Any] = {"name": auto_name}
        if spec.unique:
            kwargs["unique"] = True
        if spec.sparse:
            kwargs["sparse"] = True

        try:
            coll.create_index(spec.keys, **kwargs)
            print(f"  [OK] created {spec.collection}.{auto_name}{attrs_str}")
            if verbose and spec.description:
                print(f"       → {spec.description}")
            created += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  [ERROR] {spec.collection}.{auto_name}: {exc}", file=sys.stderr)

    return created


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Create MongoDB indexes on v2 staging collections",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print what would be created without touching MongoDB",
    )
    ap.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Print description for each index",
    )
    args = ap.parse_args()

    if args.dry_run:
        print(f"[create_v2_indexes] DRY RUN — {len(_INDEXES)} index(es) to evaluate")
        # Use a null db that reports existing names as empty so all are shown
        class _NullColl:
            def list_indexes(self):
                return []
            def create_index(self, *a, **kw):
                pass
        class _NullDb:
            def __getitem__(self, name):
                return _NullColl()
        n = create_indexes(_NullDb(), dry_run=True, verbose=args.verbose)
        print(f"\n[create_v2_indexes] {n} index(es) would be created")
        return 0

    # Live run — connect to MongoDB
    mongo_uri = os.getenv("MONGO_URI")
    mongo_db  = os.getenv("MONGO_DB", "warrantdb")

    if not mongo_uri:
        # Try loading from .env
        try:
            from pathlib import Path
            env_path = Path(__file__).resolve().parents[1] / ".env"
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, _, v = line.partition("=")
                        os.environ.setdefault(k.strip(), v.strip())
            mongo_uri = os.getenv("MONGO_URI")
        except Exception:
            pass

    if not mongo_uri:
        print(
            "[create_v2_indexes] ERROR: MONGO_URI not set.\n"
            "  Set MONGO_URI=... or provide a .env file.",
            file=sys.stderr,
        )
        return 1

    from storage.mongo_client import get_db  # noqa: PLC0415
    db = get_db()

    print(f"[create_v2_indexes] connected to {mongo_db} — creating {len(_INDEXES)} index(es)")
    n = create_indexes(db, dry_run=False, verbose=args.verbose)
    print(f"[create_v2_indexes] done — {n} index(es) created")
    return 0


if __name__ == "__main__":
    sys.exit(main())
