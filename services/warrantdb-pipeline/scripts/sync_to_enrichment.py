"""
sync_to_enrichment.py — Copy normalized simple_<county> records into the
enrichment service's `inmates` collection.

Usage:
    python -m scripts.sync_to_enrichment [--dry-run]

Environment:
    MONGO_URI                       Pipeline MongoDB URI (default: mongodb://localhost:27017)
    MONGO_DB                        Pipeline database name (default: warrantdb_pipeline)
    ENRICHMENT_MONGO_URI            Enrichment MongoDB URI (falls back to MONGO_URI if not set)
    ENRICHMENT_MONGO_DB             Enrichment database name (default: inmate_enrichment)
    ENRICHMENT_SUBJECTS_COLLECTION  Target collection name (default: inmates)
    SYNC_DRY_RUN                    Set to 'true' to skip writes and report only (default: false)

Upsert key (primary):  spn + county
Upsert key (fallback): sync_identity_key + county
  Used when spn is absent and all of county, full_name, booking_date, and
  at least one charge field are present. The key is a stable normalized
  string: county|full_name|booking_date|first_charge.

Pipeline-owned fields are written via $set on every upsert.
Enrichment lifecycle fields are written via $setOnInsert (first insert only).
Enrichment-owned fields (enrichment_status, pdl, pipl, whitepages, hcso, etc.)
are never touched after initial seeding.

Credentials are masked in all startup log output.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

# ---------------------------------------------------------------------------
# Environment bootstrap
# ---------------------------------------------------------------------------

_ROOT_DOTENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=_ROOT_DOTENV)

PIPELINE_MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://localhost:27017")
PIPELINE_MONGO_DB: str = os.getenv("MONGO_DB", "warrantdb_pipeline")

# If ENRICHMENT_MONGO_URI is not set, reuse the pipeline connection.
_enrichment_uri_env: Optional[str] = os.getenv("ENRICHMENT_MONGO_URI") or None
ENRICHMENT_MONGO_URI: str = _enrichment_uri_env or PIPELINE_MONGO_URI
ENRICHMENT_MONGO_DB: str = os.getenv("ENRICHMENT_MONGO_DB", "inmate_enrichment")
ENRICHMENT_SUBJECTS_COLLECTION: str = os.getenv("ENRICHMENT_SUBJECTS_COLLECTION", "inmates")

SOURCE_COLLECTIONS: List[str] = [
    "simple_harris",
    "simple_brazoria",
    "simple_galveston",
    "simple_fortbend",
    "simple_jefferson",
]

VALID_COUNTIES = frozenset({"harris", "brazoria", "galveston", "fortbend", "jefferson"})

_BOOKING_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_URI_USERINFO_RE = re.compile(r"(://)[^@/]+@")

PROGRESS_INTERVAL = 500  # print a progress line every N records per collection

# ---------------------------------------------------------------------------
# Type alias
# ---------------------------------------------------------------------------

CollectionResult = Dict[str, Any]


def _zero_result(collection: str) -> CollectionResult:
    return {
        "collection": collection,
        "scanned": 0,
        "inserted": 0,
        "updated": 0,
        "unchanged": 0,
        "skipped": 0,
        "fallback_key_used": 0,
        "errors": [],
    }


def _mask_uri(uri: str) -> str:
    """Remove userinfo (username:password@) from a MongoDB URI for safe logging."""
    return _URI_USERINFO_RE.sub(r"\1***@", uri)


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _coerce_bond_amount(value: Any) -> Optional[float]:
    """Return value as float if possible, else None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


def _ingest_timestamp(doc: Dict[str, Any]) -> str:
    """Derive _ingested_at: prefer booking_datetime, fall back to booking_date."""
    bdt = doc.get("booking_datetime")
    if bdt and isinstance(bdt, str) and bdt.strip():
        return bdt.strip()
    bd = doc.get("booking_date", "")
    if bd and isinstance(bd, str) and bd.strip():
        return bd.strip() + "T00:00:00Z"
    # Should not reach here after validation, but guard anyway.
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Validation helpers — primary and fallback paths
# ---------------------------------------------------------------------------

def _normalize_text(s: str) -> str:
    """Lowercase, strip, collapse internal whitespace."""
    return " ".join(s.lower().strip().split())


def _compute_fallback_key(doc: Dict[str, Any]) -> str:
    """Build a stable, normalized composite identity key for spn-less records.

    Format: county|full_name|booking_date|first_charge
    """
    county = _normalize_text(doc.get("county") or "")
    full_name = _normalize_text(doc.get("full_name") or "")
    booking_date = (doc.get("booking_date") or "").strip()

    # Resolve first charge string (tolerate charge/offense/charges variants)
    charge_str = doc.get("charge") or doc.get("offense") or ""
    charges = doc.get("charges")
    if isinstance(charges, list) and charges:
        first_charge = str(charges[0])
    elif isinstance(charges, str) and charges.strip():
        first_charge = charges
    else:
        first_charge = str(charge_str) if charge_str else ""

    return f"{county}|{full_name}|{booking_date}|{_normalize_text(first_charge)}"


def _validate_primary(doc: Dict[str, Any]) -> Optional[str]:
    """Validate county and booking_date for spn-keyed records."""
    county = doc.get("county")
    if not county or county not in VALID_COUNTIES:
        return f"unsupported county: {county!r}"

    booking_date = doc.get("booking_date")
    if not booking_date or not _BOOKING_DATE_RE.match(str(booking_date)):
        return f"invalid booking_date: {booking_date!r}"

    return None


def _validate_fallback_fields(doc: Dict[str, Any]) -> Optional[str]:
    """Validate fields required for the fallback identity key.

    All of county, full_name, booking_date, and at least one charge field
    must be present and non-empty.
    """
    err = _validate_primary(doc)
    if err:
        return err

    full_name = doc.get("full_name")
    if not full_name or not isinstance(full_name, str) or not full_name.strip():
        return "fallback key requires full_name"

    charge = doc.get("charge") or doc.get("offense")
    charges = doc.get("charges")
    has_charge = bool(charge and str(charge).strip())
    has_charges = bool(
        (isinstance(charges, list) and charges)
        or (isinstance(charges, str) and charges.strip())
    )
    if not has_charge and not has_charges:
        return "fallback key requires charge or charges"

    return None


# ---------------------------------------------------------------------------
# Build update document
# ---------------------------------------------------------------------------

def _build_update(
    doc: Dict[str, Any],
    collection_name: str,
    now_iso: str,
    sync_identity_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the pymongo update payload for a single record."""
    # Tolerate charge/offense alias
    charge = doc.get("charge") or doc.get("offense")

    # Normalize charges to a list
    raw_charges = doc.get("charges")
    if raw_charges is None:
        charges: List[str] = []
    elif isinstance(raw_charges, str):
        charges = [raw_charges] if raw_charges.strip() else []
    elif isinstance(raw_charges, list):
        charges = raw_charges
    else:
        charges = []

    # Coerce bond_amount; never propagate a string
    bond_amount = _coerce_bond_amount(doc.get("bond_amount"))

    # Sanitize booking_datetime — must be string or None
    booking_datetime = doc.get("booking_datetime")
    if booking_datetime is not None and not isinstance(booking_datetime, str):
        booking_datetime = None

    # spn may be absent on fallback-keyed records
    raw_spn = doc.get("spn")
    spn_value = raw_spn.strip() if raw_spn and isinstance(raw_spn, str) else None

    set_fields: Dict[str, Any] = {
        "spn": spn_value,
        "full_name": doc.get("full_name"),
        "county": doc["county"],
        "booking_date": doc.get("booking_date"),
        "booking_datetime": booking_datetime,
        "bond_amount": bond_amount,
        "bond_label": doc.get("bond_label"),
        "bond_note": doc.get("bond_note"),
        "charge": charge,
        "charges": charges,
        "status": doc.get("status"),
        "source_collection": collection_name,
        "_normalized_at": doc.get("_normalized_at"),
        "_sync_updated_at": now_iso,
    }

    # Only include sync_identity_key on fallback-keyed records
    if sync_identity_key is not None:
        set_fields["sync_identity_key"] = sync_identity_key

    # Enrichment lifecycle — seeded once on first insert, never overwritten
    set_on_insert_fields: Dict[str, Any] = {
        "enrichment_status": "NEW",
        "enrichment_flag": True,
        "_ingested_at": _ingest_timestamp(doc),
        "enrichment_providers": [],
        "_enriched_at": None,
        "_enrichment_attempted_at": None,
    }

    return {
        "$set": set_fields,
        "$setOnInsert": set_on_insert_fields,
    }


# ---------------------------------------------------------------------------
# Per-collection sync
# ---------------------------------------------------------------------------

PROGRESS_FMT = (
    "[sync] {label} progress  "
    "scanned={scanned:<6} "
    "skipped={skipped:<6} "
    "inserted={inserted:<6} "
    "updated={updated:<6} "
    "fallback={fallback}"
)


def _log_progress(collection_name: str, result: CollectionResult) -> None:
    print(
        PROGRESS_FMT.format(
            label=collection_name.replace("simple_", ""),
            scanned=result["scanned"],
            skipped=result["skipped"],
            inserted=result["inserted"],
            updated=result["updated"],
            fallback=result["fallback_key_used"],
        )
    )


def _sync_collection(
    pipeline_db,
    inmates_col,
    collection_name: str,
    dry_run: bool,
) -> CollectionResult:
    result = _zero_result(collection_name)

    if collection_name not in pipeline_db.list_collection_names():
        print(f"  [info] collection {collection_name!r} does not exist — skipping")
        return result

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    cursor = pipeline_db[collection_name].find({})

    try:
        for doc in cursor:
            result["scanned"] += 1

            # ── progress indicator ────────────────────────────────────────
            if result["scanned"] % PROGRESS_INTERVAL == 0:
                _log_progress(collection_name, result)

            # ── determine identity path ───────────────────────────────────
            raw_spn = doc.get("spn")
            has_spn = bool(raw_spn and isinstance(raw_spn, str) and raw_spn.strip())

            if has_spn:
                err = _validate_primary(doc)
                if err:
                    result["skipped"] += 1
                    result["errors"].append({
                        "spn": raw_spn,
                        "county": doc.get("county"),
                        "collection": collection_name,
                        "reason": err,
                    })
                    continue
                filter_doc = {"spn": raw_spn.strip(), "county": doc["county"]}
                sync_identity_key = None
            else:
                # No spn — attempt fallback composite key
                err = _validate_fallback_fields(doc)
                if err:
                    result["skipped"] += 1
                    result["errors"].append({
                        "spn": None,
                        "county": doc.get("county"),
                        "collection": collection_name,
                        "reason": err,
                    })
                    continue
                sync_identity_key = _compute_fallback_key(doc)
                filter_doc = {"sync_identity_key": sync_identity_key, "county": doc["county"]}
                result["fallback_key_used"] += 1

            # ── dry-run: read-only check ──────────────────────────────────
            if dry_run:
                existing = inmates_col.find_one(filter_doc, {"_id": 1})
                if existing is None:
                    result["inserted"] += 1
                else:
                    # Cannot know if $set would change values without writing;
                    # report as "updated" (conservative estimate).
                    result["updated"] += 1
                continue

            # ── live upsert ───────────────────────────────────────────────
            update_doc = _build_update(doc, collection_name, now_iso, sync_identity_key)
            try:
                res = inmates_col.update_one(filter_doc, update_doc, upsert=True)
                if res.upserted_id is not None:
                    result["inserted"] += 1
                elif res.modified_count > 0:
                    result["updated"] += 1
                else:
                    result["unchanged"] += 1
            except PyMongoError as exc:
                result["errors"].append({
                    "spn": doc.get("spn"),
                    "county": doc.get("county"),
                    "collection": collection_name,
                    "reason": f"write error: {exc}",
                })
    finally:
        cursor.close()

    return result


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def _print_collection_line(result: CollectionResult, dry_run: bool) -> None:
    label = result["collection"].replace("simple_", "")
    err_count = len(result["errors"])
    dry_tag = " [DRY RUN]" if dry_run else ""
    print(
        f"[sync]{dry_tag} {label:<12} "
        f"scanned={result['scanned']:<6} "
        f"inserted={result['inserted']:<6} "
        f"updated={result['updated']:<6} "
        f"unchanged={result['unchanged']:<6} "
        f"skipped={result['skipped']:<6} "
        f"fallback={result['fallback_key_used']:<6} "
        f"errors={err_count}"
    )
    _MAX_INLINE_ERRORS = 10
    for e in result["errors"][:_MAX_INLINE_ERRORS]:
        print(f"  [error] {e}")
    overflow = len(result["errors"]) - _MAX_INLINE_ERRORS
    if overflow > 0:
        print(f"  [error] … {overflow} more error(s) not shown")


def _print_totals(totals: CollectionResult, dry_run: bool) -> None:
    dry_tag = " [DRY RUN]" if dry_run else ""
    err_total = len(totals["errors"])
    print(
        f"\n[sync]{dry_tag} TOTAL        "
        f"scanned={totals['scanned']:<6} "
        f"inserted={totals['inserted']:<6} "
        f"updated={totals['updated']:<6} "
        f"unchanged={totals['unchanged']:<6} "
        f"skipped={totals['skipped']:<6} "
        f"fallback={totals['fallback_key_used']:<6} "
        f"errors={err_total}"
    )
    if dry_run:
        print("[sync] DRY RUN — no writes were performed. inserted/updated counts are estimates.")


# ---------------------------------------------------------------------------
# Main adapter
# ---------------------------------------------------------------------------

def run(dry_run: bool = False) -> int:
    """Sync all source collections. Returns 0 on success, 1 if any errors occurred."""
    print(f"[sync] Starting simple_* → inmates sync | dry_run={dry_run}")
    print(f"[sync] Pipeline:    {_mask_uri(PIPELINE_MONGO_URI)}  db={PIPELINE_MONGO_DB}")
    print(f"[sync] Enrichment:  {_mask_uri(ENRICHMENT_MONGO_URI)}  db={ENRICHMENT_MONGO_DB}  col={ENRICHMENT_SUBJECTS_COLLECTION}")

    pipeline_client = MongoClient(PIPELINE_MONGO_URI)
    # Reuse the same client when both databases are on the same host.
    if _enrichment_uri_env is None:
        enrichment_client = pipeline_client
    else:
        enrichment_client = MongoClient(ENRICHMENT_MONGO_URI)

    pipeline_db = pipeline_client[PIPELINE_MONGO_DB]
    inmates_col = enrichment_client[ENRICHMENT_MONGO_DB][ENRICHMENT_SUBJECTS_COLLECTION]

    totals: CollectionResult = _zero_result("TOTAL")
    exit_code = 0

    try:
        for col_name in SOURCE_COLLECTIONS:
            print(f"\n[sync] Processing {col_name} …")
            result = _sync_collection(pipeline_db, inmates_col, col_name, dry_run)
            _print_collection_line(result, dry_run)

            for key in ("scanned", "inserted", "updated", "unchanged", "skipped", "fallback_key_used"):
                totals[key] += result[key]
            totals["errors"].extend(result["errors"])

            if result["errors"]:
                exit_code = 1
    finally:
        pipeline_client.close()
        if enrichment_client is not pipeline_client:
            enrichment_client.close()

    _print_totals(totals, dry_run)
    return exit_code


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sync_to_enrichment",
        description=(
            "Sync simple_<county> pipeline records into the enrichment inmates collection. "
            "Opt-in only: must be called explicitly or via SYNC_TO_ENRICHMENT=true."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.getenv("SYNC_DRY_RUN", "").lower() in ("1", "true", "yes"),
        help="Print what would be upserted without writing to MongoDB.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    raise SystemExit(run(dry_run=args.dry_run))
