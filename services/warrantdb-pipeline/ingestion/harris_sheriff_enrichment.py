"""
ingestion/harris_sheriff_enrichment.py
───────────────────────────────────────────────────────────────────────────────
Harris County Sheriff JailInfo SPN enrichment scraper.

Queries https://www.harriscountyso.org/JailInfo/FindSomeoneInJail by SPN number.
Stores results in the `harris_sheriff_enrichments` collection.

Key behaviors:
- Uses __RequestVerificationToken CSRF (GoogleCaptchaToken left empty).
- Rate limit: 500–1500ms random sleep between requests.
- Window: only records scraped within the last 7 days are eligible for batch enrichment.
- Recheck policy: active_custody → 24h, released/no_match/error → 7d.
- If result is "NOT IN JAIL": marks associated v2_harris_reports records as
  no_longer_prospect=True (they have posted bail or been released).
"""
from __future__ import annotations

import datetime as dt
import random
import re
import sys
import time
from typing import Any, Dict, List, Optional

import requests
from bs4 import BeautifulSoup

JAIL_INFO_URL = "https://www.harriscountyso.org/JailInfo/FindSomeoneInJail"

# Recheck intervals
RECHECK_ACTIVE_HOURS = 24        # Re-check in-custody records every 24 hours
RECHECK_INACTIVE_HOURS = 7 * 24  # Re-check released/no_match records every 7 days

# Hard cap on how far back batch mode looks (days)
MAX_WINDOW_DAYS = 7


class HarrisSheriffEnrichment:
    """
    Enriches Harris County inmate records by querying the Sheriff JailInfo site
    per SPN and persisting the result to `harris_sheriff_enrichments`.
    """

    COLLECTION = "harris_sheriff_enrichments"
    HARRIS_REPORTS_COLLECTION = "v2_harris_reports"

    def __init__(self, db, dry_run: bool = True):
        self.db = db
        self.dry_run = dry_run
        self._session: Optional[requests.Session] = None

    # ── HTTP session ──────────────────────────────────────────────────────────

    def _get_session(self) -> requests.Session:
        if self._session is None:
            sess = requests.Session()
            sess.headers.update({
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            })
            self._session = sess
        return self._session

    def _get_csrf_token(self) -> str:
        """GET the JailInfo page and extract the __RequestVerificationToken."""
        session = self._get_session()
        resp = session.get(JAIL_INFO_URL, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        token_input = soup.find("input", {"name": "__RequestVerificationToken"})
        if not token_input:
            raise ValueError("Could not find __RequestVerificationToken on JailInfo page")
        return token_input.get("value", "")

    # ── Single-SPN enrichment ─────────────────────────────────────────────────

    def enrich_by_spn(self, spn: str) -> Dict[str, Any]:
        """
        Query Sheriff JailInfo for a single SPN.

        Returns a dict with fields:
          ok, spn, matched, custody_status, full_name, dob, age, sex, race,
          facility, housing_location, booking_status, release_status,
          warnings, raw, scraped_at

        Side effects (when dry_run=False):
          - Upserts result into `harris_sheriff_enrichments`.
          - If custody_status == 'not_in_custody', marks matching
            `v2_harris_reports` records with no_longer_prospect=True.
        """
        spn = str(spn).strip().zfill(8)  # Ensure 8-digit zero-padded
        warnings: List[str] = []

        try:
            csrf_token = self._get_csrf_token()
            time.sleep(random.uniform(0.5, 1.5))

            session = self._get_session()
            post_url = f"{JAIL_INFO_URL}?Length={len(spn)}"
            resp = session.post(
                post_url,
                data={
                    "GoogleCaptchaToken": "",
                    "__RequestVerificationToken": csrf_token,
                    "LastName": "",
                    "FirstName": "",
                    "Dob": "",
                    "SPN": spn,
                    "SSN": "",
                },
                timeout=20,
            )
            resp.raise_for_status()
        except Exception as exc:
            err_msg = str(exc)
            print(f"[harris_sheriff] HTTP error for SPN {spn}: {err_msg}", file=sys.stderr)
            result: Dict[str, Any] = {
                "ok": False,
                "spn": spn,
                "matched": False,
                "custody_status": "error",
                "full_name": None,
                "dob": None,
                "age": None,
                "sex": None,
                "race": None,
                "facility": None,
                "housing_location": None,
                "booking_status": None,
                "release_status": None,
                "warnings": [err_msg],
                "raw": None,
                "scraped_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                "error": err_msg,
            }
            if not self.dry_run:
                self._upsert_enrichment(result)
            return result

        result = self._parse_response(spn, resp.text, warnings)

        if not self.dry_run:
            self._upsert_enrichment(result)
            if result.get("custody_status") == "not_in_custody":
                self._mark_released(spn, result)

        return result

    # ── HTML parser ───────────────────────────────────────────────────────────

    def _parse_response(
        self, spn: str, html: str, warnings: List[str]
    ) -> Dict[str, Any]:
        """Parse JailInfo HTML response into a structured enrichment dict."""
        scraped_at = dt.datetime.now(dt.timezone.utc).isoformat()
        # Keep raw HTML capped to avoid bloating the collection
        raw_html = html[:6000]

        soup = BeautifulSoup(html, "html.parser")
        page_text = soup.get_text(" ", strip=True)
        tables = soup.find_all("table")

        # ── "IS NOT IN JAIL" ──────────────────────────────────────────────────
        not_in_jail_match = re.search(
            r"([A-Z][A-Z ,\-\']+)\((\d{5,})\)\s+IS NOT IN JAIL",
            page_text,
            re.IGNORECASE,
        )
        if not_in_jail_match:
            full_name = not_in_jail_match.group(1).strip().rstrip(",").strip()
            confirmed_spn = not_in_jail_match.group(2)
            # Extract timestamp if present
            timestamp_str = self._extract_timestamp(page_text)
            # Extract demographics even for not-in-jail responses (site still renders table)
            demographics = self._parse_custody_tables(tables, page_text, []) or {}
            return {
                "ok": True,
                "spn": spn,
                "confirmed_spn": confirmed_spn,
                "matched": True,
                "custody_status": "not_in_custody",
                "full_name": full_name,
                "dob": demographics.get("dob") or self._extract_dob_from_text(page_text),
                "age": demographics.get("age"),
                "sex": demographics.get("sex"),
                "race": demographics.get("race"),
                "facility": None,
                "housing_location": None,
                "booking_status": None,
                "release_status": "released_or_bailed",
                "info_accurate_as_of": timestamp_str,
                "warnings": warnings,
                "raw": raw_html,
                "scraped_at": scraped_at,
            }

        # ── In-custody: parse detail tables ───────────────────────────────────
        if tables:
            person_data = self._parse_custody_tables(tables, page_text, warnings)
            if person_data:
                timestamp_str = self._extract_timestamp(page_text)
                return {
                    "ok": True,
                    "spn": spn,
                    "confirmed_spn": person_data.get("confirmed_spn", spn),
                    "matched": True,
                    "custody_status": "in_custody",
                    "full_name": person_data.get("full_name"),
                    "dob": person_data.get("dob") or self._extract_dob_from_text(page_text),
                    "age": person_data.get("age"),
                    "sex": person_data.get("sex"),
                    "race": person_data.get("race"),
                    "facility": person_data.get("facility"),
                    "housing_location": person_data.get("housing_location"),
                    "booking_status": person_data.get("booking_status"),
                    "release_status": person_data.get("release_status"),
                    "info_accurate_as_of": timestamp_str,
                    "warnings": warnings,
                    "raw": raw_html,
                    "scraped_at": scraped_at,
                }

        # ── No result found ───────────────────────────────────────────────────
        warnings.append("No matching result found in response")
        timestamp_str = self._extract_timestamp(page_text)
        return {
            "ok": True,
            "spn": spn,
            "confirmed_spn": None,
            "matched": False,
            "custody_status": "no_match",
            "full_name": None,
            "dob": None,
            "age": None,
            "sex": None,
            "race": None,
            "facility": None,
            "housing_location": None,
            "booking_status": None,
            "release_status": None,
            "info_accurate_as_of": timestamp_str,
            "warnings": warnings,
            "raw": raw_html,
            "scraped_at": scraped_at,
        }

    @staticmethod
    def _extract_timestamp(page_text: str) -> Optional[str]:
        """Extract 'INFORMATION ACCURATE AS OF ...' timestamp from page text."""
        ts_match = re.search(
            r"INFORMATION ACCURATE AS OF\s+(\d{2}/\d{2}/\d{4}\s*-\s*\d{2}:\d{2})",
            page_text,
            re.IGNORECASE,
        )
        return ts_match.group(1).strip() if ts_match else None

    @staticmethod
    def _extract_dob_from_text(page_text: str) -> Optional[str]:
        """
        Fallback: extract DOB (MM/DD/YYYY) from raw page text when the table
        cell parser did not find it.  Matches labels like:
          DOB: 01/15/1985  |  Date of Birth  01/15/1985
        """
        match = re.search(
            r"\b(?:DOB|Date\s+of\s+Birth)\s*:?\s*(\d{2}/\d{2}/\d{4})\b",
            page_text,
            re.IGNORECASE,
        )
        return match.group(1) if match else None

    @staticmethod
    def _parse_custody_tables(
        tables, page_text: str, warnings: List[str]
    ) -> Optional[Dict[str, Any]]:
        """
        Extract inmate fields from response tables when the person IS in custody.
        Returns a dict of parsed fields, or None if nothing useful is found.
        """
        data: Dict[str, Any] = {}

        # Look for SPN in header (e.g. "FLORES, DAVID(03334984)")
        spn_name_match = re.search(
            r"([A-Z][A-Z ,\-\']+)\((\d{5,})\)",
            page_text,
            re.IGNORECASE,
        )
        if spn_name_match:
            data["full_name"] = spn_name_match.group(1).strip().rstrip(",").strip()
            data["confirmed_spn"] = spn_name_match.group(2)

        # Walk all table cells for labelled fields
        field_map = {
            "DOB": "dob",
            "DATE OF BIRTH": "dob",
            "AGE": "age",
            "SEX": "sex",
            "RACE": "race",
            "FACILITY": "facility",
            "HOUSING LOCATION": "housing_location",
            "HOUSING LOC": "housing_location",
            "BOOKING STATUS": "booking_status",
            "RELEASE STATUS": "release_status",
        }

        for table in tables:
            rows = table.find_all("tr")
            for row in rows:
                cells = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
                for i, cell in enumerate(cells):
                    key = cell.upper().rstrip(":")
                    if key in field_map and i + 1 < len(cells):
                        value = cells[i + 1].strip()
                        if value:
                            data[field_map[key]] = value

        # Regex fallback for DOB if not found in any table cell
        if not data.get("dob"):
            dob_match = re.search(
                r"\b(?:DOB|Date\s+of\s+Birth)\s*:?\s*(\d{2}/\d{2}/\d{4})\b",
                page_text,
                re.IGNORECASE,
            )
            if dob_match:
                data["dob"] = dob_match.group(1)

        if not data:
            warnings.append("Could not parse any custody fields from response tables")
            return None

        return data

    # ── Persistence helpers ───────────────────────────────────────────────────

    def _upsert_enrichment(self, result: Dict[str, Any]) -> None:
        """Upsert the enrichment result into harris_sheriff_enrichments."""
        doc = {**result, "last_checked_at": dt.datetime.now(dt.timezone.utc).isoformat()}
        try:
            self.db[self.COLLECTION].update_one(
                {"spn": result["spn"]},
                {"$set": doc},
                upsert=True,
            )
        except Exception as exc:
            print(
                f"[harris_sheriff] upsert failed for SPN {result['spn']}: {exc}",
                file=sys.stderr,
            )

    def _mark_released(self, spn: str, enrichment: Dict[str, Any]) -> None:
        """
        When a person is confirmed NOT IN JAIL, flag their harris_reports records
        so downstream prospect tracking knows they are no longer active.

        Sets:
          no_longer_prospect=True
          prospect_status='released'
          released_confirmed=True
          released_confirmed_at=<scraped_at>
          released_confirmed_by='harris_sheriff_enrichment'
        """
        try:
            result = self.db[self.HARRIS_REPORTS_COLLECTION].update_many(
                {"spn": spn},
                {
                    "$set": {
                        "no_longer_prospect": True,
                        "prospect_status": "released",
                        "released_confirmed": True,
                        "released_confirmed_at": enrichment.get("scraped_at"),
                        "released_confirmed_by": "harris_sheriff_enrichment",
                    }
                },
            )
            matched = getattr(result, "matched_count", "?")
            modified = getattr(result, "modified_count", "?")
            print(
                f"[harris_sheriff] SPN {spn} marked released — "
                f"matched={matched} modified={modified} harris_reports records"
            )
        except Exception as exc:
            print(
                f"[harris_sheriff] could not mark SPN {spn} as released: {exc}",
                file=sys.stderr,
            )

    # ── Batch runner ──────────────────────────────────────────────────────────

    def run_batch(self, window_days: int = 7, limit: int = 25) -> Dict[str, Any]:
        """
        Enrich SPNs from recent Harris reports.

        Only considers records scraped within the past MAX_WINDOW_DAYS days
        (hard capped at 7 — records older than 7 days are no longer actionable
        prospects for bail-bond purposes).

        Skips SPNs that were recently enriched based on recheck policy.
        """
        # Hard cap: never look further back than MAX_WINDOW_DAYS
        effective_window = min(int(window_days), MAX_WINDOW_DAYS)

        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=effective_window)
        cutoff_iso = cutoff.isoformat()

        print(
            f"[harris_sheriff] batch mode — window={effective_window}d "
            f"cutoff={cutoff_iso} limit={limit} dry_run={self.dry_run}"
        )

        # Gather SPNs from recent Harris reports
        try:
            cursor = self.db[self.HARRIS_REPORTS_COLLECTION].find(
                {
                    "spn": {"$exists": True, "$ne": None, "$ne": ""},
                    "scraped_at": {"$gte": cutoff_iso},
                },
                {"spn": 1},
            )
            all_spns = list({str(doc["spn"]).strip() for doc in cursor if doc.get("spn")})
        except Exception as exc:
            print(f"[harris_sheriff] could not query harris_reports: {exc}", file=sys.stderr)
            return {"seen": 0, "matched": 0, "unmatched": 0, "written": 0, "errors": 1}

        print(f"[harris_sheriff] found {len(all_spns)} unique SPNs in window")

        # Filter out recently enriched SPNs
        now = dt.datetime.now(dt.timezone.utc)
        eligible_spns: List[str] = []
        skipped_cached = 0
        for spn in all_spns:
            try:
                existing = self.db[self.COLLECTION].find_one(
                    {"spn": spn}, {"custody_status": 1, "last_checked_at": 1}
                )
                if existing:
                    last_checked_raw = existing.get("last_checked_at")
                    if last_checked_raw:
                        last_dt = dt.datetime.fromisoformat(
                            str(last_checked_raw).replace("Z", "+00:00")
                        )
                        if last_dt.tzinfo is None:
                            last_dt = last_dt.replace(tzinfo=dt.timezone.utc)
                        hours_since = (now - last_dt).total_seconds() / 3600
                        status = existing.get("custody_status", "unknown")
                        if status == "in_custody" and hours_since < RECHECK_ACTIVE_HOURS:
                            skipped_cached += 1
                            continue
                        if status in ("not_in_custody", "no_match") and hours_since < RECHECK_INACTIVE_HOURS:
                            skipped_cached += 1
                            continue
            except Exception:
                pass  # If cache check fails, include the SPN
            eligible_spns.append(spn)

        print(
            f"[harris_sheriff] {len(eligible_spns)} eligible SPNs "
            f"({skipped_cached} skipped — recently enriched)"
        )

        # Apply limit
        to_enrich = eligible_spns[:limit]

        seen = len(to_enrich)
        matched = 0
        unmatched = 0
        written = 0
        errors = 0

        for i, spn in enumerate(to_enrich):
            print(f"[harris_sheriff] ({i + 1}/{seen}) enriching SPN {spn}")
            try:
                result = self.enrich_by_spn(spn)
                status = result.get("custody_status", "unknown")
                if result.get("matched"):
                    matched += 1
                    print(
                        f"  → {status} | {result.get('full_name', '?')}"
                        + (" ⚠ NO LONGER PROSPECT" if status == "not_in_custody" else "")
                    )
                else:
                    unmatched += 1
                    print(f"  → no match")
                if not self.dry_run and result.get("ok"):
                    written += 1
            except Exception as exc:
                errors += 1
                print(f"[harris_sheriff] error enriching SPN {spn}: {exc}", file=sys.stderr)

            # Rate limiting — sleep between requests
            if i < seen - 1:
                time.sleep(random.uniform(0.5, 1.5))

        print(
            f"[harris_sheriff] batch complete — "
            f"seen={seen} matched={matched} unmatched={unmatched} "
            f"written={written} errors={errors} skipped_cached={skipped_cached}"
        )

        return {
            "seen": seen,
            "matched": matched,
            "unmatched": unmatched,
            "written": written,
            "errors": errors,
            "skipped_cached": skipped_cached,
            "window_days": effective_window,
        }
