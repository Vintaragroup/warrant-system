"""
ingestion/lookups/brazoria_lookup.py
─────────────────────────────────────────────────────────────────────────────
Brazoria County jail roster lookup — LookupScraper.

Source:    https://portal-txbrazoria.tylertech.cloud/PublicAccess/
Platform:  Tyler Technologies PublicAccess (ASP.NET WebForms)
Type:      ENRICHMENT ONLY — requires both first AND last name.

Tyler's PublicAccess requires both last_name AND first_name.
Date-only searches are NOT supported — Tyler rejects POSTs without names.
booking_date is an optional additive filter that narrows results by booking date.

Session requirements
────────────────────
Two-step session init per search:
  1. GET default.aspx  → sets AWSALB, ASP.NET_SessionId, .ASPXFORMSPUBLICACCESS cookies
  2. GET JailingSearch.aspx?ID=400  → fresh __VIEWSTATE / __EVENTVALIDATION tokens

Critical: JavaScript function ValidateSearchParameters() normally sets
  SearchType="PARTYNAME" and NameTypeKy="ALIAS" before form submission.
  Without these values the server returns ErrorOccured.aspx.

Environment variables
─────────────────────
BRAZORIA_BASE_URL    base URL for the Tyler portal   (default: Tyler cloud URL)
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import requests
from bs4 import BeautifulSoup

from ingestion.lookups.base import LookupResult, LookupScraper

BASE = os.getenv(
    "BRAZORIA_BASE_URL",
    "https://portal-txbrazoria.tylertech.cloud/PublicAccess/",
)
SEARCH_URL = BASE + "JailingSearch.aspx?ID=400"

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
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


def _to_mmddyyyy(date_str: str) -> str:
    """Convert YYYY-MM-DD to MM/DD/YYYY.  Passes through if already MM/DD/YYYY."""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        y, mo, d = date_str.split("-")
        return f"{mo}/{d}/{y}"
    return date_str


_DATE_FORMATS = [
    "%m/%d/%Y %I:%M %p",   # MM/DD/YYYY HH:MM AM/PM
    "%m/%d/%Y %H:%M",       # MM/DD/YYYY HH:MM (24h)
    "%m/%d/%Y",             # MM/DD/YYYY
]


def _parse_date_to_iso(s: Optional[str]) -> Optional[str]:
    """
    Normalize a date string to ISO-8601 format.

    Accepts:
      - MM/DD/YYYY
      - MM/DD/YYYY HH:MM
      - MM/DD/YYYY HH:MM AM/PM
      - YYYY-MM-DD (already ISO — passed through)
      - YYYY-MM-DDTHH:MM:SS... (already ISO — passed through)

    Returns YYYY-MM-DD string when time component is midnight/absent,
    or YYYY-MM-DDTHH:MM:SS when a meaningful time is present.
    Returns the original string unchanged if parsing fails.
    """
    if not s:
        return None
    stripped = s.strip()
    if not stripped:
        return None
    # Already ISO date or datetime
    if re.match(r"^\d{4}-\d{2}-\d{2}", stripped):
        return stripped
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(stripped, fmt)
            if dt.hour == 0 and dt.minute == 0 and dt.second == 0:
                return dt.strftime("%Y-%m-%d")
            return dt.strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
    # Unrecognized format — return as-is so data is not silently dropped
    return stripped


class BrazoriaLookup(LookupScraper):
    """
    Brazoria County Tyler PublicAccess lookup.

    Requires both first_name and last_name — Tyler's server rejects searches
    that omit either.  booking_date is an optional additive filter (MM/DD/YYYY
    or YYYY-MM-DD); it does NOT replace the name requirement.
    """

    COLLECTION = "brazoria_inmates"
    COUNTY = "brazoria"
    SOURCE = "brazoria_tyler_publicaccess"

    def __init__(self, db):
        super().__init__(db)
        self._sess: Optional[requests.Session] = None  # reused across detail fetches

    # ── search_person() ──────────────────────────────────────────────────────

    def search_person(
        self,
        last_name: str,
        first_name: str = "",
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        Search the Brazoria Tyler portal for a specific person.

        Both last_name AND first_name are required — Tyler rejects name-only
        searches without a first name.

        Optional kwargs
        ───────────────
        booking_date : str
            Narrow results to a specific booking date (YYYY-MM-DD or MM/DD/YYYY).
            Sets both DateBookingOnAfter and DateBookingOnBefore to the same value.
            NOTE: date-only searches are NOT supported; names are always required.
        """
        if not first_name or not first_name.strip():
            raise ValueError(
                "BrazoriaLookup requires both first_name and last_name. "
                "Tyler PublicAccess rejects searches without a first name."
            )

        booking_date_raw = kwargs.get("booking_date", "")
        date_filter = _to_mmddyyyy(booking_date_raw.strip()) if booking_date_raw else ""

        scraped_at = _utcnow_iso()
        sess = _session()

        # Step 1: Visit default.aspx to establish session cookies
        try:
            sess.get(BASE + "default.aspx", timeout=30)
        except Exception as exc:
            print(f"[brazoria] session init failed: {exc}")
            return []

        # Step 2: GET the search form for fresh VIEWSTATE tokens
        try:
            form_resp = sess.get(SEARCH_URL, timeout=30)
            form_resp.raise_for_status()
        except Exception as exc:
            print(f"[brazoria] form load failed: {exc}")
            return []

        soup = BeautifulSoup(form_resp.text, "html.parser")

        def _hidden(name: str) -> str:
            tag = soup.find("input", {"name": name})
            return tag["value"] if tag and tag.get("value") else ""

        # Step 3: POST the search form with JS-required fields included
        payload = {
            "__EVENTTARGET":          "",
            "__EVENTARGUMENT":        "",
            "__VIEWSTATE":            _hidden("__VIEWSTATE"),
            "__VIEWSTATEGENERATOR":   _hidden("__VIEWSTATEGENERATOR"),
            "__EVENTVALIDATION":      _hidden("__EVENTVALIDATION"),
            "RadioSearchType":        "1",           # 1 = PartyNameOption
            "BookingNumber":          "",
            "LastName":               last_name.strip().upper(),
            "FirstName":              first_name.strip().upper(),
            "MiddleName":             "",
            "DateOfBirth":            "",
            "DateBookingOnAfter":     date_filter,
            "DateBookingOnBefore":    date_filter,
            "DateReleasedOnAfter":    "",
            "DateReleasedOnBefore":   "",
            "BondStatusType":         "0",           # 0 = AllOption
            "DatePostedOnAfter":      "",
            "DatePostedOnBefore":     "",
            "SearchSubmit":           "Search",
            # Values normally set by JavaScript ValidateSearchParameters()
            "SearchType":             "PARTYNAME",
            "NameTypeKy":             "ALIAS",
            "BaseConnKy":             "",
            "ShowInactive":           "",
            "StatusType":             "",
            "AllStatusTypes":         "",
            "BondCompany":            "",
            "NodeID":                 _hidden("NodeID"),
            "ProductType":            "",
            "SearchParams":           "",
        }

        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://portal-txbrazoria.tylertech.cloud",
            "Referer": SEARCH_URL,
        }

        try:
            search_resp = sess.post(SEARCH_URL, data=payload, headers=headers, timeout=30)
            search_resp.raise_for_status()
        except Exception as exc:
            print(f"[brazoria] search POST failed: {exc}")
            return []

        # Abort if Tyler bounced us to an error page
        if "ErrorOccured" in search_resp.url or self._is_error_page(search_resp.text):
            print(f"[brazoria] server returned error page for '{last_name}, {first_name}'")
            return []

        self._sess = sess  # preserve session for subsequent fetch_detail() calls
        results = self._parse_results(search_resp.text, scraped_at, sess)
        date_note = f" booking_date={date_filter}" if date_filter else ""
        print(
            f"[brazoria] search '{last_name}, {first_name}'{date_note}"
            f" -> {len(results)} results"
        )
        return results

    # ── fetch_detail() ───────────────────────────────────────────────────────

    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """
        Fetch and parse a Brazoria Tyler detail page.

        Page structure (confirmed live):
          Table 4 : booking # / other agency / facility / booked / released dates
          Table 5 : name, description (race/sex/height/weight), alias, hair/eyes, address
          Table 7 : charges — headers: Warrant #, Charge, Issuing Auth, Offense Date,
                              Bond/Type, Fine/Crt Costs, Disposition
        """
        scraped_at = _utcnow_iso()

        # Reuse the session from search_person() if available — Tyler requires it.
        # Fall back to a fresh session only when fetch_detail() is called standalone.
        sess = self._sess if self._sess is not None else _session()
        if self._sess is None:
            try:
                sess.get(BASE + "default.aspx", timeout=30)
            except Exception:
                pass

        try:
            resp = sess.get(detail_url, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            raise RuntimeError(
                f"[brazoria] detail fetch failed for {detail_url}: {exc}"
            ) from exc

        soup = BeautifulSoup(resp.text, "html.parser")
        result: Dict[str, Any] = {
            "detail_url":        detail_url,
            "detail_fetched_at": scraped_at,
            "charges":           [],
            "bond_amount":       None,
        }

        tables = soup.find_all("table")

        # ── Booking info (Table 4 area) ──────────────────────────────────────
        # Look for any table whose text contains "Booking #:"
        booking_text = ""
        for tbl in tables:
            txt = tbl.get_text(" ", strip=True)
            if re.search(r"Booking\s*#:", txt, re.I):
                booking_text = txt
                break

        if booking_text:
            m = re.search(r"Booking\s*#:\s*([\w-]+)", booking_text, re.I)
            if m:
                result["booking_number"] = m.group(1).strip()
            m = re.search(r"Booked:\s*([\d/]+)", booking_text, re.I)
            if m:
                _raw = m.group(1).strip()
                result["booking_date_raw"] = _raw
                result["booking_date"] = _parse_date_to_iso(_raw)
            m = re.search(r"Released:\s*([\d/]+)", booking_text, re.I)
            if m:
                _raw = m.group(1).strip()
                result["release_date_raw"] = _raw
                result["release_date"] = _parse_date_to_iso(_raw)

        # ── Charge table ─────────────────────────────────────────────────────
        # Tyler detail page charge table has these headers (case-insensitive):
        #   Warrant #, Charge, Issuing Auth, Offense Date, Bond/Type,
        #   Fine/Crt Costs, Disposition
        charges: List[Dict[str, Any]] = []
        bond_values: List[float] = []

        for tbl in tables:
            # Gather headers from either <th> or first-row <td>
            heads: List[str] = [
                th.get_text(strip=True).lower() for th in tbl.select("th")
            ]
            if not heads:
                first_tr = tbl.select_one("tr")
                if first_tr:
                    heads = [
                        c.get_text(strip=True).lower()
                        for c in first_tr.select("th,td")
                    ]

            norm = [h.strip() for h in heads]
            if not any("charge" in h for h in norm):
                continue

            data_rows = tbl.select("tbody tr") or tbl.select("tr")[1:]
            for tr in data_rows:
                cells = [td.get_text(strip=True) for td in tr.select("td")]
                if not cells:
                    continue
                row_dict: Dict[str, Any] = {}
                for i, h in enumerate(norm):
                    row_dict[h] = cells[i] if i < len(cells) else ""

                charge_entry: Dict[str, Any] = {
                    "warrant_number":  row_dict.get("warrant #") or row_dict.get("warrant#") or "",
                    "description":     row_dict.get("charge", ""),
                    "issuing_auth":    row_dict.get("issuing auth", ""),
                    "offense_date":    row_dict.get("offense date", ""),
                    "bond_type_raw":   row_dict.get("bond/type", ""),
                    "fine":            row_dict.get("fine/crt costs", ""),
                    "disposition":     row_dict.get("disposition", ""),
                }
                charges.append(charge_entry)

                # Extract bond amount from "Bond/Type" cell, e.g. "200.00 Bail Bond"
                bond_raw = charge_entry["bond_type_raw"]
                if bond_raw:
                    m = re.match(r"^\s*([0-9][0-9,]*\.?\d*)", bond_raw.replace(",", ""))
                    if m:
                        try:
                            bond_values.append(float(m.group(1)))
                        except ValueError:
                            pass

        result["charges"] = charges
        if bond_values:
            result["bond_amount"] = int(sum(bond_values))

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

        booking_date_raw = raw.get("booking_date") or None
        booking_date_iso = _parse_date_to_iso(booking_date_raw)

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
            "full_name":         full_name,
            "last_name":         last_name,
            "first_name":        first_name,
            "dob":               raw.get("dob") or None,
            "booking_number":    booking_number,
            "booking_date":      booking_date_iso,
            "booking_date_raw":  booking_date_raw,
            "charges":           raw.get("charges") or [],
            "bond_amount":       raw.get("bond_amount") or None,
            "detail_url":        detail_url,
            "county":            self.COUNTY,
            "source":            self.SOURCE,
            "scraped_at":        raw.get("scraped_at") or _utcnow_iso(),
            "observed_at":       booking_date_iso,
            "_upsert_key":       upsert_key,
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

    def _parse_results(
        self,
        html: str,
        scraped_at: str,
        sess: Optional[requests.Session] = None,
    ) -> List[Dict[str, Any]]:
        """
        Parse the Tyler PublicAccess search results table.

        Tyler results table headers: booking number, defendant name, booked,
        released, arresting agency (colspan=2), charge(s)

        Each data row identified by presence of a JailingDetail link.
        Nested table in td[4] contains (agency, charge) pairs per count.
        """
        if self._is_error_page(html) or self._is_search_form(html):
            return []

        soup = BeautifulSoup(html, "html.parser")
        rows: List[Dict[str, Any]] = []

        # Find the results table by headers
        results_tbl = None
        for tbl in soup.find_all("table"):
            hdrs = [th.get_text(strip=True).lower() for th in tbl.find_all("th")]
            if not hdrs:
                first_tr = tbl.find("tr")
                if first_tr:
                    hdrs = [
                        c.get_text(strip=True).lower()
                        for c in first_tr.find_all(["th", "td"])
                    ]
            if "booking number" in hdrs and "defendant name" in hdrs:
                results_tbl = tbl
                break

        if not results_tbl:
            return rows

        for tr in results_tbl.find_all("tr"):
            # Skip rows without a JailingDetail link — these are headers / spacers
            detail_link = tr.find("a", href=re.compile(r"JailingDetail", re.I))
            if not detail_link:
                continue

            # Use recursive=False to get only the top-level <td> cells
            # (avoids inflating cell count from the nested charge table)
            tds = tr.find_all("td", recursive=False)
            if len(tds) < 4:
                continue

            booking_number = tds[0].get_text(strip=True) or None
            detail_href = detail_link.get("href", "")
            if detail_href:
                detail_url = BASE.rstrip("/") + "/" + detail_href.lstrip("/")
            else:
                detail_url = None

            name = tds[1].get_text(" ", strip=True)
            last_name = first_name = None
            if "," in name:
                parts = name.split(",", 1)
                last_name  = parts[0].strip().upper() or None
                first_name = parts[1].strip().upper() or None
            else:
                last_name = name.strip().upper() or None

            booked   = tds[2].get_text(strip=True) or None  # MM/DD/YYYY
            released = tds[3].get_text(strip=True) or None  # MM/DD/YYYY or empty

            # td[4]: nested table with (agency, charge) rows
            charges: List[Dict[str, str]] = []
            if len(tds) > 4:
                nested_tbl = tds[4].find("table")
                if nested_tbl:
                    for ntr in nested_tbl.find_all("tr"):
                        ntds = ntr.find_all("td")
                        if len(ntds) >= 2:
                            charges.append({
                                "arresting_agency": ntds[0].get_text(strip=True),
                                "description":      ntds[1].get_text(strip=True),
                            })

            rows.append({
                "scraped_at":     scraped_at,
                "booking_number": booking_number,
                "last_name":      last_name,
                "first_name":     first_name,
                "booking_date":   booked,
                "release_date":   released,
                "charges":        charges,
                "detail_url":     detail_url,
            })

        return rows


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.lookups.brazoria_lookup --last-name SMITH --first-name JOHN

if __name__ == "__main__":
    import argparse
    import json
    import sys

    class _NullDb:
        class _NullColl:
            def find_one(self, *a, **kw):
                return None
            def insert_one(self, *a, **kw):
                return type("R", (), {"inserted_id": None})()
            def update_one(self, *a, **kw):
                return type("R", (), {"upserted_id": None, "matched_count": 0, "modified_count": 0})()
            def find(self, *a, **kw):
                return []
        def __getitem__(self, name):
            return self._NullColl()
        def __getattr__(self, name):
            return self._NullColl()

    ap = argparse.ArgumentParser(description="Brazoria lookup dry-run")
    ap.add_argument("--last-name",    required=True, help="Last name to search")
    ap.add_argument("--first-name",   default="",    help="First name to search")
    ap.add_argument("--booking-date", default="",    help="Optional booking date (YYYY-MM-DD)")
    args = ap.parse_args()

    kwargs = {}
    if args.booking_date:
        kwargs["booking_date"] = args.booking_date

    date_note = f" booking_date={args.booking_date}" if args.booking_date else ""
    print(
        "[brazoria] dry-run"
        " — searching '{}{}'{} (no MongoDB writes)".format(
            args.last_name,
            (", " + args.first_name) if args.first_name else "",
            date_note,
        )
    )
    scraper = BrazoriaLookup(_NullDb())

    results = scraper.lookup(
        last_name=args.last_name,
        first_name=args.first_name,
        fetch_details=True,
        store=False,
        **kwargs,
    )
    print("[brazoria] lookup() returned {} results".format(len(results)))
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "full_name", "booking_number"]
        missing  = [f for f in required if not r.get(f)]
        status   = "WARN missing: " + str(missing) if missing else "OK"
        print(
            "  [{}] result[{}]: {}".format(
                status,
                i,
                json.dumps(
                    {k: v for k, v in r.items() if k not in ("raw", "_upsert_key")},
                    default=str,
                    indent=2,
                ),
            )
        )
    sys.exit(0)
