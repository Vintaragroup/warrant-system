"""
ingestion/lookups/jefferson_lookup.py
--------------------------------------------------------------------------------
Jefferson County Sheriff's Office inmate lookup via MyOCV JSON feed.

Feed URL: https://cdn.myocv.com/ocvapps/a125277701/Jeffersoninmates.json

Feed entry structure (flat JSON, PascalCase keys, no HTML parsing needed):
  ArrestID, Name, Age, Sex, Race, HairColor, EyeColor, Height, Weight,
  BookingDate (MM/DD/YYYY HH:MM:SS), ArrestingAgency,
  Charges: [{Description, DegreeCode, BondAmount, BondConditions}],
  Image: url string

Data flow:
  1. Fetch full JSON feed (public, no auth).
  2. Filter entries locally by last_name / first_name OR booking_date.
  3. Normalize to LookupResult.

Public search UI: https://www.sheriff.jeffersoncountytx.gov/inmateSearch

ENRICHMENT ONLY -- caller must provide last_name or booking_date.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

from ingestion.lookups.base import LookupResult, LookupScraper

FEED_URL = "https://cdn.myocv.com/ocvapps/a125277701/Jeffersoninmates.json"
PUBLIC_SEARCH_URL = "https://www.sheriff.jeffersoncountytx.gov/inmateSearch"
REQ_TIMEOUT = 30

_UA = {"User-Agent": "Mozilla/5.0 (compatible; WarrantDB-Enrichment/2.0)"}


def _utcnow_iso():
    return datetime.now(timezone.utc).isoformat()


def _clean_txt(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def _parse_date(s):
    if not s:
        return None
    s = s.strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if m:
        return m.group(1)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return None


def _resolve_filter_date(booking_date):
    token = booking_date.strip().lower()
    if token == "today":
        return date.today().isoformat()
    if token == "yesterday":
        return (date.today() - timedelta(days=1)).isoformat()
    return _parse_date(booking_date)


def _parse_money(s):
    if not s:
        return None
    cleaned = re.sub(r"[^\d.]", "", s)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _split_name(title):
    if "," in title:
        parts = title.split(",", 1)
        return parts[0].strip().upper(), parts[1].strip().upper()
    return title.strip().upper(), ""


class JeffersonLookup(LookupScraper):
    COLLECTION = "jefferson_events"
    COUNTY = "jefferson"
    SOURCE = "jefferson_sheriff_myocv"

    def search_person(
        self,
        last_name: str = "",
        first_name: str = "",
        booking_date: Optional[str] = None,
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        Fetch the full MyOCV feed and filter locally.

        last_name    -- case-insensitive prefix match against entry title
        first_name   -- optional additional filter after last_name match
        booking_date -- 'today', 'yesterday', or YYYY-MM-DD / M/D/YYYY
        """
        scraped_at = _utcnow_iso()
        feed = self._fetch_feed()

        last_up = last_name.strip().upper()
        first_up = first_name.strip().upper()
        filter_date = _resolve_filter_date(booking_date) if booking_date else None

        results: List[Dict[str, Any]] = []
        for entry in feed:
            parsed = self._parse_entry(entry, scraped_at)
            if parsed is None:
                continue

            if last_up:
                if not parsed.get("last_name", "").startswith(last_up):
                    continue
                if first_up and not parsed.get("first_name", "").startswith(first_up):
                    continue

            if filter_date:
                if _parse_date(parsed.get("booking_date")) != filter_date:
                    continue

            results.append(parsed)

        return results

    def lookup_by_date(
        self,
        booking_date: str,
        store: bool = False,
        limit: Optional[int] = None,
    ) -> List[LookupResult]:
        """Return all inmates booked on the given date. Bypasses last_name requirement."""
        self._audit_emit("started", {"booking_date": booking_date})
        results: List[LookupResult] = []
        try:
            raw_results = self.search_person(last_name="", booking_date=booking_date)
            if limit is not None:
                raw_results = raw_results[:limit]
            for raw in raw_results:
                record = self.normalize_record(raw)
                if record is None:
                    self._audit_inc("errors")
                    continue
                if store:
                    self.store_record(record)
                results.append(record)
                self._audit_inc("events_yielded")
        finally:
            self._audit_emit("finished", {"results_returned": len(results), "booking_date": booking_date})
        return results

    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """No separate detail page -- all data is in the feed entry."""
        return {}

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[LookupResult]:
        arrest_id = _clean_txt(raw.get("arrest_id") or "")
        if not arrest_id:
            return None

        last_name = (raw.get("last_name") or "").strip().upper() or None
        first_name = (raw.get("first_name") or "").strip().upper() or None
        if last_name and first_name:
            full_name = f"{last_name}, {first_name}"
        elif last_name:
            full_name = last_name
        else:
            full_name = _clean_txt(raw.get("name") or "").upper() or None

        booking_date_iso = _parse_date(raw.get("booking_date"))
        charges = raw.get("charges") or []
        first_charge_desc = (
            charges[0].get("description") if charges and isinstance(charges[0], dict) else None
        )

        total_bond: Optional[float] = None
        for ch in charges:
            if isinstance(ch, dict):
                amt = _parse_money(ch.get("bond_amount"))
                if amt:
                    total_bond = (total_bond or 0.0) + amt

        return LookupResult({
            "county":             self.COUNTY,
            "source":             self.SOURCE,
            "source_system":      self.SOURCE,
            "source_url":         PUBLIC_SEARCH_URL,
            "full_name":          full_name,
            "last_name":          last_name,
            "first_name":         first_name,
            "booking_number":     arrest_id,
            "arrest_id":          arrest_id,
            "inmate_id":          arrest_id,
            "age":                raw.get("age"),
            "sex":                raw.get("sex"),
            "race":               raw.get("race"),
            "hair_color":         raw.get("hair_color"),
            "eye_color":          raw.get("eye_color"),
            "height":             raw.get("height"),
            "weight":             raw.get("weight"),
            "booking_date":       booking_date_iso,
            "observed_at":        booking_date_iso,
            "scraped_at":         raw.get("scraped_at") or _utcnow_iso(),
            "ingested_at":        _utcnow_iso(),
            "arresting_agency":   raw.get("arresting_agency"),
            "charges":            charges,
            "charge_description": first_charge_desc,
            "bond_amount":        total_bond,
            "mugshot_url":        raw.get("mugshot_url"),
            "raw":                raw,
            "_upsert_key":        {
                "county": self.COUNTY,
                "source": self.SOURCE,
                "arrest_id": arrest_id,
            },
        })

    def _fetch_feed(self) -> List[Dict[str, Any]]:
        resp = requests.get(FEED_URL, headers=_UA, timeout=REQ_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        for key in ("items", "posts", "results", "data"):
            if isinstance(data.get(key), list):
                return data[key]
        print(f"[jefferson] unexpected feed structure: keys={list(data.keys())[:10]}")
        return []

    def _parse_entry(self, entry: Dict[str, Any], scraped_at: str) -> Optional[Dict[str, Any]]:
        """
        Normalize a raw feed entry (flat JSON, PascalCase) to our internal dict.

        Feed keys: ArrestID, Name, Age, Sex, Race, HairColor, EyeColor,
                   Height, Weight, BookingDate, ArrestingAgency, Charges, Image
        """
        arrest_id = _clean_txt(entry.get("ArrestID") or "")
        if not arrest_id:
            return None

        name = _clean_txt(entry.get("Name") or "")
        last_name, first_name = _split_name(name) if name else ("", "")

        charges_raw = entry.get("Charges") or []
        charges = [
            {
                "description": _clean_txt(ch.get("Description") or ""),
                "degree":      _clean_txt(ch.get("DegreeCode") or ""),
                "bond_amount": _clean_txt(ch.get("BondAmount") or ""),
                "conditions":  _clean_txt(ch.get("BondConditions") or ""),
            }
            for ch in charges_raw
            if isinstance(ch, dict) and _clean_txt(ch.get("Description") or "")
        ]

        return {
            "arrest_id":        arrest_id,
            "name":             name,
            "last_name":        last_name,
            "first_name":       first_name,
            "age":              entry.get("Age"),
            "sex":              _clean_txt(entry.get("Sex") or ""),
            "race":             _clean_txt(entry.get("Race") or ""),
            "hair_color":       _clean_txt(entry.get("HairColor") or ""),
            "eye_color":        _clean_txt(entry.get("EyeColor") or ""),
            "height":           _clean_txt(entry.get("Height") or ""),
            "weight":           _clean_txt(entry.get("Weight") or ""),
            "booking_date":     _clean_txt(entry.get("BookingDate") or ""),
            "arresting_agency": _clean_txt(entry.get("ArrestingAgency") or ""),
            "charges":          charges,
            "mugshot_url":      _clean_txt(entry.get("Image") or "") or None,
            "scraped_at":       scraped_at,
        }


# -- Dry-run entry point -------------------------------------------------------
# python3 -m ingestion.lookups.jefferson_lookup --last-name HITCHCOCK
# python3 -m ingestion.lookups.jefferson_lookup --booking-date today --limit 10

if __name__ == "__main__":
    import argparse
    import json
    import sys

    class _NullDb:
        class _NullColl:
            def find_one(self, *a, **kw):   return None
            def insert_one(self, *a, **kw): return type("R", (), {"inserted_id": None})()
            def update_one(self, *a, **kw): return type("R", (), {"upserted_id": None, "matched_count": 0, "modified_count": 0})()
            def find(self, *a, **kw):       return []
        def __getitem__(self, name):        return self._NullColl()
        def __getattr__(self, name):        return self._NullColl()

    ap = argparse.ArgumentParser(description="Jefferson MyOCV lookup dry-run")
    ap.add_argument("--dry-run",      action="store_true", default=True)
    ap.add_argument("--last-name",    default="")
    ap.add_argument("--first-name",   default="")
    ap.add_argument("--booking-date", default="")
    ap.add_argument("--limit",        type=int, default=20)
    args = ap.parse_args()

    if not args.last_name and not args.booking_date:
        print("[jefferson] ERROR: provide --last-name or --booking-date", file=sys.stderr)
        sys.exit(1)

    scraper = JeffersonLookup(_NullDb())

    if args.booking_date and not args.last_name:
        print(f"[jefferson] dry-run -- date filter {args.booking_date!r} limit={args.limit}")
        results = scraper.lookup_by_date(args.booking_date, limit=args.limit)
    else:
        print(f"[jefferson] dry-run -- name search {args.last_name!r}")
        results = scraper.lookup(
            last_name=args.last_name, first_name=args.first_name,
            fetch_details=False, store=False,
            booking_date=args.booking_date or None,
        )

    print(f"[jefferson] returned {len(results)} results")
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "inmate_id"]
        missing = [f for f in required if not r.get(f)]
        status = "WARN missing=" + str(missing) if missing else "OK"
        result_str = json.dumps(
            {k: v for k, v in r.items() if k not in ("raw", "_upsert_key")},
            default=str, indent=2,
        )
        print(f"  [{status}] result[{i}]: {result_str}")
    sys.exit(0)
