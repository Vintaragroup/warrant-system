"""
ingestion/event_feeds/wharton_dcn.py
─────────────────────────────────────────────────────────────────────────────
Wharton County Sheriff's Office / Jail Division — DCN jail roster scraper.

Source:      http://69.92.28.194:8080/DCN/#inmates
Platform:    DCN (Detention Control Network) — ASP.NET WebForms + DevExpress
Feed type:   Polled roster snapshot → each unique booking is an immutable event

How it works
────────────
1.  fetch_events() GETs /DCN/inmates with a cookie that sets page_size=PAGE_SIZE
    (default 500) so all current inmates are returned in one HTML response.

2.  The DevExpress gvInmates grid table is parsed to extract one row per inmate
    with: full_name, age, race, sex, admit_date, and a detail URL.

3.  For each inmate we async-fetch the detail page /DCN/inmate-details?id=...&bid=...
    to retrieve charges and bond amounts (CONCURRENCY workers, ROW_DELAY between
    requests to be polite to the server).

4.  normalize_event() maps fields to the canonical EventRecord schema.

5.  store_event() upserts into wharton_inmates keyed on
    {"county": "wharton", "source_url": <normalized_detail_url>}.

Dry-run output line:  [wharton] dry-run summary: ok=N warn=N skip=N
Live output line:     [wharton] stored N events

Environment variables
─────────────────────
WHARTON_CONCURRENCY     int   async detail-page workers       default 5
WHARTON_PAGE_SIZE       int   max roster rows per request      default 500
WHARTON_ROW_DELAY_SEC   float delay (s) between detail GETs   default 0.3
WHARTON_DETAIL_FETCH    bool  fetch detail pages for charges   default true
SCRAPER_VERIFY_SSL      bool  enable TLS cert verification     default false
"""
from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote, unquote, urlparse, parse_qs

import httpx
from bs4 import BeautifulSoup

from ingestion.event_feeds.base import EventFeedScraper, EventRecord

# ── Constants ────────────────────────────────────────────────────────────────

BASE = "http://69.92.28.194:8080"
INMATES_URL = f"{BASE}/DCN/inmates"
UA = {"User-Agent": "Mozilla/5.0 (compatible; WarrantDB/0.2)"}
TIMEOUT = 30.0

# ── Env helpers ──────────────────────────────────────────────────────────────


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


CONCURRENCY = _int_env("WHARTON_CONCURRENCY", 5)
PAGE_SIZE = _int_env("WHARTON_PAGE_SIZE", 500)
ROW_DELAY = float(os.getenv("WHARTON_ROW_DELAY_SEC", "0.3"))
DETAIL_FETCH = os.getenv("WHARTON_DETAIL_FETCH", "true").strip().lower() in ("1", "true", "yes")

# DevExpress grid cookie that controls page size
_GRID_COOKIE_NAME = "inmates_aspx_gvInmates"
_GRID_COOKIE_TEMPLATE = (
    "page1|size{size}|conditions2|0|3|10|3|"
    "hierarchy11|0|-1|1|-1|2|-1|3|-1|4|-1|5|-1|6|-1|7|-1|8|-1|9|-1|10|-1|"
    "visible11|t0|f1|f2|f3|t4|t5|t6|t7|f8|f9|f10|"
    "width11|150px|50px|50px|65px|20px|25px|20px|40px|60px|150px|60px"
)

# Column positions for the 10-cell charge rows in ChargeGrid_DXMainTable
_COL_DESCRIPTION = 0
_COL_OFFENSE_DATE = 1
_COL_COURT_TYPE = 2
_COL_COURT_DATE = 3
_COL_DOCKET = 4
_COL_BOND = 5
_COL_BOND_TYPE = 6
_COL_PENALTY = 7
_COL_CHARGING_AGENCY = 8
_COL_ARRESTING_AGENCY = 9

# Column header cell values to skip when iterating charge table rows
_CHARGE_HEADER_CELLS = frozenset({
    "Charge", "Offense Date", "Court Type", "Court Date",
    "Docket Number", "Bond", "Bond Type", "Penalty Modifier",
    "Charging Agency", "Arresting Agency", "",
})

# ── Utilities ─────────────────────────────────────────────────────────────────


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money_to_float(s: str) -> Optional[float]:
    """Parse '$15,000.00' → 15000.0, '' or 'No Bond' or 'None' → None."""
    if not s:
        return None
    cleaned = s.strip().lower()
    if cleaned in ("no bond", "none", ""):
        return None
    cleaned = s.replace(",", "")
    m = re.search(r"\$?\s*([0-9]+(?:\.\d{2})?)", cleaned)
    return float(m.group(1)) if m else None


def _parse_date(s: Optional[str]) -> Optional[str]:
    """Parse MM-DD-YYYY or M/D/YYYY to an ISO date string (YYYY-MM-DD)."""
    if not s:
        return None
    s = s.strip()
    for pat in (r"(\d{1,2})-(\d{1,2})-(\d{4})", r"(\d{1,2})/(\d{1,2})/(\d{4})"):
        m = re.match(pat, s)
        if m:
            mm, dd, yy = map(int, m.groups())
            try:
                return datetime(yy, mm, dd).date().isoformat()
            except Exception:
                pass
    return None


def _normalize_url(href: str) -> str:
    """Resolve a detail href to a stable full URL (lowercase, singly-decoded)."""
    try:
        # hrefs from the page are double-encoded (%253d → %3d → =); normalize
        single = unquote(href)
        full = single if single.startswith("http") else f"{BASE}/{single.lstrip('/')}"
        return full.lower()
    except Exception:
        return href.lower()


def _source_id_from_href(href: str) -> str:
    """Stable 16-char hex source_id derived from the normalized detail URL."""
    return sha1(_normalize_url(href).encode()).hexdigest()[:16]


def _parse_full_name(
    display: str,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Parse 'LAST, FIRST MIDDLE' roster format into (last, first, middle).
    Falls back gracefully if the comma is absent.
    """
    if not display:
        return None, None, None
    if "," in display:
        parts = display.split(",", 1)
        last = parts[0].strip()
        rest = parts[1].strip()
        name_parts = rest.split(None, 1)
        first = name_parts[0].strip() if name_parts else ""
        middle = name_parts[1].strip() if len(name_parts) > 1 else ""
    else:
        last = display.strip()
        first = middle = ""
    return last or None, first or None, middle or None


def _race_expand(code: str) -> Optional[str]:
    """Expand single-letter race code to a descriptive label."""
    if not code:
        return None
    return {
        "W": "White", "B": "Black", "H": "Hispanic", "A": "Asian",
        "I": "Native American", "O": "Other", "U": "Unknown",
    }.get(code.upper(), code)


def _sex_expand(code: str) -> Optional[str]:
    """Expand M/F to Male/Female."""
    if not code:
        return None
    return {"M": "Male", "F": "Female"}.get(code.upper(), code)


def _make_roster_cookie() -> str:
    """Build the DevExpress grid cookie string for PAGE_SIZE rows per page."""
    raw = _GRID_COOKIE_TEMPLATE.format(size=max(PAGE_SIZE, 200))
    return quote(raw, safe="")


# ── HTML parsers ──────────────────────────────────────────────────────────────


def _parse_roster_page(html: str) -> List[Dict[str, Any]]:
    """
    Parse the /DCN/inmates HTML page and return a list of raw inmate dicts.
    Each dict contains: full_name, age, race, sex, admit_date, detail_href.

    The DevExpress gvInmates table renders one mash-row (first <tr> with links)
    and then one clean <tr> per inmate.  We keep only the clean rows that have
    a comma in the full_name cell (the "LAST, FIRST" list format).
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="gvInmates")
    if not table:
        print("[wharton] WARNING: gvInmates table not found in roster HTML")
        return []

    results: List[Dict[str, Any]] = []
    for row in table.find_all("tr"):
        link_el = row.find("a", href=lambda h: h and "inmate-details" in str(h))
        if not link_el:
            continue
        cells = row.find_all("td")
        texts = [c.get_text(strip=True) for c in cells]
        # Skip the big mash-row (first cell lacks a comma separator)
        if len(texts) < 5 or not texts[0] or "," not in texts[0]:
            continue
        results.append({
            "full_name": texts[0],
            "age": texts[1] if len(texts) > 1 else "",
            "race": texts[2] if len(texts) > 2 else "",
            "sex": texts[3] if len(texts) > 3 else "",
            "admit_date": texts[4] if len(texts) > 4 else "",
            "detail_href": link_el["href"],
        })
    return results


def _parse_detail_page(html: str) -> Dict[str, Any]:
    """
    Parse /DCN/inmate-details HTML and return a dict with personal fields and
    a charges list.  Each charge is a dict with description, offense_date,
    court_type, court_date, docket_number, bond_amount, bond, bond_type,
    charging_agency, arresting_agency.
    """
    soup = BeautifulSoup(html, "html.parser")
    result: Dict[str, Any] = {}

    # ── Personal info from tblDetails ─────────────────────────────────────
    tbl = soup.find("table", id="tblDetails")
    if tbl:
        rows = tbl.find_all("tr")
        # Row 1 cells (index 2 onward) are label-value pairs
        if len(rows) > 1:
            cells = rows[1].find_all("td")
            labels_vals = [c.get_text(strip=True) for c in cells[2:]]
            key_map = {
                "Age": "age_detail",
                "Race": "race_detail",
                "Sex": "sex_detail",
                "Eye Color": "eye_color",
                "Hair Color": "hair_color",
                "Weight": "weight",
                "Height": "height",
                "Admit Date": "admit_date_detail",
                "Admit Time": "admit_time",
                "Address": "address",
                "Confining Agency": "confining_agency",
            }
            for i in range(0, len(labels_vals) - 1, 2):
                lbl = labels_vals[i].strip()
                val = labels_vals[i + 1].strip()
                if lbl in key_map:
                    result[key_map[lbl]] = val

    # ── Charges from ChargeGrid_DXMainTable ────────────────────────────────
    charge_table = soup.find("table", id="ChargeGrid_DXMainTable")
    if not charge_table:
        # Fallback: any table containing a "Charge" column header
        for t in soup.find_all("table"):
            if t.find("td", string=re.compile(r"^Charge$")):
                charge_table = t
                break

    charges: List[Dict[str, Any]] = []
    total_bond = 0.0

    if charge_table:
        for row in charge_table.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) != 10:
                continue
            texts = [c.get_text(strip=True) for c in cells]
            description = texts[_COL_DESCRIPTION]
            # Skip header rows and the Count= footer row
            if not description or description in _CHARGE_HEADER_CELLS:
                continue
            if description.startswith("Count="):
                continue

            bond_str = texts[_COL_BOND]
            bond_type = texts[_COL_BOND_TYPE]
            bond_amount = _money_to_float(bond_str)
            if bond_amount:
                total_bond += bond_amount

            charges.append({
                "description": description,
                "offense_date": _parse_date(texts[_COL_OFFENSE_DATE]),
                "court_type": texts[_COL_COURT_TYPE] or None,
                "court_date": _parse_date(texts[_COL_COURT_DATE]) if texts[_COL_COURT_DATE] else None,
                "docket_number": texts[_COL_DOCKET] or None,
                "bond_amount": bond_amount,
                "bond": bond_str or None,
                "bond_type": bond_type or None,
                "charging_agency": texts[_COL_CHARGING_AGENCY] or None,
                "arresting_agency": texts[_COL_ARRESTING_AGENCY] or None,
            })

    result["charges"] = charges
    result["bond_amount"] = total_bond if total_bond > 0 else None
    result["charge_count"] = len(charges)
    return result


# ── Main scraper ──────────────────────────────────────────────────────────────


class WhartonDCNEventFeed(EventFeedScraper):
    """
    Wharton County DCN jail roster — EventFeedScraper implementation.

    Each unique booking is identified by the sha1 of its normalized detail URL.
    Re-polling updates charges/bond data but preserves first_seen_at via upsert.
    """

    COLLECTION = "wharton_inmates"
    COUNTY = "wharton"
    SOURCE = "wharton_dcn"
    POLL_INTERVAL_SECONDS = 900  # 15 minutes

    def __init__(self, db):
        super().__init__(db)
        self._scraped_at: str = _utcnow_iso()

    # ── fetch_events() ────────────────────────────────────────────────────────

    def fetch_events(self) -> Iterable[Dict[str, Any]]:
        """Fetch the current DCN roster and yield one raw merged dict per inmate."""
        self._scraped_at = _utcnow_iso()

        print(f"[wharton] fetching roster from {INMATES_URL} (page_size={PAGE_SIZE})")
        roster_rows: List[Dict[str, Any]] = []
        try:
            with httpx.Client(
                headers=UA,
                cookies={_GRID_COOKIE_NAME: _make_roster_cookie()},
                timeout=TIMEOUT,
                follow_redirects=True,
            ) as client:
                resp = client.get(INMATES_URL)
                resp.raise_for_status()
                roster_rows = _parse_roster_page(resp.text)
        except Exception as exc:
            print(f"[wharton] roster fetch failed: {exc}")
            return

        print(f"[wharton] roster: {len(roster_rows)} inmates")

        # ── Async detail enrichment ────────────────────────────────────────
        detail_map: Dict[str, Dict[str, Any]] = {}
        if DETAIL_FETCH and roster_rows:
            print(f"[wharton] fetching detail pages for {len(roster_rows)} inmates")
            detail_map = asyncio.run(self._fetch_all_details(roster_rows))
            ok = sum(1 for v in detail_map.values() if v.get("_fetch_status") == "ok")
            fail = len(detail_map) - ok
            print(f"[wharton] detail fetch complete: ok={ok} failed={fail}")
        else:
            print("[wharton] detail fetch disabled (WHARTON_DETAIL_FETCH=false)")

        for row in roster_rows:
            href = row.get("detail_href", "")
            detail = detail_map.get(href, {})
            merged = {**row, **detail}
            merged["_scraped_at"] = self._scraped_at
            yield merged

    # ── normalize_event() ─────────────────────────────────────────────────────

    def normalize_event(self, raw: Dict[str, Any]) -> Optional[EventRecord]:
        """Map a raw DCN merged row to a canonical EventRecord."""
        full_name_raw = (raw.get("full_name") or "").strip().upper() or None
        if not full_name_raw:
            return None

        last_name, first_name, middle_name = _parse_full_name(full_name_raw)

        # ── Stable booking identifier ──────────────────────────────────────
        href = raw.get("detail_href") or ""
        if not href:
            return None
        source_url = _normalize_url(f"{BASE}/{href.lstrip('/')}")
        source_id = _source_id_from_href(href)

        upsert_key: Dict[str, Any] = {
            "county": self.COUNTY,
            "source_url": source_url,
        }

        # ── Dates ─────────────────────────────────────────────────────────
        admit_date = _parse_date(raw.get("admit_date_detail") or raw.get("admit_date"))

        # ── Charges & bond ────────────────────────────────────────────────
        charges = raw.get("charges") or []
        bond_amount = raw.get("bond_amount")
        charge_description = charges[0]["description"] if charges else None

        event = EventRecord({
            # ── Identity ──
            "full_name":   full_name_raw,
            "last_name":   last_name,
            "first_name":  first_name,
            "middle_name": middle_name,
            "age":         raw.get("age") or raw.get("age_detail") or None,
            "race":        _race_expand(raw.get("race") or raw.get("race_detail") or ""),
            "sex":         _sex_expand(raw.get("sex") or raw.get("sex_detail") or ""),
            "eye_color":   raw.get("eye_color") or None,
            "hair_color":  raw.get("hair_color") or None,
            "weight":      raw.get("weight") or None,
            "height":      raw.get("height") or None,
            "address":     raw.get("address") or None,

            # ── Booking ──
            "booking_date":     admit_date,
            "arrest_date":      admit_date,
            "admit_date":       admit_date,
            "admit_time":       raw.get("admit_time") or None,
            "confining_agency": raw.get("confining_agency") or None,

            # ── Legal ──
            "charges":            charges,
            "charge_count":       len(charges),
            "bond_amount":        bond_amount,
            "charge_description": charge_description,

            # ── Detail enrichment metadata ──
            "detail_fetch_status": raw.get("_fetch_status") or "skipped",
            "detail_fetch_error":  raw.get("_fetch_error") or None,

            # ── Source ──
            "county":     self.COUNTY,
            "source":     self.SOURCE,
            "source_id":  source_id,
            "source_url": source_url,

            # ── Timestamps ──
            "scraped_at":  raw.get("_scraped_at") or self._scraped_at,
            "observed_at": admit_date,
            # ingested_at set by store_event()

            # ── Compatibility aliases (dashboard backward-compat) ──
            "booked_at":         admit_date,
            "event_date":        admit_date,
            "county_display":    "Wharton",
            "county_normalized": self.COUNTY,

            # ── Dedup key (stable, never positional) ──
            "_upsert_key": upsert_key,
        })

        return event

    # ── Async detail fetching ─────────────────────────────────────────────────

    async def _fetch_all_details(
        self,
        rows: List[Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch all detail pages concurrently. Returns {href: parsed_dict}."""
        sem = asyncio.Semaphore(CONCURRENCY)
        results: Dict[str, Dict[str, Any]] = {}

        async with httpx.AsyncClient(
            headers=UA,
            timeout=TIMEOUT,
            follow_redirects=True,
        ) as client:
            tasks = [
                self._fetch_one_detail(client, sem, row["detail_href"])
                for row in rows
                if row.get("detail_href")
            ]
            for coro in asyncio.as_completed(tasks):
                href, data = await coro
                if href:
                    results[href] = data

        return results

    async def _fetch_one_detail(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        href: str,
    ) -> tuple[str, Dict[str, Any]]:
        """Fetch and parse one inmate detail page."""
        full_url = f"{BASE}/{href.lstrip('/')}"
        async with sem:
            await asyncio.sleep(ROW_DELAY)
            try:
                resp = await client.get(full_url)
                resp.raise_for_status()
                data = _parse_detail_page(resp.text)
                data["_fetch_status"] = "ok"
                data["_fetched_at"] = _utcnow_iso()
                return href, data
            except Exception as exc:
                print(f"[wharton] detail fetch error {href[:60]}: {exc}")
                return href, {"_fetch_status": "error", "_fetch_error": str(exc), "charges": []}
