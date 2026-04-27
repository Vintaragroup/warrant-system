"""
scripts/smoke_test_ingestion_v2.py
───────────────────────────────────────────────────────────────────────────────
Offline schema validation for all five v2 ingestion classes.

Verifies:
  1. All five v2 modules import cleanly.
  2. Each class can be instantiated with a null (no-op) database handle.
  3. normalize_event() / normalize_record() produces all required canonical
     fields when fed synthetic (fake) raw records.
  4. No network connections are made (unless --live is passed).

Usage
─────
  python3 scripts/smoke_test_ingestion_v2.py          # offline checks only
  python3 scripts/smoke_test_ingestion_v2.py --live   # also run actual lookups

Exit code: 0 if all checks pass, 1 if any check fails.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ── Helpers ──────────────────────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class _NullDb:
    """Absorbs all pymongo calls silently."""

    class _NullColl:
        def find_one(self, *a, **kw):
            return None

        def insert_one(self, *a, **kw):
            return type("R", (), {"inserted_id": None})()

        def update_one(self, *a, **kw):
            return type("R", (), {
                "upserted_id": None,
                "matched_count": 0,
                "modified_count": 0,
            })()

        def find(self, *a, **kw):
            return []

    def __getitem__(self, name: str):
        return self._NullColl()

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._NullColl()


PASS = "PASS"
FAIL = "FAIL"
results: List[Dict[str, Any]] = []


def _check(name: str, ok: bool, detail: str = "") -> bool:
    status = PASS if ok else FAIL
    msg = f"  [{status}] {name}"
    if detail:
        msg += f"\n         {detail}"
    print(msg)
    results.append({"name": name, "status": status, "detail": detail})
    return ok


def _validate_fields(record: Dict[str, Any], required: List[str], label: str) -> bool:
    missing = [f for f in required if not record.get(f)]
    ok = len(missing) == 0
    detail = ""
    if not ok:
        detail = f"missing fields: {missing}"
    elif record:
        # Show a compact preview of the record
        preview = {k: v for k, v in record.items() if k not in ("raw", "_upsert_key")}
        detail = json.dumps(preview, default=str)[:200]
    return _check(label, ok, detail)


# ── 1. GalvestonP2CEventFeed ─────────────────────────────────────────────────

def smoke_galveston() -> bool:
    print("\n[galveston] GalvestonP2CEventFeed")
    ok = True

    # 1a. Import
    try:
        from ingestion.event_feeds.galveston_p2c import GalvestonP2CEventFeed
        _check("galveston: import", True)
    except Exception as exc:
        _check("galveston: import", False, str(exc))
        return False

    # 1b. Instantiate with null db
    try:
        feed = GalvestonP2CEventFeed(_NullDb())
        _check("galveston: instantiate", True)
    except Exception as exc:
        _check("galveston: instantiate", False, str(exc))
        return False

    # 1c. normalize_event() with fake raw record
    fake_raw = {
        "_scraped_at":    _utcnow_iso(),
        "full_name":      "SMITH, JOHN A",
        "last_name":      "SMITH",
        "first_name":     "JOHN",
        "dob":            "1985-03-14",
        "race":           "W",
        "sex":            "M",
        "age":            38,
        "person_id":      "TEST-001",   # P2C invid — must NOT appear in _upsert_key
        "booking_number": "B20240001",
        "booking_date":   "2024-01-15",
        "arrest_date":    "2024-01-15",
        "agency":         "GCSO",
        "charges":        [{"description": "TEST CHARGE"}],
        "bond_amount":    500.00,
    }
    try:
        event = feed.normalize_event(fake_raw)
        if event is None:
            ok = _check("galveston: normalize_event not None", False, "returned None")
        else:
            d = dict(event)

            # Canonical v2 fields
            canonical = [
                "county", "source", "full_name", "scraped_at",
                "source_id", "_upsert_key", "booking_number", "booking_date",
                "charges", "bond_amount",
            ]
            ok = _validate_fields(d, canonical, "galveston: canonical v2 fields") and ok

            # Compatibility alias fields added for read-path transition
            compat = [
                "booked_at",          # alias of booking_date
                "event_date",         # alias of best event date
                "county_display",     # "Galveston" (title-case for UI)
                "county_normalized",  # "galveston" (lowercase)
                "charge_description", # first charge as plain string
            ]
            ok = _validate_fields(d, compat, "galveston: compatibility alias fields") and ok

            # booked_at must equal booking_date (both ISO strings)
            ok = _check(
                "galveston: booked_at == booking_date",
                d.get("booked_at") == d.get("booking_date"),
                f"booked_at={d.get('booked_at')!r} booking_date={d.get('booking_date')!r}",
            ) and ok

            # county_display must be title-case
            ok = _check(
                "galveston: county_display == 'Galveston'",
                d.get("county_display") == "Galveston",
                repr(d.get("county_display")),
            ) and ok

            # county_normalized must be lowercase
            ok = _check(
                "galveston: county_normalized == 'galveston'",
                d.get("county_normalized") == "galveston",
                repr(d.get("county_normalized")),
            ) and ok

            # charge_description must be the first charge string
            ok = _check(
                "galveston: charge_description == 'TEST CHARGE'",
                d.get("charge_description") == "TEST CHARGE",
                repr(d.get("charge_description")),
            ) and ok

            # booking_number must be unchanged
            ok = _check(
                "galveston: booking_number unchanged",
                d.get("booking_number") == "B20240001",
                repr(d.get("booking_number")),
            ) and ok

            # _upsert_key must be a dict and must NOT reference person_id/invid
            upsert_key = d.get("_upsert_key") or {}
            ok = _check(
                "galveston: _upsert_key is dict",
                isinstance(upsert_key, dict),
                str(upsert_key),
            ) and ok
            ok = _check(
                "galveston: _upsert_key does not use invid/person_id",
                "person_id" not in upsert_key and "invid" not in upsert_key,
                f"keys: {list(upsert_key.keys())}",
            ) and ok
            ok = _check(
                "galveston: _upsert_key uses booking_number (preferred key)",
                "booking_number" in upsert_key,
                f"keys: {list(upsert_key.keys())}",
            ) and ok

    except Exception as exc:
        ok = _check("galveston: normalize_event", False, str(exc)) and ok

    return ok


# ── 2. HarrisReportIngestor ──────────────────────────────────────────────────

def smoke_harris() -> bool:
    print("\n[harris] HarrisReportIngestor")
    ok = True

    # 2a. Import
    try:
        from ingestion.reports.harris_reports import HarrisReportIngestor
        _check("harris: import", True)
    except Exception as exc:
        _check("harris: import", False, str(exc))
        return False

    # 2b. Instantiate
    try:
        ingestor = HarrisReportIngestor(_NullDb())
        _check("harris: instantiate", True)
    except Exception as exc:
        _check("harris: instantiate", False, str(exc))
        return False

    # 2c. normalize_record() — bond kind
    fake_bond_raw = {
        "_scraped_at":   _utcnow_iso(),
        "_report_meta":  {
            "kind": "bond",
            "group": "civil",
            "publish_date": "2024-01-15",
            "filename": "04-26-26-bond.txt",
        },
        "_cells": [
            "CIVIL",      # 0: court_group
            "123456789",  # 1: case_number
            "THEFT",      # 2: offense
            "123",        # 3: court_no
            "SMITH",      # 4: last_name
            "JOHN A",     # 5: first_middle
            "SPN001",     # 6: spn
            "W",          # 7: race
            "M",          # 8: sex
            "50000",      # 9: bond_amount
            "",           # 10: bond_note
            "123 MAIN",   # 11-15: address parts
            "",
            "",
            "",
            "",
            "HOUSTON",    # 16: city
            "77001",      # 17: zip
        ],
    }
    try:
        record = ingestor.normalize_record(fake_bond_raw)
        if record is None:
            ok = _check("harris: normalize_record(bond) not None", False, "returned None")
        else:
            required = ["county", "source_system", "scraped_at", "kind", "case_number", "_upsert_key"]
            ok = _validate_fields(record, required, "harris: normalize_record(bond) fields") and ok
    except Exception as exc:
        ok = _check("harris: normalize_record(bond)", False, str(exc)) and ok

    # 2d. normalize_record() — misfel kind
    fake_misfel_raw = {
        "_scraped_at":   _utcnow_iso(),
        "_report_meta":  {
            "kind": "misfel",
            "group": "civil",
            "publish_date": "2024-01-15",
            "filename": "misdemeanor.txt",
        },
        "_cells": [
            "SMITH, JOHN A",  # 0: name
            "850314",         # 1: dob
            "SPN002",         # 2: spn
            "10000",          # 3: bond_amount
            "",               # 4: bond_note
            "240115",         # 5: case_date
            "CIVIL",          # 6: court_group
            "987654321",      # 7: case_number
            "ASSAULT",        # 8: offense
            "456 OAK",        # 9-11: address
            "",
            "",
            "HOUSTON",        # 12: city
            "TX",             # 13: state
            "77002",          # 14: zip
            "7135550001",     # 15: phone
        ],
    }
    try:
        record = ingestor.normalize_record(fake_misfel_raw)
        if record is None:
            ok = _check("harris: normalize_record(misfel) not None", False, "returned None")
        else:
            required = ["county", "source_system", "scraped_at", "kind", "case_number", "_upsert_key"]
            ok = _validate_fields(record, required, "harris: normalize_record(misfel) fields") and ok
    except Exception as exc:
        ok = _check("harris: normalize_record(misfel)", False, str(exc)) and ok

    return ok


# ── 3. BrazoriaLookup ────────────────────────────────────────────────────────

def smoke_brazoria() -> bool:
    print("\n[brazoria] BrazoriaLookup")
    ok = True

    # 3a. Import
    try:
        from ingestion.lookups.brazoria_lookup import BrazoriaLookup
        _check("brazoria: import", True)
    except Exception as exc:
        _check("brazoria: import", False, str(exc))
        return False

    # 3b. Instantiate
    try:
        scraper = BrazoriaLookup(_NullDb())
        _check("brazoria: instantiate", True)
    except Exception as exc:
        _check("brazoria: instantiate", False, str(exc))
        return False

    # 3c. normalize_record()
    fake_raw = {
        "full_name":      "SMITH, JOHN",
        "last_name":      "SMITH",
        "first_name":     "JOHN",
        "dob":            "1985-03-14",
        "booking_number": "BRA20240001",
        "booking_date":   "2024-01-15",
        "charges":        [{"description": "TEST CHARGE"}],
        "detail_url":     "https://example.com/inmate/1",
        "scraped_at":     _utcnow_iso(),
    }
    try:
        record = scraper.normalize_record(fake_raw)
        if record is None:
            ok = _check("brazoria: normalize_record not None", False, "returned None")
        else:
            required = ["county", "source", "scraped_at", "full_name", "_upsert_key"]
            ok = _validate_fields(dict(record), required, "brazoria: normalize_record fields") and ok
    except Exception as exc:
        ok = _check("brazoria: normalize_record", False, str(exc)) and ok

    return ok


# ── 4. FortBendLookup ────────────────────────────────────────────────────────

def smoke_fortbend() -> bool:
    print("\n[fortbend] FortBendLookup")
    ok = True

    # 4a. Import
    try:
        from ingestion.lookups.fortbend_lookup import FortBendLookup
        _check("fortbend: import", True)
    except Exception as exc:
        _check("fortbend: import", False, str(exc))
        return False

    # 4b. Instantiate
    try:
        scraper = FortBendLookup(_NullDb())
        _check("fortbend: instantiate", True)
    except Exception as exc:
        _check("fortbend: instantiate", False, str(exc))
        return False

    # 4c. normalize_record()
    fake_raw = {
        "last_name":      "RODRIGUEZ",
        "first_name":     "MARIA",
        "booking_number": "FB20240001",
        "booking_date":   "2024-01-15",
        "dob":            "1990-06-20",
        "detail_url":     "https://example.com/fb/inmate/1",
        "charges":        [],
        "scraped_at":     _utcnow_iso(),
    }
    try:
        record = scraper.normalize_record(fake_raw)
        if record is None:
            ok = _check("fortbend: normalize_record not None", False, "returned None")
        else:
            required = ["county", "source", "scraped_at", "full_name", "_upsert_key"]
            ok = _validate_fields(dict(record), required, "fortbend: normalize_record fields") and ok
    except Exception as exc:
        ok = _check("fortbend: normalize_record", False, str(exc)) and ok

    return ok


# ── 5. JeffersonLookup ──────────────────────────────────────────────────────

def smoke_jefferson() -> bool:
    print("\n[jefferson] JeffersonLookup")
    ok = True

    # 5a. Import
    try:
        from ingestion.lookups.jefferson_lookup import JeffersonLookup
        _check("jefferson: import", True)
    except Exception as exc:
        _check("jefferson: import", False, str(exc))
        return False

    # 5b. Instantiate
    try:
        scraper = JeffersonLookup(_NullDb())
        _check("jefferson: instantiate", True)
    except Exception as exc:
        _check("jefferson: instantiate", False, str(exc))
        return False

    # 5c. normalize_record()
    fake_raw = {
        "full_name":      "SMITH, JANE",
        "last_name":      "SMITH",
        "first_name":     "JANE",
        "inmate_id":      "JEF20240001",
        "booking_date":   "2024-01-15",
        "charges":        [{"description": "TEST CHARGE"}],
        "detail_url":     "https://example.com/jeff/inmate/1",
        "scraped_at":     _utcnow_iso(),
    }
    try:
        record = scraper.normalize_record(fake_raw)
        if record is None:
            ok = _check("jefferson: normalize_record not None", False, "returned None")
        else:
            required = ["county", "source", "scraped_at", "full_name", "_upsert_key"]
            ok = _validate_fields(dict(record), required, "jefferson: normalize_record fields") and ok
    except Exception as exc:
        ok = _check("jefferson: normalize_record", False, str(exc)) and ok

    return ok


# ── Live mode (optional) ──────────────────────────────────────────────────────

def smoke_live_lookups() -> bool:
    """Run real network lookups against all three lookup scrapers."""
    from storage.mongo_client import get_db  # noqa: PLC0415
    db = get_db()
    ok = True

    for source, module, cls_name, last, first in [
        ("fortbend",  "ingestion.lookups.fortbend_lookup",  "FortBendLookup",  "RODRIGUEZ", ""),
        ("jefferson", "ingestion.lookups.jefferson_lookup", "JeffersonLookup", "SMITH",     ""),
        ("brazoria",  "ingestion.lookups.brazoria_lookup",  "BrazoriaLookup",  "SMITH",     "JOHN"),
    ]:
        print(f"\n[{source}] live lookup: last_name={last!r} first_name={first!r}")
        try:
            import importlib  # noqa: PLC0415
            mod = importlib.import_module(module)
            scraper = getattr(mod, cls_name)(db)
            results_list = scraper.lookup(last_name=last, first_name=first, store=False)
            ok = _check(
                f"{source}: live lookup returned results",
                len(results_list) > 0,
                f"{len(results_list)} results",
            ) and ok
        except Exception as exc:
            ok = _check(f"{source}: live lookup", False, str(exc)) and ok

    return ok


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description="Offline smoke test for v2 ingestion classes")
    p.add_argument("--live", action="store_true", help="Also run live network lookups")
    args = p.parse_args()

    print("=" * 60)
    print("V2 Ingestion Smoke Test")
    print("=" * 60)

    all_ok = True
    all_ok = smoke_galveston() and all_ok
    all_ok = smoke_harris()    and all_ok
    all_ok = smoke_brazoria()  and all_ok
    all_ok = smoke_fortbend()  and all_ok
    all_ok = smoke_jefferson() and all_ok

    if args.live:
        all_ok = smoke_live_lookups() and all_ok

    # ── Summary ──────────────────────────────────────────────────────────────
    passed = sum(1 for r in results if r["status"] == PASS)
    failed = sum(1 for r in results if r["status"] == FAIL)
    print("\n" + "=" * 60)
    print(f"SUMMARY: {passed} passed / {failed} failed / {len(results)} total")
    if failed:
        print("\nFailed checks:")
        for r in results:
            if r["status"] == FAIL:
                print(f"  - {r['name']}: {r['detail']}")
    else:
        print("All checks passed.")
    print("=" * 60)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
