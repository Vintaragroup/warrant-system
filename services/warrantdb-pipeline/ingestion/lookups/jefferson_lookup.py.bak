"""
ingestion/lookups/jefferson_lookup.py
─────────────────────────────────────────────────────────────────────────────
Jefferson County inmate search lookup — LookupScraper.

Source:    https://jeffersoncountytx.gov/InmateSearch
Platform:  ASP.NET Core with anti-forgery token
Type:      ENRICHMENT ONLY — caller must provide last_name.

ASP.NET Core anti-forgery
─────────────────────────
Jefferson's InmateSearch requires a RequestVerificationToken in both the
form POST body and a request header.  The token is discovered by GET-ing the
search form page before the first search.  It is discovered lazily on first
use and reused for the session lifetime.

If the token expires (401 or empty results after a valid search), call
_refresh_antiforgery() to re-discover the token.

Existing logic
──────────────
Full parsing is in the legacy ingestion/jefferson_jail.py file.
This class is a structured wrapper with TODO stubs pointing to legacy helpers.

Environment variables
─────────────────────
JEFF_ROW_DELAY_SEC      delay between requests           (default: 0.6)
JEFF_REQ_TIMEOUT        request timeout seconds          (default: 30)
JEFF_SNAPSHOT           enable HTML debug snapshots      (default: true)
JEFF_SNAPSHOT_DIR       snapshot directory               (default: debug/jefferson)
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from ingestion.lookups.base import LookupResult, LookupScraper

BASE            = "https://jeffersoncountytx.gov/InmateSearch"
SEARCH_FORM_URL = f"{BASE}/Search"
SEARCH_LIST_URL = f"{BASE}/Search/List"

ROW_DELAY   = float(os.getenv("JEFF_ROW_DELAY_SEC", "0.6"))
REQ_TIMEOUT = int(os.getenv("JEFF_REQ_TIMEOUT", "30"))

_UA = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection":      "keep-alive",
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_txt(x: Any) -> str:
    return re.sub(r"\s+", " ", (x or "").strip())


def _split_name(full: str) -> tuple:
    """Return (first, last) from 'LAST, FIRST' or 'FIRST LAST' format."""
    full = _clean_txt(full)
    if "," in full:
        last, first = [p.strip() for p in full.split(",", 1)]
        return first, last
    parts = full.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1]), parts[-1]
    return full, ""


def _parse_money(s: Optional[str]) -> Optional[float]:
    """Parse a money string like '$1,234.00' to float, return None if blank/invalid."""
    if not s:
        return None
    s = s.strip().upper()
    if s in {"NO BOND", "N/A", "NA", "NONE", "NO"}:
        return 0.0
    s = s.replace(",", "").replace("$", "")
    m = re.search(r"([0-9]+(?:\.[0-9]{1,2})?)", s)
    return float(m.group(1)) if m else None


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


class JeffersonLookup(LookupScraper):
    """
    Jefferson County ASP.NET Core inmate search lookup.
    Requires last_name; first_name is optional.
    """

    COLLECTION = "jefferson_events"
    COUNTY = "jefferson"
    SOURCE = "jefferson_inmate_search"

    def __init__(self, db):
        super().__init__(db)
        self._sess: Optional[requests.Session] = None
        self._antiforgery: Dict[str, Optional[str]] = {"form": None, "header": None}
        self._antiforgery_ready: bool = False

    # ── Public API ───────────────────────────────────────────────────────────

    def search_person(
        self,
        last_name: str,
        first_name: str = "",
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        POST to Jefferson InmateSearch/Search/List with anti-forgery token.

        Returns list of raw result row dicts.
        """
        self._ensure_session()
        scraped_at = _utcnow_iso()

        payload: Dict[str, str] = {"LastName": last_name.strip().upper()}
        if first_name and first_name.strip():
            payload["FirstName"] = first_name.strip().upper()

        af_form   = self._antiforgery.get("form") or ""
        af_header = self._antiforgery.get("header") or ""
        if af_form:
            payload["__RequestVerificationToken"] = af_form

        headers = dict(_UA)
        if af_header:
            headers["RequestVerificationToken"] = af_header

        print(f"[jefferson] searching: {last_name}, {first_name}")
        try:
            resp = self._sess.post(  # type: ignore[union-attr]
                SEARCH_LIST_URL,
                data=payload,
                headers=headers,
                timeout=REQ_TIMEOUT,
            )
            resp.raise_for_status()
        except Exception as exc:
            print(f"[jefferson] search POST failed: {exc}")
            return []

        time.sleep(ROW_DELAY)

        results = self._parse_results(resp.text, scraped_at)
        print(f"[jefferson] '{last_name}, {first_name}' → {len(results)} results")
        return results

    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """
        Fetch and parse a Jefferson inmate detail page.
        Ported from JeffersonJailScraper._parse_detail() and helpers in
        ingestion/jefferson_jail.py.
        """
        self._ensure_session()
        scraped_at = _utcnow_iso()

        try:
            resp = self._sess.get(detail_url, headers=_UA, timeout=REQ_TIMEOUT)  # type: ignore[union-attr]
            resp.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"[jefferson] detail fetch failed: {exc}") from exc

        time.sleep(ROW_DELAY)
        soup = BeautifulSoup(resp.text, "lxml")

        result: Dict[str, Any] = {
            "detail_url":        detail_url,
            "detail_fetched_at": scraped_at,
            "charges":           [],
            "bond_amount":       None,
        }

        # ── Name: H1 outside the search form div ────────────────────────────
        # Jefferson wraps the search UI in div#inmate-search-form; the inmate
        # name appears in a top-level H1 outside that container.
        search_form_div = soup.select_one("div#inmate-search-form")
        name = ""
        for h1 in soup.select("h1"):
            if search_form_div and search_form_div in h1.parents:
                continue
            text = _clean_txt(h1.get_text())
            if text and text != "Inmate Search":
                name = text
                break

        if name:
            result["full_name"] = name.upper()
            first, last = _split_name(name)
            result["last_name"]  = last.upper() if last else None
            result["first_name"] = first.upper() if first else None

        # ── Property pairs ─────────────────────────────────────────────────────────
        # Primary: div.detail-property-title + div.detail-property-value (Jefferson)
        # Secondary: dl/dt + dd
        prop_map: Dict[str, str] = {}
        for title_div in soup.select("div.detail-property-title"):
            title = _clean_txt(title_div.get_text()).rstrip(":").strip()
            if not title:
                continue
            val_div = title_div.find_next_sibling("div", class_="detail-property-value")
            if val_div:
                prop_map[title.lower()] = _clean_txt(val_div.get_text())

        if not prop_map:
            for dt_tag in soup.select("dl dt"):
                title = _clean_txt(dt_tag.get_text()).rstrip(":")
                dd = dt_tag.find_next_sibling("dd")
                if dd:
                    prop_map[title.lower()] = _clean_txt(dd.get_text())

        if not prop_map:
            # Fallback: th/td or dt/dd sibling pairs
            for el in soup.select("dt, th"):
                label = el.get_text(strip=True).lower().rstrip(":").strip()
                nxt = el.find_next_sibling("dd") or el.find_next_sibling("td")
                if nxt:
                    prop_map[label] = nxt.get_text(strip=True)

        def _g(*keys: str) -> Optional[str]:
            for k in keys:
                v = prop_map.get(k) or prop_map.get(k.lower())
                if v:
                    return v
            return None

        result["dob"]            = _parse_date(_g("date of birth", "dob"))
        result["race"]           = _g("race")
        result["sex"]            = _g("gender", "sex")
        result["booking_number"] = _g("booking number", "booking id", "booking #") or None
        result["booking_date"]   = _parse_date(_g(
            "jail entry time", "booking date", "admitted", "intake date"
        ))
        result["arrest_date"]    = _parse_date(_g("arrest date"))
        result["release_date"]   = _parse_date(_g("release date", "released"))
        result["hold_type"]      = _g("hold type", "hold", "hold description") or None
        result["agency"]         = _g("arresting agency", "agency")
        result["age"]            = _g("age at arrest", "age")

        # ── Charges: table#results-table (Jefferson-specific) ──────────────────
        charges: List[Dict[str, Any]] = []
        total_bond = 0.0

        charge_tbl = soup.select_one("table#results-table")
        if not charge_tbl:
            # fallback: any table with charge/offense header
            for tbl in soup.select("table"):
                hdrs = [th.get_text(strip=True).lower() for th in tbl.select("th")]
                if any("charge" in h or "offense" in h for h in hdrs):
                    charge_tbl = tbl
                    break

        if charge_tbl:
            headers: List[str] = []
            thead = charge_tbl.find("thead")
            if thead:
                headers = [th.get_text(strip=True).lower() for th in thead.find_all("th")]

            # Map column indices
            def _col_idx(keyword: str) -> Optional[int]:
                return next((i for i, h in enumerate(headers) if keyword in h), None)

            idx_offense   = _col_idx("offense")
            idx_class     = _col_idx("class")
            idx_warrant   = _col_idx("warrant")
            idx_bond      = next(
                (i for i, h in enumerate(headers) if "bond" in h and "amount" in h), None
            )
            idx_condition = _col_idx("condition")

            tbody = charge_tbl.find("tbody")
            if tbody:
                for tr in tbody.find_all("tr"):  # type: ignore[union-attr]
                    cells = tr.find_all("td")
                    if not cells:
                        continue

                    def _cell(i: Optional[int]) -> str:
                        return cells[i].get_text(strip=True) if i is not None and i < len(cells) else ""

                    # Bond condition may be in a nested <ul>/<li>
                    condition_text = ""
                    if idx_condition is not None and idx_condition < len(cells):
                        li_items = cells[idx_condition].find_all("li")
                        if li_items:
                            condition_text = "; ".join(li.get_text(strip=True) for li in li_items)
                        else:
                            condition_text = cells[idx_condition].get_text(strip=True)

                    charge: Dict[str, Any] = {
                        "charge":    _cell(idx_offense),
                        "status":    _cell(idx_class),
                        "docket":    _cell(idx_warrant),
                        "bond":      _cell(idx_bond),
                    }
                    if condition_text:
                        charge["condition"] = condition_text

                    bond_val = _parse_money(charge["bond"])
                    if bond_val:
                        total_bond += bond_val

                    if charge["charge"]:
                        charges.append(charge)

        result["charges"]     = charges
        result["bond_amount"] = total_bond if total_bond > 0 else None

        return result

    # ── normalize_record() ───────────────────────────────────────────────────

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[LookupResult]:
        """
        Translate one raw Jefferson result row to a canonical LookupResult.
        """
        booking_number = (raw.get("booking_number") or raw.get("booking number") or "").strip() or None
        last_name      = (raw.get("last_name")  or "").strip().upper() or None
        first_name     = (raw.get("first_name") or "").strip().upper() or None
        detail_url     = raw.get("detail_url") or None
        inmate_id      = raw.get("inmate_id") or raw.get("id") or None

        if not any([booking_number, inmate_id, detail_url]):
            return None

        upsert_key: Dict[str, Any] = {"county": self.COUNTY, "source": self.SOURCE}
        if inmate_id:
            upsert_key["inmate_id"] = str(inmate_id)
        elif booking_number:
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
            "booking_date":   _parse_date(raw.get("booking_date") or raw.get("booking date")),
            "inmate_id":      str(inmate_id) if inmate_id else None,
            "hold_type":      raw.get("hold_type") or None,
            "charges":        raw.get("charges") or [],
            "bond_amount":    raw.get("bond_amount") or None,
            "detail_url":     detail_url,
            "county":         self.COUNTY,
            "source":         self.SOURCE,
            "scraped_at":     raw.get("scraped_at") or _utcnow_iso(),
            "observed_at":    _parse_date(raw.get("booking_date")),
            "_upsert_key":    upsert_key,
        })

    # ── Session / anti-forgery management ───────────────────────────────────

    def _ensure_session(self) -> None:
        if self._sess is None:
            self._sess = requests.Session()
        if not self._antiforgery_ready:
            self._refresh_antiforgery()

    def _refresh_antiforgery(self) -> None:
        """
        GET the search form page to extract the RequestVerificationToken.
        Must be called before any POST.  Called automatically by _ensure_session().
        """
        if self._sess is None:
            self._sess = requests.Session()

        self._antiforgery = {"form": None, "header": None}

        try:
            resp = self._sess.get(SEARCH_FORM_URL, headers=_UA, timeout=REQ_TIMEOUT)
            resp.raise_for_status()
        except Exception as exc:
            print(f"[jefferson] anti-forgery discovery failed: {exc}")
            return

        soup = BeautifulSoup(resp.text, "html.parser")

        # Hidden input field
        hid = soup.find("input", {"name": "__RequestVerificationToken"})
        if hid and hid.get("value"):
            self._antiforgery["form"]   = hid["value"]
            self._antiforgery["header"] = hid["value"]

        # Meta tag fallback
        if not self._antiforgery["form"]:
            meta = soup.find("meta", {"name": "__RequestVerificationToken"})
            if meta and meta.get("content"):
                self._antiforgery["form"]   = meta["content"]
                self._antiforgery["header"] = meta["content"]

        # Cookie fallback (.AspNetCore.Antiforgery*)
        if not self._antiforgery["header"]:
            for c in self._sess.cookies:
                if "Antiforgery" in c.name or "RequestVerificationToken" in c.name or c.name.startswith(".AspNetCore.Antiforgery"):
                    self._antiforgery["header"] = c.value
                    break

        self._antiforgery_ready = True
        print(f"[jefferson] anti-forgery token discovered: {'ok' if self._antiforgery['form'] else 'cookie-only'}")

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _parse_results(self, html: str, scraped_at: str) -> List[Dict[str, Any]]:
        r"""
        Parse Jefferson inmate search results.
        Ported from _extract_detail_links() in ingestion/jefferson_jail.py.

        Jefferson uses clickable rows with data-href, or plain anchor links
        matching /InmateSearch/(Search/)?detail(s)?/\d+
        """
        soup = BeautifulSoup(html, "lxml")
        rows: List[Dict[str, Any]] = []

        seen: set = set()

        def _abs(u: str) -> str:
            return urljoin(BASE + "/", u)

        def _is_detail(href: str) -> bool:
            if not href:
                return False
            return bool(re.search(r"/inmatesearch/(search/)?detail(s)?/\d+", href, re.I))

        def _extract_id(url: str) -> Optional[str]:
            m = re.search(r"/Detail[s]?/(\d+)", url, re.I)
            return m.group(1) if m else None

        detail_links: List[str] = []

        # Primary: clickable rows
        for row_el in soup.select("tr.clickable-row[data-href]"):
            dh = (row_el.get("data-href") or "").strip()
            if _is_detail(dh):
                abs_url = _abs(dh)
                if abs_url not in seen:
                    seen.add(abs_url)
                    detail_links.append(abs_url)

        # Fallback: anchor links
        if not detail_links:
            for a in soup.select("a[href]"):
                href = a.get("href", "").strip()
                if _is_detail(href):
                    abs_url = _abs(href)
                    if abs_url not in seen:
                        seen.add(abs_url)
                        detail_links.append(abs_url)

        for url in detail_links:
            inmate_id = _extract_id(url)
            rows.append({
                "scraped_at": scraped_at,
                "detail_url": url,
                "inmate_id":  inmate_id,
            })

        return rows


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.lookups.jefferson_lookup --dry-run --last-name SMITH [--first-name JOHN]

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

    ap = argparse.ArgumentParser(description="Jefferson lookup dry-run")
    ap.add_argument("--dry-run",    action="store_true", default=True)
    ap.add_argument("--last-name",  required=True, help="Last name to search")
    ap.add_argument("--first-name", default="",    help="First name to search")
    args = ap.parse_args()

    print(f"[jefferson] dry-run — searching '{args.last_name}, {args.first_name}' (no MongoDB writes)")
    scraper = JeffersonLookup(_NullDb())

    results = scraper.lookup(
        last_name=args.last_name,
        first_name=args.first_name,
        fetch_details=True,
        store=False,
    )
    print(f"[jefferson] lookup() returned {len(results)} results")
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "inmate_id"]
        missing  = [f for f in required if not r.get(f)]
        status   = "WARN missing: " + str(missing) if missing else "OK"
        print(f"  [{status}] result[{i}]: {json.dumps({k: v for k, v in r.items() if k not in ('raw', '_upsert_key')}, default=str, indent=2)}")
    sys.exit(0)
