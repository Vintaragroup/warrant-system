"""
ingestion/event_feeds/galveston_p2c.py
─────────────────────────────────────────────────────────────────────────────
Galveston County P2C (Police-to-Citizen) jail roster — EventFeedScraper.

Source:      https://p2c.galvestoncountytx.gov/jailinmates.aspx
Platform:    Galveston County Sheriff's Office P2C portal
Feed type:   Polled roster snapshot → treated as append-only event stream
             Each unique booking is an immutable booking_event record.

How it works
────────────
1.  fetch_events() performs an httpx POST to the jqHandler.ashx AJAX endpoint
    that backs the jqGrid roster table.  This returns a JSON payload with all
    current inmates (up to ROWS_MAX=5000).

2.  For each row in the JSON we request the detail page to retrieve charges
    and bond amounts (async, CONCURRENCY workers).

3.  normalize_event() maps P2C fields to the canonical EventRecord schema.

4.  store_event() upserts into galveston_events keyed on
    {"county": "galveston", "source_id": <person_id or detail_url_hash>}.

Playwright dependency
─────────────────────
Playwright is used ONLY for the one-time endpoint sniff (_discover_endpoint).
After the endpoint URL/method/params are discovered they can be cached in
MongoDB (galveston_p2c_endpoint cache doc) so subsequent polls use only httpx.

If Playwright is not installed, discovery falls back to the known hardcoded
endpoint.  Install with:
    pip install playwright && playwright install chromium --with-deps

Known gaps
──────────
- full_name from the jqHandler.ashx JSON may be null depending on grid config.
  TODO: inspect the raw JSON response and fix the field mapping below.
  Workaround: detail pages always contain the inmate name — this is fetched.

Environment variables
─────────────────────
GALV_CONCURRENCY        int   async detail-page workers       default 10
GALV_ROWS_MAX           int   max roster rows to request      default 5000
GALV_ROW_DELAY_SEC      float delay between detail requests   default 0.5
GALV_SNAPSHOT           bool  write debug HTML snapshots      default false
GALV_SNAPSHOT_DIR       str   snapshot directory              default debug/galveston
SCRAPER_VERIFY_SSL      bool  enable TLS cert verification    default false  ← FIXME: should be true
GALV_ENDPOINT_CACHE     bool  cache discovered endpoint in DB default true
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import datetime, timezone
from hashlib import sha1
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import certifi
import httpx
from bs4 import BeautifulSoup

from ingestion.event_feeds.base import EventFeedScraper, EventRecord

# ── Constants ────────────────────────────────────────────────────────────────

BASE = "https://p2c.galvestoncountytx.gov"
ROSTER_HTML = f"{BASE}/jailinmates.aspx"
UA = {"User-Agent": "Mozilla/5.0 (compatible; WarrantDB/0.2)"}
TIMEOUT = 30.0

# ── Env helpers ──────────────────────────────────────────────────────────────

def _verify() -> Any:
    v = os.getenv("SCRAPER_VERIFY_SSL", "false").strip().lower() in ("1", "true", "yes")
    return certifi.where() if v else False


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


CONCURRENCY = _int("GALV_CONCURRENCY", 10)
ROWS_MAX = _int("GALV_ROWS_MAX", 5000)
ROW_DELAY = float(os.getenv("GALV_ROW_DELAY_SEC", "0.5"))
USE_ENDPOINT_CACHE = os.getenv("GALV_ENDPOINT_CACHE", "true").strip().lower() in ("1", "true", "yes")
# Set GALV_DETAIL_FETCH=false to skip detail page enrichment (faster, no bond data)
DETAIL_FETCH = os.getenv("GALV_DETAIL_FETCH", "true").strip().lower() in ("1", "true", "yes")

# ASP.NET form field names for detail page lookup
_DETAIL_FORM_RECORD_INDEX = "ctl00$MasterPage$mainContent$CenterColumnContent$hfRecordIndex"
_DETAIL_FORM_BUTTON = "ctl00$MasterPage$mainContent$CenterColumnContent$btnInmateDetail"

_BAD_NAME_RE = re.compile(
    r"(HOME|DAILY\s+BULLETIN|INMATE\s+INQUIRY|ARRESTS|CRASH\s+REPORTS|WANTED)",
    re.I,
)

ENDPOINT_CACHE_COLLECTION = "galveston_p2c_endpoint"


# ── Utilities ────────────────────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _money_to_float(s: str) -> Optional[float]:
    s = (s or "").replace(",", "")
    m = re.search(r"\$?\s*([0-9]+(?:\.\d{2})?)", s)
    return float(m.group(1)) if m else None


def _normalize_detail_url(u: str) -> str:
    """Strip volatile navid param so we don't treat the same page as different."""
    try:
        s = urlsplit(u)
        q = [(k, v) for k, v in parse_qsl(s.query, keep_blank_values=True) if k.lower() != "navid"]
        return urlunsplit((s.scheme, s.netloc.lower(), s.path.lower(), urlencode(q), ""))
    except Exception:
        return u


def _source_id(detail_url: str) -> str:
    """Stable ID derived from normalized detail URL."""
    return sha1(_normalize_detail_url(detail_url).encode()).hexdigest()[:12]


def _first_charge_desc(charges: list) -> Optional[str]:
    """Return the description of the first charge as a plain string."""
    for c in charges:
        if isinstance(c, dict):
            desc = c.get("description") or c.get("charge") or c.get("offense")
            if desc:
                return str(desc).strip()
        elif isinstance(c, str) and c.strip():
            return c.strip()
    return None


def _parse_date(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    for pat in (
        r"(\d{1,2})/(\d{1,2})/(\d{4})\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M",
        r"(\d{1,2})/(\d{1,2})/(\d{4})",
    ):
        m = re.match(pat, s)
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


# ── Playwright endpoint discovery (optional, one-shot) ───────────────────────

def _playwright_discover_endpoint() -> Optional[Dict[str, Any]]:
    """
    Use Playwright to intercept the jqHandler.ashx AJAX call and return its
    URL, method, headers, and POST body.

    Returns None if Playwright is not installed or discovery fails.
    The caller should cache the result in MongoDB for future polls.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[galv] playwright not installed — skipping endpoint discovery")
        return None

    result: Dict[str, Any] = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            ignore_https_errors=(_verify() is False),
            user_agent=UA["User-Agent"],  # type: ignore
        )
        page = ctx.new_page()

        def _on_response(resp):
            try:
                if "jqHandler.ashx" in resp.url:
                    req = resp.request
                    result.update({
                        "url": resp.url,
                        "method": req.method,
                        "headers": dict(req.headers),
                        "post_data": (req.post_data or ""),
                        "cookies": ctx.cookies(),
                    })
            except Exception:
                pass

        ctx.on("response", _on_response)

        try:
            page.goto(f"{BASE}/main.aspx", wait_until="domcontentloaded", timeout=25_000)
        except Exception:
            pass

        try:
            page.goto(ROSTER_HTML, wait_until="domcontentloaded", timeout=25_000)
        except Exception:
            pass

        # Try to trigger the "show all rows" dropdown to get the largest payload
        try:
            page.wait_for_selector("select.ui-pg-selbox", timeout=8_000)
            page.locator("select.ui-pg-selbox").first.select_option(label="All")
            page.wait_for_timeout(1500)
        except Exception:
            pass

        page.wait_for_timeout(2_000)
        ctx.close()
        browser.close()

    return result if result.get("url") else None


def _bump_rows(method: str, url: str, post_data: str) -> tuple[str, str]:
    """Rewrite the rows= parameter to ROWS_MAX in URL or POST body."""
    if method.upper() == "POST":
        parts = []
        had = False
        for p in (post_data or "").split("&"):
            if p.lower().startswith("rows="):
                parts.append(f"rows={ROWS_MAX}")
                had = True
            else:
                parts.append(p)
        if not had:
            parts.append(f"rows={ROWS_MAX}")
        return url, "&".join(parts)
    else:
        url = re.sub(r"rows=\d+", f"rows={ROWS_MAX}", url)
        if "rows=" not in url:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}rows={ROWS_MAX}"
        return url, post_data


# ── Main scraper ─────────────────────────────────────────────────────────────

class GalvestonP2CEventFeed(EventFeedScraper):
    """
    Galveston P2C jail roster — EventFeedScraper implementation.

    Each unique booking (identified by detail URL) is stored as an immutable
    booking_event in galveston_events.  Re-polling updates charges/bond data
    but preserves first_seen_at.
    """

    COLLECTION = "galveston_events"
    COUNTY = "galveston"
    SOURCE = "galveston_p2c"
    POLL_INTERVAL_SECONDS = 300  # 5 minutes

    def __init__(self, db):
        super().__init__(db)
        self._endpoint: Optional[Dict[str, Any]] = None
        self._scraped_at: str = _utcnow_iso()

    # ── fetch_events() ───────────────────────────────────────────────────────

    def fetch_events(self) -> Iterable[Dict[str, Any]]:
        """
        Fetch the current P2C roster and yield one raw dict per inmate.

        Strategy:
          1. Load or discover the jqHandler.ashx endpoint
          2. POST to it with rows=ROWS_MAX to get JSON roster
          3. Extract detail-page URLs from JSON rows
          4. Async-fetch each detail page for charges/bond data
          5. Yield one merged dict per inmate
        """
        self._scraped_at = _utcnow_iso()
        endpoint = self._get_endpoint()

        if not endpoint:
            print("[galv] could not resolve P2C endpoint — aborting fetch")
            return

        url, post_data = _bump_rows(endpoint["method"], endpoint["url"], endpoint.get("post_data", ""))
        cookies = {c["name"]: c["value"] for c in (endpoint.get("cookies") or [])}

        print(f"[galv] fetching roster from {url} (rows={ROWS_MAX})")
        try:
            with httpx.Client(headers=UA, verify=_verify(), cookies=cookies, timeout=TIMEOUT) as client:
                if endpoint["method"].upper() == "POST":
                    hdrs = dict(endpoint.get("headers") or {})
                    hdrs.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
                    resp = client.post(url, content=post_data.encode(), headers=hdrs)
                else:
                    resp = client.get(url, headers=endpoint.get("headers") or {})
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            print(f"[galv] roster fetch failed: {exc}")
            return

        rows = data.get("rows") or []
        print(f"[galv] roster: {len(rows)} rows")

        # ── Detail page enrichment via ASP.NET form POST ──────────────────
        # Each row has a my_num (0-based jqGrid row index) that maps to the
        # hfRecordIndex hidden field used by the detail-page PostBack handler.
        # One VIEWSTATE is loaded once and reused for all concurrent POSTs.
        detail_map: Dict[str, Dict[str, Any]] = {}
        if DETAIL_FETCH:
            viewstate = self._load_page_viewstate(cookies)
            if viewstate["loaded"]:
                print(f"[galv] fetching detail pages for {len(rows)} roster rows")
                detail_map = asyncio.run(
                    self._fetch_all_details_by_my_num(rows, viewstate, cookies)
                )
                ok_count = sum(1 for v in detail_map.values() if v.get("detail_fetch_status") == "ok")
                fail_count = len(detail_map) - ok_count
                print(f"[galv] detail fetch complete: ok={ok_count} failed={fail_count}")
            else:
                print("[galv] WARNING: could not load VIEWSTATE — skipping detail enrichment")
        else:
            print("[galv] detail fetch disabled (GALV_DETAIL_FETCH=false)")

        for row in rows:
            raw = self._parse_roster_row(row)
            if not raw:
                continue
            my_num = str(row.get("my_num", ""))
            if my_num and my_num in detail_map:
                detail_data = detail_map[my_num]
                # Merge detail fields; roster fields (agency, booking_number) take precedence
                for field in (
                    "bond_amount", "total_bond", "charges", "mugshot_url",
                    "release_date", "detail_fetched_at",
                    "detail_fetch_status", "detail_fetch_error",
                ):
                    if field in detail_data and detail_data[field] is not None:
                        raw[field] = detail_data[field]
                # Prefer detail charges when they are richer (list of dicts vs strings)
                detail_charges = detail_data.get("charges")
                if detail_charges and isinstance(
                    detail_charges[0] if detail_charges else None, dict
                ):
                    raw["charges"] = detail_charges
                raw.setdefault("detail_fetch_status", detail_data.get("detail_fetch_status", "skipped"))
            else:
                raw["detail_fetch_status"] = "skipped" if not DETAIL_FETCH else "missing"
            raw["_scraped_at"] = self._scraped_at
            yield raw

    # ── normalize_event() ────────────────────────────────────────────────────

    def normalize_event(self, raw: Dict[str, Any]) -> Optional[EventRecord]:
        """Map a raw P2C row to a canonical EventRecord."""
        detail_url = raw.get("detail_url") or ""
        full_name = (raw.get("full_name") or "").strip().upper() or None

        if full_name and _BAD_NAME_RE.search(full_name):
            return None

        # ── Stable booking identifier ───────────────────────────────────────
        # NOTE: raw["person_id"] is the P2C "invid" field — a sort-position
        # index assigned by the jqGrid roster endpoint.  invid is NOT stable
        # across roster refreshes (the same inmate may receive a different invid
        # if the roster order changes).  Never use invid as an upsert key.
        booking_number = raw.get("booking_number") or None
        jacket_number  = raw.get("jacket_number") or None
        norm_url       = _normalize_detail_url(detail_url) if detail_url else None

        # source_id stored on the record — most stable identifier available
        source_id = (
            booking_number
            or jacket_number
            or (norm_url and _source_id(detail_url))  # sha1 of normalized URL
            or None
        )
        if not source_id:
            return None

        # ── Upsert key — most specific stable field available ───────────────
        # Priority: booking_number > jacket_number > url+name > name+date fallback
        if booking_number:
            upsert_key: Dict[str, Any] = {
                "county": self.COUNTY,
                "booking_number": booking_number,
            }
        elif jacket_number:
            upsert_key = {
                "county": self.COUNTY,
                "jacket_number": jacket_number,
            }
        elif norm_url and full_name:
            upsert_key = {
                "county": self.COUNTY,
                "source_url": norm_url,
                "full_name": full_name,
            }
        else:
            # Last resort: name + date — not stable but better than sort-position.
            # Records without booking_number, jacket_number, or detail_url are
            # uncommon; if they appear, duplicates may occur across polls.
            scraped_date = (raw.get("_scraped_at") or "")[:10]
            upsert_key = {
                "county": self.COUNTY,
                "source": self.SOURCE,
                "full_name": full_name or "",
                "scraped_date": scraped_date,
            }

        # Extract computed values used by both canonical and compat fields
        booking_date = _parse_date(raw.get("arrest_date") or raw.get("booking_date"))
        charges      = raw.get("charges") or []

        event = EventRecord({
            # ── Identity ──
            "full_name":   full_name,
            "last_name":   raw.get("last_name")  or None,
            "first_name":  raw.get("first_name") or None,
            "dob":         raw.get("dob")  or None,
            "race":        raw.get("race") or None,
            "sex":         raw.get("sex")  or None,
            "age":         raw.get("age")  or None,

            # ── Booking ──
            "booking_number":  booking_number,
            "jacket_number":   jacket_number,
            "booking_date":    booking_date,
            "arrest_date":     _parse_date(raw.get("arrest_date")),
            "arrest_date_raw": raw.get("arrest_date_raw") or None,
            "agency":          raw.get("agency") or None,

            # ── Legal ──
            "charges":           charges,
            "bond_amount":       raw.get("bond_amount") or None,
            "charge_description": _first_charge_desc(charges),
            "release_date":      _parse_date(raw.get("release_date")),
            "mugshot_url":       raw.get("mugshot_url") or None,

            # ── Detail enrichment metadata ──
            "detail_fetch_status": raw.get("detail_fetch_status") or "skipped",
            "detail_fetch_error":  raw.get("detail_fetch_error") or None,

            # ── Source ──
            "county":     self.COUNTY,
            "source":     self.SOURCE,
            "source_id":  source_id,
            "source_url": norm_url,

            # ── Timestamps ──
            "scraped_at":  raw.get("_scraped_at") or self._scraped_at,
            "observed_at": _parse_date(raw.get("arrest_date")),  # best proxy for when event occurred
            # ingested_at set by store_event()

            # ── Compatibility aliases (backward-compat for dashboard/API reads) ──
            # Do NOT remove or rename v2-native fields above.
            # These aliases allow dashboard queries written against legacy schema
            # to work without modification during the read-path transition.
            "booked_at":       booking_date,   # alias of booking_date (ISO string)
            "event_date":      booking_date,   # alias of best available event date
            "county_display":  "Galveston",    # title-case for UI display
            "county_normalized": self.COUNTY,  # explicit lowercase alias (= county)

            # ── Dedup key (stable — never uses invid / sort-position) ──
            "_upsert_key": upsert_key,
        })

        return event

    # ── Detail page fetching (async) ─────────────────────────────────────────

    async def _fetch_all_details(
        self,
        urls: List[str],
        cookies: Dict[str, str],
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch all detail pages concurrently.  Returns {normalized_url: parsed_dict}."""
        sem = asyncio.Semaphore(CONCURRENCY)
        results: Dict[str, Dict[str, Any]] = {}

        async with httpx.AsyncClient(headers=UA, verify=_verify(), cookies=cookies, timeout=TIMEOUT) as client:
            tasks = [self._fetch_one_detail(client, sem, u) for u in urls]
            for coro in asyncio.as_completed(tasks):
                norm_url, data = await coro
                if data:
                    results[norm_url] = data

        return results

    async def _fetch_one_detail(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        url: str,
    ) -> tuple[str, Optional[Dict[str, Any]]]:
        norm = _normalize_detail_url(url)
        async with sem:
            await asyncio.sleep(ROW_DELAY)
            try:
                resp = await client.get(url, timeout=TIMEOUT)
                resp.raise_for_status()
                data = self._parse_detail_page(resp.text, url)
                data["detail_fetched_at"] = _utcnow_iso()
                return norm, data
            except Exception as exc:
                print(f"[galv] detail fetch error {url}: {exc}")
                return norm, None

    def _load_page_viewstate(self, cookies: Dict[str, str]) -> Dict[str, Any]:
        """
        GET /jailinmates.aspx once to extract ASP.NET VIEWSTATE fields.
        These are reused across all concurrent detail-page POSTs.
        """
        try:
            with httpx.Client(
                headers=UA, verify=_verify(), cookies=cookies,
                timeout=TIMEOUT, follow_redirects=True,
            ) as client:
                resp = client.get(ROSTER_HTML, headers={"Referer": f"{BASE}/main.aspx"})
                resp.raise_for_status()
                soup = BeautifulSoup(resp.text, "lxml")
                vs_el = soup.select_one("#__VIEWSTATE")
                vg_el = soup.select_one("#__VIEWSTATEGENERATOR")
                ev_el = soup.select_one("#__EVENTVALIDATION")
                return {
                    "__VIEWSTATE": vs_el["value"] if vs_el else "",
                    "__VIEWSTATEGENERATOR": vg_el["value"] if vg_el else "",
                    "__EVENTVALIDATION": ev_el["value"] if ev_el else "",
                    "loaded": bool(vs_el),
                }
        except Exception as exc:
            print(f"[galv] failed to load page VIEWSTATE: {exc}")
            return {"__VIEWSTATE": "", "__VIEWSTATEGENERATOR": "", "__EVENTVALIDATION": "", "loaded": False}

    async def _fetch_all_details_by_my_num(
        self,
        rows: List[Dict[str, Any]],
        viewstate: Dict[str, str],
        cookies: Dict[str, str],
    ) -> Dict[str, Dict[str, Any]]:
        """
        Fetch detail pages for all roster rows using their my_num (jqGrid row
        index) as the hfRecordIndex PostBack selector.
        Returns {my_num_str: parsed_detail_dict}.
        """
        sem = asyncio.Semaphore(CONCURRENCY)
        results: Dict[str, Dict[str, Any]] = {}

        async with httpx.AsyncClient(
            headers=UA, verify=_verify(), cookies=cookies,
            timeout=TIMEOUT, follow_redirects=True,
        ) as client:
            tasks = [
                self._fetch_one_detail_by_my_num(client, sem, str(row["my_num"]), viewstate)
                for row in rows
                if row.get("my_num") is not None
            ]
            for coro in asyncio.as_completed(tasks):
                my_num, data = await coro
                results[my_num] = data

        return results

    async def _fetch_one_detail_by_my_num(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        my_num: str,
        viewstate: Dict[str, str],
    ) -> tuple[str, Dict[str, Any]]:
        """POST to /jailinmates.aspx with hfRecordIndex=my_num to get the detail page."""
        async with sem:
            await asyncio.sleep(ROW_DELAY)
            try:
                post_data = {
                    "__EVENTTARGET": "",
                    "__EVENTARGUMENT": "",
                    "__VIEWSTATE": viewstate["__VIEWSTATE"],
                    "__VIEWSTATEGENERATOR": viewstate["__VIEWSTATEGENERATOR"],
                    "__EVENTVALIDATION": viewstate["__EVENTVALIDATION"],
                    _DETAIL_FORM_RECORD_INDEX: my_num,
                    _DETAIL_FORM_BUTTON: "Get Details",
                }
                resp = await client.post(
                    ROSTER_HTML,
                    data=post_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Referer": ROSTER_HTML,
                    },
                )
                resp.raise_for_status()
                # Verify we got a detail page (not a redirect to roster)
                if "lblName" not in resp.text:
                    raise ValueError("detail page not returned (missing lblName)")
                data = self._parse_detail_page(resp.text, f"{ROSTER_HTML}?my_num={my_num}")
                data["detail_fetched_at"] = _utcnow_iso()
                data["detail_fetch_status"] = "ok"
                return my_num, data
            except Exception as exc:
                print(f"[galv] detail fetch error my_num={my_num}: {exc}")
                return my_num, {
                    "detail_fetch_status": "failed",
                    "detail_fetch_error": str(exc)[:200],
                }

    def _parse_detail_page(self, html: str, source_url: str) -> Dict[str, Any]:
        """
        Parse a P2C inmate detail page.
        Uses ASP.NET-specific control IDs (ported from galveston_p2c_fast.py
        _parse_detail_html) with generic fallbacks.
        Returns dict with: full_name, last_name, first_name, dob, age, race, sex,
                           arrest_date, agency, booking_number, mugshot_url,
                           charges, bond_amount, total_bond.
        """
        soup = BeautifulSoup(html, "lxml")
        result: Dict[str, Any] = {"detail_url": source_url}

        def txt(sel: str) -> str:
            el = soup.select_one(sel)
            return (el.get_text(strip=True) if el else "").strip()

        # ── Name — ASP.NET control ID (primary) ──────────────────────────────
        name = txt("#mainContent_CenterColumnContent_lblName")
        if not name or _BAD_NAME_RE.search(name):
            # Fallback: heading elements
            for sel in ("h2.inmate-name", "td.inmate-name", "h1", "h2", "h3"):
                el = soup.select_one(sel)
                if el:
                    n = el.get_text(strip=True)
                    if n and not _BAD_NAME_RE.search(n) and len(n) > 3:
                        name = n
                        break

        if name and not _BAD_NAME_RE.search(name):
            result["full_name"] = name.upper()
            if "," in name:
                last, first = [x.strip() for x in name.split(",", 1)]
                result["last_name"]  = last.upper()
                result["first_name"] = first.upper()

        # ── Demographics — ASP.NET control IDs ───────────────────────────────
        result["age"]    = txt("#mainContent_CenterColumnContent_lblAge")   or None
        result["race"]   = txt("#mainContent_CenterColumnContent_lblRace")  or None
        result["sex"]    = txt("#mainContent_CenterColumnContent_lblSex")   or None
        result["arrest_date"] = txt("#mainContent_CenterColumnContent_lblArrestDate") or None
        result["agency"] = txt("#mainContent_CenterColumnContent_lblAgency") or None
        result["booking_number"] = (
            txt("#mainContent_CenterColumnContent_lblBookingNumber") or None
        )
        result["release_date"] = (
            txt("#mainContent_CenterColumnContent_lblReleaseDate") or None
        )

        # Total bond label (prefer labeled value over per-charge sum)
        total_bond_raw = (
            txt("#mainContent_CenterColumnContent_lblTotalBondAmount")
            or txt("#mainContent_CenterColumnContent_lblTotalBoundAmount")
            or None
        )

        # Mugshot
        img = soup.select_one("#mainContent_CenterColumnContent_imgPhoto")
        if img and img.get("src"):
            src = str(img["src"]).strip()
            result["mugshot_url"] = src if src.startswith("http") else f"{BASE}/{src.lstrip('/')}"

        # Fallback property pairs when ASP.NET IDs not found
        if not result.get("booking_number") or not result.get("agency"):
            prop_map: Dict[str, str] = {}
            for row in soup.select("tr"):
                cells = row.find_all("td")
                if len(cells) >= 2:
                    label = cells[0].get_text(strip=True).lower().rstrip(":").strip()
                    value = cells[1].get_text(strip=True)
                    if label and value:
                        prop_map[label] = value

            def _gp(*keys: str) -> Optional[str]:
                for k in keys:
                    if prop_map.get(k):
                        return prop_map[k]
                return None

            if not result.get("booking_number"):
                result["booking_number"] = _gp("booking number", "booking #", "booking no")
            if not result.get("agency"):
                result["agency"] = _gp("arresting agency", "agency")
            if not result.get("arrest_date"):
                result["arrest_date"] = _gp("arrest date", "booked", "booking date")

        # ── Charges table ─────────────────────────────────────────────────────
        charges: List[Dict[str, Any]] = []
        bond_values: List[float] = []

        # Primary: named charge grid
        primary_tbl = soup.select_one("#mainContent_CenterColumnContent_dgMainResults")
        tables_to_scan: List[Any] = [primary_tbl] if primary_tbl else []

        for tbl in soup.select("table"):
            if tbl is primary_tbl:
                continue
            heads = (
                [th.get_text(strip=True).lower() for th in tbl.select("thead th")]
                or [th.get_text(strip=True).lower() for th in tbl.find_all("th")]
            )
            head_str = " ".join(heads)
            if any(k in head_str for k in ("charge", "offense")) and any(
                k in head_str for k in ("bond", "docket", "status")
            ):
                tables_to_scan.append(tbl)

        for tbl in tables_to_scan:
            rows = tbl.select("tbody tr") or [
                tr for tr in tbl.select("tr") if tr.find_all("td")
            ]
            for idx, tr in enumerate(rows):
                tds = tr.find_all("td")
                # Skip header rows that slipped into tbody
                if idx == 0:
                    maybe_head = " ".join(td.get_text(strip=True).lower() for td in tds)
                    if all(k in maybe_head for k in ("charge", "status", "docket", "bond")):
                        continue
                if len(tds) >= 4:
                    c = {
                        "charge": tds[0].get_text(strip=True),
                        "status": tds[1].get_text(strip=True),
                        "docket": tds[2].get_text(strip=True),
                        "bond":   tds[3].get_text(strip=True),
                    }
                    amt = _money_to_float(tds[3].get_text(strip=True))
                    if amt:
                        bond_values.append(amt)
                    charges.append(c)
                elif len(tds) >= 2:
                    charges.append({
                        "charge": tds[0].get_text(strip=True),
                        "status": tds[1].get_text(strip=True) if len(tds) > 1 else "",
                        "docket": tds[2].get_text(strip=True) if len(tds) > 2 else "",
                        "bond":   tds[3].get_text(strip=True) if len(tds) > 3 else "",
                    })
            if charges:
                break

        result["charges"] = charges

        # Bond amount: labelled total > per-charge sum > None
        if total_bond_raw:
            result["bond_amount"] = _money_to_float(total_bond_raw) or None
            result["total_bond"]  = total_bond_raw
        elif bond_values:
            result["bond_amount"] = (
                sum(bond_values) if len(bond_values) > 1 else bond_values[0]
            )

        return result

    # ── Roster row parsing ───────────────────────────────────────────────────

    def _parse_roster_row(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Extract fields from one jqGrid JSON row.

        The P2C jqHandler.ashx?op=s endpoint returns named-key objects rather
        than the classic jqGrid {"id": ..., "cell": [...]} format:
          {
            "invid": "1", "my_num": "0", "book_id": "441503",
            "disp_name": "AGUILAR, BILLIE JO (W /F/54)",
            "firstname": "BILLIE", "lastname": "AGUILAR", "middlename": "JO",
            "age": "54", "dob": "12/4/1971 12:00:00 AM",
            "sex": "Female", "race": "White",
            "disp_arrest_date": "02/12/2026", "date_arr": "2/12/2026 12:00:00 AM",
            "disp_agency": "Galveston County Sheriffs Office", "agency": "GCSO",
            "chrgdesc": "THEFT PROP >=$750<$2500 ENH IAT",
            "link_text": "view"
          }

        Note: detail pages require an ASP.NET PostBack (selectRow/btnInmateDetail),
        so there is no simple GET detail URL — detail_url is left None.
        The stable identifier is book_id (the booking number).
        """
        # Named-field format (current API)
        if row.get("book_id") or row.get("firstname") or row.get("lastname"):
            first  = (row.get("firstname")   or "").strip()
            last   = (row.get("lastname")    or "").strip()
            middle = (row.get("middlename")  or "").strip()
            if last or first:
                parts = [last] if last else []
                given = " ".join(p for p in [first, middle] if p)
                if given:
                    parts.append(given)
                full_name = ", ".join(parts) if last else given
            else:
                full_name = (row.get("disp_name") or "").strip() or None

            return {
                "person_id":      row.get("invid") or row.get("my_num") or None,
                "full_name":      full_name or None,
                "first_name":     first or None,
                "last_name":      last or None,
                "agency":         row.get("disp_agency") or row.get("agency") or None,
                "booking_number": row.get("book_id") or None,
                "age":            row.get("age") or None,
                "dob":            _parse_date(row.get("dob")),
                "sex":            row.get("sex") or None,
                "race":           row.get("race") or None,
                "arrest_date":    _parse_date(row.get("disp_arrest_date") or row.get("date_arr")),
                "arrest_date_raw": row.get("disp_arrest_date") or row.get("date_arr") or None,
                "charges":        [row["chrgdesc"]] if row.get("chrgdesc") else [],
                "total_bond":     None,
                "my_num":         row.get("my_num"),  # jqGrid row index for detail PostBack
                "detail_url":     None,  # requires ASP.NET PostBack via hfRecordIndex
            }

        # Legacy cell-array format fallback
        cells = row.get("cell") or []
        row_id = str(row.get("id") or "")

        detail_url: Optional[str] = None
        href_re = re.compile(r'href=["\']([^"\']+)["\']', re.I)

        for cell in cells:
            if not isinstance(cell, str):
                continue
            m = href_re.search(cell)
            if m:
                raw_href = m.group(1).strip()
                if not raw_href.startswith("http"):
                    raw_href = f"{BASE}/{raw_href.lstrip('/')}"
                if "inmate" in raw_href.lower() or "detail" in raw_href.lower():
                    detail_url = raw_href
                    break

        plain_cells = []
        for cell in cells:
            if isinstance(cell, str):
                text = BeautifulSoup(cell, "lxml").get_text(strip=True)
                plain_cells.append(text)
            else:
                plain_cells.append(str(cell) if cell is not None else "")

        if not plain_cells and not row_id:
            return None

        return {
            "person_id":      row_id or None,
            "full_name":      None,
            "agency":         plain_cells[1] if len(plain_cells) > 1 else None,
            "booking_number": plain_cells[2] if len(plain_cells) > 2 else None,
            "total_bond":     _money_to_float(plain_cells[3]) if len(plain_cells) > 3 else None,
            "detail_url":     detail_url,
        }

    def _extract_detail_urls(self, rows: List[Dict[str, Any]]) -> List[str]:
        """Extract all unique normalized detail page URLs from JSON roster rows."""
        seen: set[str] = set()
        urls: List[str] = []
        href_re = re.compile(r'href=["\']([^"\']+)["\']', re.I)

        for row in rows:
            cells = row.get("cell") or []
            for cell in cells:
                if not isinstance(cell, str):
                    continue
                m = href_re.search(cell)
                if not m:
                    continue
                raw_href = m.group(1).strip()
                if not raw_href.startswith("http"):
                    raw_href = f"{BASE}/{raw_href.lstrip('/')}"
                if "inmate" not in raw_href.lower() and "detail" not in raw_href.lower():
                    continue
                norm = _normalize_detail_url(raw_href)
                if norm not in seen:
                    seen.add(norm)
                    urls.append(raw_href)  # use original URL to fetch, dedup by norm

        return urls

    # ── Endpoint management ──────────────────────────────────────────────────

    def _get_endpoint(self) -> Optional[Dict[str, Any]]:
        """
        Load endpoint config from:
          1. In-memory cache (self._endpoint)
          2. MongoDB cache (galveston_p2c_endpoint collection)
          3. Playwright discovery (writes result to MongoDB cache)
        """
        if self._endpoint:
            return self._endpoint

        if USE_ENDPOINT_CACHE:
            cached = self.db[ENDPOINT_CACHE_COLLECTION].find_one(
                {"source": self.SOURCE},
                sort=[("discovered_at", -1)],
            )
            if cached and cached.get("url"):
                print(f"[galv] using cached endpoint: {cached['url']}")
                self._endpoint = cached
                return self._endpoint

        print("[galv] discovering P2C endpoint via Playwright …")
        discovered = _playwright_discover_endpoint()
        if discovered:
            discovered["source"] = self.SOURCE
            discovered["discovered_at"] = _utcnow_iso()
            if USE_ENDPOINT_CACHE:
                self.db[ENDPOINT_CACHE_COLLECTION].insert_one(discovered)
            self._endpoint = discovered
            return self._endpoint

        # Last resort: hardcoded known endpoint (may drift if P2C upgrades)
        print("[galv] discovery failed — using hardcoded fallback endpoint")
        fallback: Dict[str, Any] = {
            "url": f"{BASE}/jqHandler.ashx?op=s&which=inmates&col=0&dir=asc&grid=grids-jail-inmates",
            "method": "GET",
            "headers": {},
            "post_data": "",
            "cookies": [],
            "source": self.SOURCE,
            "discovered_at": _utcnow_iso(),
            "is_fallback": True,
        }
        self._endpoint = fallback
        return fallback


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.event_feeds.galveston_p2c --dry-run [--limit N]

if __name__ == "__main__":
    import argparse
    import json
    import sys

    class _NullDb:
        """Minimal stand-in for a pymongo Database — ignores all writes."""
        class _NullColl:
            def find_one(self, *a, **kw):          return None
            def insert_one(self, *a, **kw):         return type("R", (), {"inserted_id": None})()
            def update_one(self, *a, **kw):         return type("R", (), {"upserted_id": None, "matched_count": 0, "modified_count": 0})()
            def find(self, *a, **kw):               return []
        def __getitem__(self, name):                return self._NullColl()
        def __getattr__(self, name):                return self._NullColl()

    ap = argparse.ArgumentParser(description="Galveston P2C dry-run")
    ap.add_argument("--dry-run",  action="store_true", default=True)
    ap.add_argument("--limit",    type=int, default=5, help="Max events to print")
    args = ap.parse_args()

    print(f"[galveston] dry-run mode — no MongoDB writes — limit={args.limit}")
    scraper = GalvestonP2CEventFeed(_NullDb())

    raw_events = list(scraper.fetch_events())
    print(f"[galveston] fetch_events() returned {len(raw_events)} raw rows")

    printed = 0
    for raw in raw_events[:args.limit]:
        raw["_scraped_at"] = _utcnow_iso()
        event = scraper.normalize_event(raw)
        if event is None:
            print("  [skip] normalize_event() returned None")
            continue
        missing = event.validate() if isinstance(event, EventRecord) else []
        status = "WARN missing: " + str(missing) if missing else "OK"
        print(f"  [{status}] {json.dumps({k: v for k, v in event.items() if k != 'raw'}, default=str, indent=2)}")
        printed += 1

    print(f"[galveston] printed {printed}/{min(len(raw_events), args.limit)} normalized events")
    sys.exit(0)
