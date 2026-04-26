"""
ingestion/lookups/brazoria_lookup.py
─────────────────────────────────────────────────────────────────────────────
Brazoria County jail roster lookup — LookupScraper.

Source:    https://pubweb.brazoriacountytx.gov/PublicAccess/
Platform:  Tyler Technologies PublicAccess
Type:      ENRICHMENT ONLY — requires both first AND last name.

Tyler's PublicAccess requires both last_name AND first_name.
Calling search_person() with only a last name will raise ValueError.

Existing logic
──────────────
Full parsing is in the legacy ingestion/brazoria_jail.py file.
This class is a structured wrapper — parse_results() and fetch_detail()
contain TODO stubs pointing to the corresponding legacy functions.

Environment variables
─────────────────────
BRAZORIA_BASE_URL    base URL for the Tyler portal   (default: Tyler public URL)
BRAZORIA_DUMP_DIR    debug HTML dump directory        (default: debug_dumps/brazoria)
BRAZORIA_MAX_DEBUG   max debug files to keep          (default: 20)
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from ingestion.lookups.base import LookupResult, LookupScraper

BASE = os.getenv("BRAZORIA_BASE_URL", "https://pubweb.brazoriacountytx.gov/PublicAccess/")
SEARCH_PATH = "JailingSearch.aspx"

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Referer": urljoin(BASE, SEARCH_PATH) + "?ID=400",
    "Accept-Language": "en-US,en;q=0.9",
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


def _session() -> requests.Session:
    sess = requests.Session()
    sess.headers.update(_UA)
    return sess


class BrazoriaLookup(LookupScraper):
    """
    Brazoria County Tyler PublicAccess lookup.
    Requires both first_name and last_name — Tyler's search rejects partial names.
    """

    COLLECTION = "brazoria_inmates"
    COUNTY = "brazoria"
    SOURCE = "brazoria_tyler"

    def __init__(self, db):
        super().__init__(db)
        self._session: Optional[requests.Session] = None

    # ── search_person() ──────────────────────────────────────────────────────

    def search_person(
        self,
        last_name: str,
        first_name: str = "",
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        Search the Brazoria Tyler portal for a specific person.

        Both last_name AND first_name are required.
        Raises ValueError if first_name is empty.
        """
        if not first_name or not first_name.strip():
            raise ValueError(
                "BrazoriaLookup requires both first_name and last_name. "
                "Tyler PublicAccess will return no results without a first name."
            )

        scraped_at = _utcnow_iso()
        sess = _session()

        # Step 1: Load the search form to get cookies / VIEWSTATE
        form_url = urljoin(BASE, SEARCH_PATH) + "?ID=400"
        try:
            init_resp = sess.get(form_url, timeout=30)
            init_resp.raise_for_status()
        except Exception as exc:
            print(f"[brazoria] form load failed: {exc}")
            return []

        soup = BeautifulSoup(init_resp.text, "lxml")

        # Extract ASP.NET form state tokens
        def _hidden(name: str) -> str:
            tag = soup.find("input", {"name": name})
            return tag["value"] if tag and tag.get("value") else ""

        # Step 2: POST search form
        payload = {
            "__VIEWSTATE":          _hidden("__VIEWSTATE"),
            "__VIEWSTATEGENERATOR": _hidden("__VIEWSTATEGENERATOR"),
            "__EVENTVALIDATION":    _hidden("__EVENTVALIDATION"),
            "cboState":             "AA",  # All agencies
            "txtLastName":          last_name.strip().upper(),
            "txtFirstName":         first_name.strip().upper(),
            "btnSearch":            "Search",
        }

        try:
            search_resp = sess.post(form_url, data=payload, timeout=30)
            search_resp.raise_for_status()
        except Exception as exc:
            print(f"[brazoria] search POST failed: {exc}")
            return []

        # Step 3: Parse results table
        results = self._parse_results(search_resp.text, scraped_at)
        print(f"[brazoria] search '{last_name}, {first_name}' → {len(results)} results")
        return results

    # ── fetch_detail() ───────────────────────────────────────────────────────

    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """
        Fetch and parse a Brazoria Tyler detail page.
        Returns a raw dict with charges, bond amounts, and additional booking info.
        Ported from fetch_brazoria_detail() in ingestion/brazoria_jail.py.
        """
        scraped_at = _utcnow_iso()
        sess = _session()

        try:
            resp = sess.get(detail_url, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"[brazoria] detail fetch failed for {detail_url}: {exc}") from exc

        soup = BeautifulSoup(resp.text, "lxml")
        result: Dict[str, Any] = {
            "detail_url":       detail_url,
            "detail_fetched_at": scraped_at,
            "charges":          [],
            "bond_amount":      None,
        }

        # TODO: Port full charge table parsing from brazoria_jail.py
        # Legacy reference: BrazoriaScraper._parse_booking_detail()

        # Charge table: any table with header containing "charge" or "offense"
        # (ported from fetch_brazoria_detail in brazoria_jail.py)
        charges: List[Dict[str, Any]] = []
        bond_values: List[int] = []

        for tbl in soup.select("table"):
            heads = [th.get_text(strip=True) for th in tbl.select("thead th")]
            if not heads:
                first = tbl.select_one("tr")
                if first:
                    heads = [c.get_text(strip=True) for c in first.select("th,td")]
            norm_heads = [h.strip().lower() for h in heads]
            if not norm_heads:
                continue
            if not any("charge" in h or "offense" in h for h in norm_heads):
                continue

            data_rows = tbl.select("tbody tr") or tbl.select("tr")[1:]
            for tr in data_rows:
                cells = [td.get_text(strip=True) for td in tr.select("td")]
                if not cells:
                    continue
                charge: Dict[str, Any] = {}
                for i, h in enumerate(norm_heads):
                    charge[h] = cells[i] if i < len(cells) else None
                charges.append(charge)
                for key in ("bond amount", "bond", "bail amount", "amount", "set bond"):
                    if key in charge:
                        v = _to_int_money(charge.get(key))
                        if v:
                            bond_values.append(v)

        # Text fallback: look for "Total Bond $X" anywhere on the page
        if not bond_values:
            txt = soup.get_text(" ", strip=True)
            m2 = re.search(
                r"total\s+bond[^$0-9]*\$?\s*([0-9][0-9,]*)", txt, flags=re.I
            )
            if m2:
                v = _to_int_money(m2.group(1))
                if v:
                    bond_values.append(v)

        bond_total = (
            sum(bond_values) if len(bond_values) > 1 else (bond_values[0] if bond_values else None)
        )

        result["charges"] = charges
        if bond_total is not None:
            result["bond_amount"] = int(bond_total)

        return result

    # ── normalize_record() ───────────────────────────────────────────────────

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[LookupResult]:
        """
        Translate one raw Brazoria result row to a canonical LookupResult.
        """
        booking_number = (raw.get("booking_number") or "").strip() or None
        last_name      = (raw.get("last_name")      or "").strip().upper() or None
        first_name     = (raw.get("first_name")     or "").strip().upper() or None
        detail_url     = raw.get("detail_url") or None

        if not booking_number and not detail_url:
            return None

        upsert_key: Dict[str, Any] = {"county": self.COUNTY, "source": self.SOURCE}
        if booking_number:
            upsert_key["booking_number"] = booking_number
        elif detail_url:
            from hashlib import sha1
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
            "dob":            raw.get("dob") or None,
            "booking_number": booking_number,
            "booking_date":   raw.get("booking_date") or None,
            "charges":        raw.get("charges") or [],
            "bond_amount":    raw.get("bond_amount") or None,
            "detail_url":     detail_url,
            "county":         self.COUNTY,
            "source":         self.SOURCE,
            "scraped_at":     raw.get("scraped_at") or _utcnow_iso(),
            "observed_at":    raw.get("booking_date") or None,
            "_upsert_key":    upsert_key,
        })

    # ── Internal helpers ─────────────────────────────────────────────────────

    # ── Error / form detection (ported from brazoria_jail.py) ─────────────

    @staticmethod
    def _is_error_page(html: str) -> bool:
        return (
            "Public Access Error" in html
            or "An error occurred while processing your request." in html
        )

    @staticmethod
    def _is_search_form(html: str) -> bool:
        """True when Tyler bounced us back to the search form instead of results."""
        if 'id="SearchParameters"' not in html:
            return False
        if "Jail Records" in html or "+ First Name" in html or "+ Last Name" in html:
            return True
        if re.search(
            r'action="[^"]*JailingSearch\.aspx\?[^"]*(FirstName|LastName)=',
            html,
            flags=re.I,
        ):
            return True
        return False

    def _parse_results(self, html: str, scraped_at: str) -> List[Dict[str, Any]]:
        """
        Parse the Tyler PublicAccess search results table.

        Ported from brazoria_jail.py: _pick_results_table() + search_brazoria() row loop.
        Tyler's table always has both "booking number" and "defendant name" headers.
        Positional column mapping (Tyler layout):
          tds[0] = booking_number
          tds[1] = name (LAST, FIRST)
          tds[2] = booking_date
          tds[3] = release_date
          tds[4] = arresting_agency
          tds[5] = charges_summary
        """
        if self._is_error_page(html) or self._is_search_form(html):
            return []

        soup = BeautifulSoup(html, "lxml")
        rows: List[Dict[str, Any]] = []

        # Tyler results table must have BOTH headers
        results_tbl = None
        for tbl in soup.select("table"):
            hdrs = [
                th.get_text(strip=True).lower()
                for th in tbl.select("thead th") or tbl.select("tr:first-child th")
            ]
            if not hdrs:  # some Tyler pages put headers in first <tr> as <td>
                first_tr = tbl.select_one("tr")
                if first_tr:
                    hdrs = [c.get_text(strip=True).lower() for c in first_tr.select("th, td")]
            if "booking number" in hdrs and "defendant name" in hdrs:
                results_tbl = tbl
                break

        if not results_tbl:
            return rows

        data_rows = results_tbl.select("tbody tr") or [
            tr for tr in results_tbl.select("tr") if tr.find_all("td")
        ]

        for tr in data_rows:
            tds = tr.find_all("td")
            if len(tds) < 6:
                continue

            vals = [td.get_text(" ", strip=True) for td in tds]

            name_link = tr.select_one("a[href]")
            detail_href = name_link["href"] if name_link else None
            detail_url = urljoin(BASE, detail_href) if detail_href else None

            name = vals[1] if len(vals) > 1 else ""
            last_name = first_name = None
            if "," in name:
                parts = name.split(",", 1)
                last_name  = parts[0].strip().upper()
                first_name = parts[1].strip().upper()
            else:
                last_name = name.strip().upper() or None

            rows.append({
                "scraped_at":       scraped_at,
                "booking_number":   vals[0] or None,
                "last_name":        last_name,
                "first_name":       first_name,
                "booking_date":     vals[2] or None,
                "release_date":     vals[3] or None,
                "arresting_agency": vals[4] or None,
                "charges_summary":  vals[5] or None,
                "detail_url":       detail_url,
            })

        return rows


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.lookups.brazoria_lookup --dry-run --last-name SMITH [--first-name JOHN]

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

    ap = argparse.ArgumentParser(description="Brazoria lookup dry-run")
    ap.add_argument("--dry-run",    action="store_true", default=True)
    ap.add_argument("--last-name",  required=True, help="Last name to search")
    ap.add_argument("--first-name", default="",    help="First name to search")
    args = ap.parse_args()

    print(f"[brazoria] dry-run — searching '{args.last_name}, {args.first_name}' (no MongoDB writes)")
    scraper = BrazoriaLookup(_NullDb())

    results = scraper.lookup(
        last_name=args.last_name,
        first_name=args.first_name,
        fetch_details=True,
        store=False,
    )
    print(f"[brazoria] lookup() returned {len(results)} results")
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "full_name", "booking_number"]
        missing  = [f for f in required if not r.get(f)]
        status   = "WARN missing: " + str(missing) if missing else "OK"
        print(f"  [{status}] result[{i}]: {json.dumps({k: v for k, v in r.items() if k not in ('raw', '_upsert_key')}, default=str, indent=2)}")
    sys.exit(0)
