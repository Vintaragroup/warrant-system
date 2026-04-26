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
        Ported from fetch_fort_bend_detail() in ingestion/fortbend_jail.py.
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

        # Property pairs from two-column table rows
        prop_map: Dict[str, str] = {}
        for tr in soup.select("tr"):
            cells = tr.find_all("td")
            if len(cells) >= 2:
                label = cells[0].get_text(strip=True).lower().rstrip(":").strip()
                value = cells[1].get_text(strip=True)
                if label and value:
                    prop_map[label] = value

        def _g(*keys: str) -> Optional[str]:
            for k in keys:
                if k in prop_map and prop_map[k]:
                    return prop_map[k]
            return None

        result["full_name"]      = _g("name", "inmate name") or None
        result["dob"]            = _parse_date(_g("date of birth", "dob"))
        result["race"]           = _g("race")
        result["sex"]            = _g("sex", "gender")
        result["booking_number"] = _g("booking number", "booking #", "booking no")
        result["booking_date"]   = _parse_date(_g("booking date", "date booked", "admit date", "booked date"))
        result["agency"]         = _g("arresting agency", "agency")

        # Strip None values so they don't overwrite existing base fields in _merge_detail
        result = {k: v for k, v in result.items() if v is not None or k in ("detail_url", "detail_fetched_at", "charges", "bond_amount")}

        # ── Charges table ─────────────────────────────────────────────────────
        # Ported from fetch_fort_bend_detail: find charge/offense/description table,
        # fall back to widest table by column count.
        def _headers_for(table: Any) -> List[str]:
            heads = [th.get_text(strip=True) for th in table.select("thead th")]
            if not heads:
                first = table.select_one("tr")
                if first:
                    heads = [c.get_text(strip=True) for c in first.select("th, td")]
            return [h.strip().lower() for h in heads if h.strip()]

        charges: List[Dict[str, Any]] = []
        bond_values: List[int] = []

        candidate_tbls = soup.select("table")
        target_tbl = None
        for t in candidate_tbls:
            heads = _headers_for(t)
            if any(x in heads for x in ("charge", "charge description", "offense", "description")):
                target_tbl = t
                break
        if target_tbl is None and candidate_tbls:
            target_tbl = max(candidate_tbls, key=lambda t: len(_headers_for(t)))

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

                # Normalize snake_case keys and parse bail_amount_int
                norm: Dict[str, Any] = {}
                for k, v in charge.items():
                    norm[k.replace(" ", "_")] = v
                charge.update(norm)
                if "bail_amount" in norm:
                    charge["bail_amount_int"] = _to_int_money(norm["bail_amount"])

                for key in ("bond", "bond amount", "bond amt", "bond ($)",
                             "amount", "set bond", "bail amount"):
                    if key in charge:
                        v = _to_int_money(charge.get(key))
                        if v:
                            bond_values.append(v)

                charges.append(charge)

        # Text fallback
        if not bond_values:
            txt_full = soup.get_text(" ", strip=True)
            m2 = re.search(
                r"total\s+bond[^$0-9]*\$?\s*([0-9][0-9,]*)", txt_full, flags=re.I
            )
            if m2:
                v = _to_int_money(m2.group(1))
                if v:
                    bond_values.append(v)

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
        Ported from search_fort_bend() in ingestion/fortbend_jail.py.

        Fort Bend columns (may be shifted when tds[0] is a booking number):
          tds[0] = name (or booking_number if all-digits)
          tds[1] = id / VarJailID (or name if tds[0] was booking_number)
          tds[2] = dob / VarJailID (or id)
          tds[3] = booking_date
        """
        soup = BeautifulSoup(html, "lxml")
        rows: List[Dict[str, Any]] = []

        # Primary: named table ID
        results_tbl = soup.select_one("#InmatesTable")
        if not results_tbl:
            candidates = soup.select("table")
            for tbl in candidates:
                hdrs = [th.get_text(strip=True).lower() for th in tbl.select("th")]
                if any("name" in h for h in hdrs) and any("booking" in h for h in hdrs):
                    results_tbl = tbl
                    break
            if not results_tbl and candidates:
                # fallback: widest table
                results_tbl = max(
                    candidates,
                    key=lambda t: len(t.select("thead th, tr:first-child th, tr:first-child td")),
                )

        if not results_tbl:
            return rows

        body_rows = results_tbl.select("tbody tr") or [
            tr for tr in results_tbl.select("tr") if tr.find_all("td")
        ]

        for tr in body_rows:
            tds = tr.find_all("td")
            if not tds:
                continue

            vals = [td.get_text(strip=True) for td in tds]

            name_link = tr.select_one("td a[href]")
            detail_href = name_link.get("href") if name_link else None
            detail_url = urljoin(BASE, detail_href) if detail_href else None

            row: Dict[str, Any] = {
                "scraped_at":   scraped_at,
                "name":         vals[0] if len(vals) > 0 else None,
                "id":           vals[1] if len(vals) > 1 else None,
                "dob":          vals[2] if len(vals) > 2 else None,
                "booking_date": vals[3] if len(vals) > 3 else None,
                "detail_url":   detail_url,
            }

            # Column shift: if tds[0] is all-digit and tds[1] contains a comma
            # → tds[0] is booking_number, tds[1] is name
            if (
                isinstance(row["name"], str)
                and row["name"].isdigit()
                and isinstance(row["id"], str)
                and "," in row["id"]
            ):
                row["booking_number"] = row["name"]
                row["name"] = row["id"]
                row["id"]   = row["dob"]
                row["dob"]  = None

            # Normalize name
            name = (row.pop("name", "") or "").strip()
            if "," in name:
                parts = name.split(",", 1)
                row["last_name"]  = parts[0].strip().upper()
                row["first_name"] = parts[1].strip().upper()
            else:
                row["last_name"] = name.upper() or None

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
