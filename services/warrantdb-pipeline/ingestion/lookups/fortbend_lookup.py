"""
ingestion/lookups/fortbend_lookup.py
─────────────────────────────────────────────────────────────────────────────
Fort Bend County jail lookup — LookupScraper.

Source:    https://jailinq.fortbendcountytx.gov/
Platform:  Custom Fort Bend jail inquiry portal
Type:      ENRICHMENT ONLY — caller must provide last_name at minimum.

Fort Bend accepts last_name alone (first_name is optional and narrows results).

Existing logic
──────────────
Full parsing is in the legacy ingestion/fortbend_jail.py file.
This class is a structured wrapper with TODO stubs pointing to legacy helpers.

Environment variables
─────────────────────
FORTBEND_BASE_URL   portal base URL   (default: https://jailinq.fortbendcountytx.gov/)
FORTBEND_DELAY_SEC  delay between requests (default: 0.5)
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlencode

import requests
from bs4 import BeautifulSoup

from ingestion.lookups.base import LookupResult, LookupScraper

BASE = os.getenv("FORTBEND_BASE_URL", "https://jailinq.fortbendcountytx.gov/")
DELAY = float(os.getenv("FORTBEND_DELAY_SEC", "0.5"))

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_int_money(s: Optional[str]) -> Optional[int]:
    if not s:
        return None
    m = re.search(r"(\$?\s*[0-9][0-9,]*)", s.replace("\xa0", " "))
    if not m:
        return None
    digits = re.sub(r"[^0-9]", "", m.group(1))
    return int(digits) if digits.isdigit() else None


def _parse_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        mm, dd, yy = map(int, m.groups())
        try:
            return datetime(yy, mm, dd).date().isoformat()
        except Exception:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "")).date().isoformat()
    except Exception:
        return None


class FortBendLookup(LookupScraper):
    """
    Fort Bend County jail inquiry lookup.
    Last name required; first name narrows results.
    """

    COLLECTION = "fortbend_inmates"
    COUNTY = "fortbend"
    SOURCE = "fortbend_jailinq"

    # ── search_person() ──────────────────────────────────────────────────────

    def search_person(
        self,
        last_name: str,
        first_name: str = "",
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        GET https://jailinq.fortbendcountytx.gov/ with LastName= and optionally FirstName=

        Returns list of raw result row dicts from the results table.
        """
        scraped_at = _utcnow_iso()

        params: Dict[str, str] = {"LastName": last_name.strip().upper()}
        if first_name and first_name.strip():
            params["FirstName"] = first_name.strip().upper()
        params["SearchButton"] = "Search"  # required by jailinq

        # Additional hints
        if kwargs.get("dob"):
            params["DateOfBirth"] = kwargs["dob"]

        url = BASE + "?" + urlencode(params)
        print(f"[fortbend] searching: {url}")

        try:
            # warm-up GET to obtain cookies/anti-forgery state
            sess = requests.Session()
            sess.headers.update(_UA)
            sess.get(BASE, timeout=30)
            resp = sess.get(url, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            print(f"[fortbend] search failed: {exc}")
            return []

        time.sleep(DELAY)

        results = self._parse_results(resp.text, scraped_at)
        print(f"[fortbend] search '{last_name}, {first_name}' → {len(results)} results")
        return results

    # ── fetch_detail() ───────────────────────────────────────────────────────

    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """
        Fetch and parse a Fort Bend jail detail page.

        Page structure (as of 2025):
          - Profile card: <div class="card-body"> containing <h6> elements with
            "<b>Label: </b> Value" pairs for Name, Jail ID, Age, Race, Sex.
            NOTE: booking_date and DOB are NOT present on this page.
          - Charges table: <table id="BookingsTable"> with columns:
            Agency, Authority, Warrant Number, JUS, Charge Description,
            LVL, Bail Type, Bail Amount, Fines, Disposition.
        """
        scraped_at = _utcnow_iso()

        try:
            resp = requests.get(detail_url, headers=_UA, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"[fortbend] detail fetch failed: {exc}") from exc

        time.sleep(DELAY)
        soup = BeautifulSoup(resp.text, "lxml")

        result: Dict[str, Any] = {
            "detail_url":        detail_url,
            "detail_fetched_at": scraped_at,
            "charges":           [],
            "bond_amount":       None,
        }

        # ── Profile card (h6 elements inside .card-body) ──────────────────────
        # Format: <h6><b>Label: </b> Value</h6>
        # Fields available: Name, Jail ID, Age, Race, Sex
        # NOTE: booking_date and DOB are NOT exposed by the Fort Bend portal.
        card_body = soup.select_one(".card-body")
        if card_body:
            for h6 in card_body.select("h6"):
                text = h6.get_text(" ", strip=True)
                if ":" not in text:
                    continue
                label, _, value = text.partition(":")
                label = label.strip().lower()
                value = value.strip()
                if not value:
                    continue
                if "name" in label and "jail" not in label:
                    raw_name = value.strip()
                    if "," in raw_name:
                        parts = raw_name.split(",", 1)
                        result["last_name"]  = parts[0].strip().upper()
                        result["first_name"] = parts[1].strip().upper()
                        result["full_name"]  = f"{result['last_name']}, {result['first_name']}"
                    else:
                        result["full_name"] = raw_name.upper()
                elif "jail id" in label or "jail_id" in label:
                    result["jail_id"] = value
                elif "age" in label:
                    result["age"] = value
                elif "race" in label:
                    result["race"] = value
                elif "sex" in label or "gender" in label:
                    result["sex"] = value

        # booking_date is NOT available anywhere on the Fort Bend portal.
        # It is absent from both the search results and the detail page.
        # Do NOT set result["booking_date"] here.

        # Strip None values
        result = {k: v for k, v in result.items() if v is not None or k in ("detail_url", "detail_fetched_at", "charges", "bond_amount")}

        # ── Charges table (id="BookingsTable") ────────────────────────────────
        # Columns: Agency, Authority, Warrant Number, JUS, Charge Description,
        #          LVL, Bail Type, Bail Amount, Fines, Disposition
        def _headers_for(table: Any) -> List[str]:
            heads = [th.get_text(strip=True) for th in table.select("thead th")]
            if not heads:
                first = table.select_one("tr")
                if first:
                    heads = [c.get_text(strip=True) for c in first.select("th, td")]
            return [h.strip().lower() for h in heads if h.strip()]

        charges: List[Dict[str, Any]] = []
        bond_values: List[int] = []

        # Prefer the named BookingsTable; fall back to any table with charge columns
        target_tbl = soup.select_one("#BookingsTable") or soup.select_one("table")
        candidate_tbls = soup.select("table")
        if not target_tbl:
            for t in candidate_tbls:
                heads = _headers_for(t)
                if any(x in heads for x in ("charge description", "charge", "offense")):
                    target_tbl = t
                    break

        if target_tbl:
            heads = _headers_for(target_tbl)
            body_rows = target_tbl.select("tbody tr") or target_tbl.select("tr")[1:]
            for tr in body_rows:
                cells = [td.get_text(strip=True) for td in tr.select("td")]
                if not cells:
                    continue
                charge: Dict[str, Any] = {}
                for i, h in enumerate(heads):
                    charge[h] = cells[i] if i < len(cells) else None

                # Normalize to snake_case keys
                norm: Dict[str, Any] = {}
                for k, v in charge.items():
                    norm[k.replace(" ", "_")] = v
                charge.update(norm)

                # Parse bail/bond amount
                for key in ("bail_amount", "bail amount", "bond amount", "bond"):
                    raw_v = charge.get(key) or charge.get(key.replace(" ", "_"))
                    if raw_v:
                        v = _to_int_money(str(raw_v))
                        if v:
                            charge["bail_amount_int"] = v
                            bond_values.append(v)
                            break

                charges.append(charge)

        bond_total = (
            sum(bond_values) if len(bond_values) > 1 else (bond_values[0] if bond_values else None)
        )

        result["charges"]     = charges
        result["bond_amount"] = bond_total

        return result

    # ── normalize_record() ───────────────────────────────────────────────────

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[LookupResult]:
        """
        Translate one raw Fort Bend result row to a canonical LookupResult.
        """
        booking_number = (raw.get("booking_number") or raw.get("booking number") or "").strip() or None
        last_name      = (raw.get("last_name")  or "").strip().upper() or None
        first_name     = (raw.get("first_name") or "").strip().upper() or None
        detail_url     = raw.get("detail_url") or None

        if not booking_number and not detail_url:
            return None

        upsert_key: Dict[str, Any] = {"county": self.COUNTY, "source": self.SOURCE}
        if booking_number:
            upsert_key["booking_number"] = booking_number
        elif detail_url:
            upsert_key["detail_hash"] = sha1(detail_url.encode()).hexdigest()[:12]

        full_name: Optional[str] = None
        if last_name and first_name:
            full_name = f"{last_name}, {first_name}"
        elif last_name:
            full_name = last_name

        return LookupResult({
            "full_name":      full_name,
            "last_name":      last_name,
            "first_name":     first_name,
            "dob":            _parse_date(raw.get("dob")),
            "booking_number": booking_number,
            "booking_date":   _parse_date(raw.get("booking_date") or raw.get("booked date")),
            "charges":        raw.get("charges") or [],
            "bond_amount":    raw.get("bond_amount") or _to_int_money(raw.get("total bond")),
            "detail_url":     detail_url,
            "county":         self.COUNTY,
            "source":         self.SOURCE,
            "scraped_at":     raw.get("scraped_at") or _utcnow_iso(),
            "observed_at":    _parse_date(raw.get("booking_date") or raw.get("booked date")),
            "_upsert_key":    upsert_key,
        })

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _parse_results(self, html: str, scraped_at: str) -> List[Dict[str, Any]]:
        """
        Parse Fort Bend jailinq results table.

        Actual columns on the live site (verified 2025):
          Booking Number | Name (with detail link) | Jail ID | Race | Sex

        NOTE: booking_date and DOB are NOT present in search results.
              They are also absent from the detail page.
        """
        soup = BeautifulSoup(html, "lxml")
        rows: List[Dict[str, Any]] = []

        # Primary: named table ID
        results_tbl = soup.select_one("#InmatesTable")
        if not results_tbl:
            candidates = soup.select("table")
            for tbl in candidates:
                hdrs = [th.get_text(strip=True).lower() for th in tbl.select("th")]
                if any("name" in h for h in hdrs) and any("jail" in h or "booking" in h for h in hdrs):
                    results_tbl = tbl
                    break
            if not results_tbl and candidates:
                results_tbl = max(
                    candidates,
                    key=lambda t: len(t.select("thead th, tr:first-child th, tr:first-child td")),
                )

        if not results_tbl:
            return rows

        # Detect column positions from headers
        header_cells = results_tbl.select("thead th")
        headers = [th.get_text(strip=True).lower() for th in header_cells]

        def _col(*names: str) -> Optional[int]:
            for name in names:
                for i, h in enumerate(headers):
                    if name in h:
                        return i
            return None

        col_booking_number = _col("booking number", "booking #", "booking no")
        col_name           = _col("name")
        col_jail_id        = _col("jail id", "jail_id", "inmate id")
        col_race           = _col("race")
        col_sex            = _col("sex", "gender")
        col_dob            = _col("dob", "date of birth", "birth")
        col_booking_date   = _col("booking date", "date booked", "admit date", "booked")

        body_rows = results_tbl.select("tbody tr") or [
            tr for tr in results_tbl.select("tr") if tr.find_all("td")
        ]

        for tr in body_rows:
            tds = tr.find_all("td")
            if not tds:
                continue

            vals = [td.get_text(strip=True) for td in tds]

            def _v(col: Optional[int]) -> Optional[str]:
                if col is None or col >= len(vals):
                    return None
                s = vals[col].strip()
                return s if s else None

            name_link = tr.select_one("td a[href]")
            detail_href = name_link.get("href") if name_link else None
            detail_url = urljoin(BASE, detail_href) if detail_href else None

            name_raw = _v(col_name) or ""
            last_name: Optional[str] = None
            first_name: Optional[str] = None
            if "," in name_raw:
                parts = name_raw.split(",", 1)
                last_name  = parts[0].strip().upper() or None
                first_name = parts[1].strip().upper() or None
            elif name_raw:
                last_name = name_raw.upper()

            row: Dict[str, Any] = {
                "scraped_at":      scraped_at,
                "last_name":       last_name,
                "first_name":      first_name,
                "booking_number":  _v(col_booking_number),
                "id":              _v(col_jail_id),
                "race":            _v(col_race),
                "sex":             _v(col_sex),
                "dob":             _v(col_dob),            # None on Fort Bend
                "booking_date":    _v(col_booking_date),   # None on Fort Bend
                "detail_url":      detail_url,
            }

            # Remove None values except required keys
            row = {k: v for k, v in row.items() if v is not None or k in ("scraped_at", "detail_url")}

            rows.append(row)

        return rows


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.lookups.fortbend_lookup --dry-run --last-name SMITH [--first-name JOHN]

if __name__ == "__main__":
    import argparse
    import json
    import sys

    class _NullDb:
        class _NullColl:
            def find_one(self, *a, **kw):          return None
            def insert_one(self, *a, **kw):         return type("R", (), {"inserted_id": None})()
            def update_one(self, *a, **kw):         return type("R", (), {"upserted_id": None, "matched_count": 0, "modified_count": 0})()
            def find(self, *a, **kw):               return []
        def __getitem__(self, name):                return self._NullColl()
        def __getattr__(self, name):                return self._NullColl()

    ap = argparse.ArgumentParser(description="Fort Bend lookup dry-run")
    ap.add_argument("--dry-run",    action="store_true", default=True)
    ap.add_argument("--last-name",  required=True, help="Last name to search")
    ap.add_argument("--first-name", default="",    help="First name to search")
    args = ap.parse_args()

    print(f"[fortbend] dry-run — searching '{args.last_name}, {args.first_name}' (no MongoDB writes)")
    scraper = FortBendLookup(_NullDb())

    results = scraper.lookup(
        last_name=args.last_name,
        first_name=args.first_name,
        fetch_details=True,
        store=False,
    )
    print(f"[fortbend] lookup() returned {len(results)} results")
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "full_name"]
        missing  = [f for f in required if not r.get(f)]
        status   = "WARN missing: " + str(missing) if missing else "OK"
        print(f"  [{status}] result[{i}]: {json.dumps({k: v for k, v in r.items() if k not in ('raw', '_upsert_key')}, default=str, indent=2)}")
    sys.exit(0)
