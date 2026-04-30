"""
ingestion/reports/harris_reports.py
─────────────────────────────────────────────────────────────────────────────
Harris County District Clerk — ReportIngestor.

Source:   https://www.hcdistrictclerk.com/Common/e-services/PublicDatasets.aspx
Platform: Harris County District Clerk public datasets
Files:    CSV exports for bond, misdemeanor/felony, and no-action filings

Report types
────────────
Harris publishes six report files on a rolling basis:

  Group × Kind matrix:
    Groups : Civil, Criminal
    Kinds  : bond, misfel (misdemeanor/felony filings), nafiling (no-action filings)

  Each file has a URL like:
    {FILES_BASE}/Civil/DistrictClerk_bond_MMDDYYYY.csv

Idempotency
───────────
Reports are deduplicated by URL in the report_manifest collection.
Skipping a previously-ingested report is the default behavior.
Pass force=True to detect_new_reports() to re-ingest.

Pending implementation
──────────────────────
parse_report() and normalize_record() are stubs.  Full parsing logic is in
the legacy ingestion/harris_inmate.py file and should be ported here in a
future iteration.  The collection names and field mappings are intentionally
preserved for backward compatibility.
"""
from __future__ import annotations

import csv
import io
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

import requests
from bs4 import BeautifulSoup

from ingestion.reports.base import ReportIngestor

# ── Environment / constants ──────────────────────────────────────────────────

FILES_BASE = os.getenv(
    "HARRIS_BASE_FILES_URL",
    "https://www.hcdistrictclerk.com/Common/e-services/Files",
).rstrip("/")

PAGE_URL = os.getenv(
    "HARRIS_DATASETS_PAGE",
    "https://www.hcdistrictclerk.com/Common/e-services/PublicDatasets.aspx",
)

GROUPS = ["Civil", "Criminal"]
KINDS  = ["bond", "misfel", "nafiling"]

_UA = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124 Safari/537.36"
    )
}

# Canonical MongoDB collections (preserved from harris_inmate.py)
_COLLECTION_MAP = {
    "bond":     "harris_bond",
    "misfel":   "harris_misfel",
    "nafiling": "harris_nafiling",
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_int(s: Optional[str]) -> Optional[int]:
    """Parse an integer from a possibly comma-padded string."""
    if not s:
        return None
    s = s.replace(",", "").strip()
    return int(s) if s.isdigit() else None


def _parse_yymmdd(s: Optional[str]) -> Optional[str]:
    """Parse a 6-digit MMDDYY string into YYYY-MM-DD ISO format."""
    if not s or len(s) != 6 or not s.isdigit():
        return None
    mm, dd, yy = s[:2], s[2:4], s[4:6]
    year = (2000 if int(yy) < 70 else 1900) + int(yy)
    try:
        return f"{year}-{int(mm):02d}-{int(dd):02d}"
    except Exception:
        return None


def _addr_line(parts: List[Optional[str]]) -> Optional[str]:
    joined = " ".join(p for p in parts if p)
    return joined or None


def _needs_bond_help(bond_amount: Optional[int], bond_note: Optional[str]) -> bool:
    """Return True when a defendant appears to still need a bail bond."""
    if bond_amount is None or bond_amount <= 0:
        return False
    if bond_note and bond_note.strip().upper() in {"BOND DENIED", "UNSECURED GOB ELIGIBLE"}:
        return False
    return True


_HARRIS_CASE_RE = re.compile(r'^\d{7,}$')


def _looks_like_harris_case_number(val: Optional[str]) -> bool:
    """Harris District Clerk case numbers are 7+ consecutive digits.

    Rejects short values like '002', '003', '42' that appear in some misfel
    CSV variants where the court/sequence number occupies c[7] instead of
    the real case number.  Real Harris case numbers are always >= 7 digits
    (e.g. '1234567' or '261688301010').
    """
    if not val:
        return False
    return bool(_HARRIS_CASE_RE.match(val.strip()))


def _parse_rows(text: str) -> List[List[str]]:
    """
    Parse Harris CSV text into a list of rows (list of string cells).
    Ported from harris_inmate.py._parse_rows().
    - Rejects HTML/error pages.
    - Drops trailing empty field caused by terminal semicolons.
    """
    head = text[:2048].lower()
    for bad in ("<html", "<!doctype", "<body", "server error", "stack trace", "system.web"):
        if bad in head:
            return []
    rows: List[List[str]] = []
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if row and row[-1] == "":
            row = row[:-1]
        if row:
            rows.append(row)
    return rows


def _looks_like_dataset(text: str, kind: str) -> bool:
    """
    Validate that text looks like a real Harris CSV dataset.
    Ported from harris_inmate.py._looks_like_dataset().
    """
    head = text[:2048].lower()
    for bad in ("<html", "<!doctype", "<body", "server error", "stack trace"):
        if bad in head:
            return False
    lines = text.splitlines()[:50]
    sep_count = sum(
        1 for ln in lines if any(c in ln for c in (",", ";", "|", "\t"))
    )
    if sep_count < 2:
        return False
    has_wide = any(
        len([f for f in re.split(r"[,;|\t]", ln) if f]) >= 6
        for ln in lines
    )
    return has_wide


def _date_from_filename(filename: str) -> Optional[str]:
    """
    Extract a publish date from a Harris report filename.

    Supported formats (checked in order):
      YYYY-MM-DD  e.g. 2026-04-26-bond.txt            → 2026-04-26
      MM-DD-YY    e.g. 04-26-26-bond.txt               → 2026-04-26  (current Harris)
                       bond_04-26-26.txt                → 2026-04-26
      YYYYMMDD    e.g. 20260426_BondNoAtty.txt          → 2026-04-26  (8-digit run, year first)
      MMDDYYYY    e.g. DistrictClerk_bond_04262026.csv  → 2026-04-26  (legacy)

    NOTE: Patterns with explicit separators (dashes) are tested before
    run-together digit strings.  YYYYMMDD (year-first) is tested before
    MMDDYYYY (month-first) so that sequences like "20260426" are not
    misinterpreted as month=20, day=26, year=0426.
    """
    # YYYY-MM-DD (ISO date with dashes anywhere in filename)
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", filename)
    if m:
        yyyy, mm, dd = m.groups()
        try:
            return f"{int(yyyy)}-{int(mm):02d}-{int(dd):02d}"
        except Exception:
            pass

    # MM-DD-YY (Harris current format, e.g. 04-26-26 or bond_04-26-26)
    # Lookarounds prevent matching inside longer digit sequences.
    m = re.search(r"(?<!\d)(\d{2})-(\d{2})-(\d{2})(?!\d)", filename)
    if m:
        mm, dd, yy = m.groups()
        year = (2000 if int(yy) < 70 else 1900) + int(yy)
        try:
            return f"{year}-{int(mm):02d}-{int(dd):02d}"
        except Exception:
            pass

    # YYYYMMDD — 8-digit run where the first 4 digits form a plausible year
    # (e.g. 20260426 → 2026-04-26).  Checked before MMDDYYYY so that a
    # leading century prefix is not misread as a month.
    m = re.search(r"(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)", filename)
    if m:
        yyyy, mm, dd = m.groups()
        if 1 <= int(mm) <= 12 and 1 <= int(dd) <= 31:
            try:
                return f"{int(yyyy)}-{int(mm):02d}-{int(dd):02d}"
            except Exception:
                pass

    # MMDDYYYY — 8-digit run, month first, 4-digit year last (legacy CSV format)
    # Only match when the last 4 digits form a plausible year (19xx/20xx) and
    # the leading 2 digits are a plausible month (01-12).
    m = re.search(r"(?<!\d)(\d{2})(\d{2})((?:19|20)\d{2})(?!\d)", filename)
    if m:
        mm, dd, yyyy = m.groups()
        if 1 <= int(mm) <= 12 and 1 <= int(dd) <= 31:
            try:
                return f"{int(yyyy)}-{int(mm):02d}-{int(dd):02d}"
            except Exception:
                pass

    return None


# ── Main class ───────────────────────────────────────────────────────────────

class HarrisReportIngestor(ReportIngestor):
    """
    Harris County District Clerk CSV report ingestor.

    This class handles the multi-collection nature of Harris reports by
    routing each report to the correct collection based on report_meta["kind"].
    """

    # COLLECTION is overridden per-record in store_record() based on kind
    COLLECTION = "harris_bond"          # default; actual routing in store_record()
    COUNTY = "harris"
    SOURCE = "harris_district_clerk"

    # ── fetch_report_list() ──────────────────────────────────────────────────

    def fetch_report_list(self) -> List[Dict[str, Any]]:
        """
        Scrape the Harris District Clerk public datasets page for available
        CSV file links.

        Returns a list of report metadata dicts, each containing:
          url          : full download URL
          filename     : basename of the CSV file
          group        : "Civil" or "Criminal"
          kind         : "bond" | "misfel" | "nafiling"
          publish_date : YYYY-MM-DD parsed from filename (or None)
        """
        try:
            resp = requests.get(PAGE_URL, headers=_UA, timeout=30)
            resp.raise_for_status()
        except Exception as exc:
            print(f"[harris] failed to fetch datasets page: {exc}")
            return []

        html = resp.text
        reports: List[Dict[str, Any]] = []

        # Harris uses DownloadDoc('Civil\\04-26-26-bond.txt') JS calls
        # (no direct <a href="...txt"> links on the page)
        import re as _re
        seen: set = set()
        for rel_path in _re.findall(r"DownloadDoc\(['\"]([^'\"]+\.txt)['\"]\)", html, flags=_re.IGNORECASE):
            rel_path = rel_path.replace("\\\\", "\\")  # normalise double-backslash
            if rel_path in seen:
                continue
            seen.add(rel_path)
            filename = rel_path.replace("\\", "/").split("/")[-1]

            kind: Optional[str] = None
            for k in KINDS:
                if k in filename.lower():
                    kind = k
                    break
            if kind is None:
                continue

            group: Optional[str] = None
            for g in GROUPS:
                if g.lower() in rel_path.lower():
                    group = g
                    break
            if group is None:
                group = "Criminal"

            reports.append({
                "url":          f"{PAGE_URL}?_rel={rel_path.replace(chr(92), '/')}",
                "rel_path":     rel_path,
                "filename":     filename,
                "group":        group,
                "kind":         kind,
                "publish_date": _date_from_filename(filename),
            })

        print(f"[harris] found {len(reports)} CSV reports on datasets page")
        return reports

    # ── detect_new_reports() ─────────────────────────────────────────────────

    def detect_new_reports(self, force: bool = False) -> Iterable[Dict[str, Any]]:
        """
        Yield only reports not already ingested.

        force=True re-ingests all found reports (useful for re-processing
        after a normalize_record() fix).
        """
        all_reports = self.fetch_report_list()
        for meta in all_reports:
            if not force and self._is_report_processed(meta):
                print(f"[harris] skipping already-ingested report: {meta['filename']}")
                continue
            yield meta

    # ── download_report() ────────────────────────────────────────────────────

    def download_report(self, report_meta: Dict[str, Any]) -> bytes:
        """
        Download a Harris .txt report file via ASP.NET WebForms POST.

        Harris does not serve files via direct GET; files are delivered by
        posting back to the datasets page with hiddenDownloadFile set to
        the relative path (e.g. "Civil\\04-26-26-bond.txt").
        """
        rel_path = report_meta.get("rel_path") or ""
        filename = report_meta.get("filename", "<unknown>")

        sess = requests.Session()
        sess.headers.update(_UA)

        # Step 1: GET the page to obtain ASP.NET tokens + cookies
        try:
            r0 = sess.get(PAGE_URL, timeout=30)
            r0.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"[harris] failed to load datasets page: {exc}") from exc

        soup0 = BeautifulSoup(r0.text, "lxml")

        def _val(id_: str) -> str:
            el = soup0.find("input", {"id": id_})
            return el.get("value", "") if el else ""

        # Step 2: POST back with the file path and button
        data = {
            "__EVENTTARGET": "",
            "__EVENTARGUMENT": "",
            "__VIEWSTATE": _val("__VIEWSTATE"),
            "__VIEWSTATEGENERATOR": _val("__VIEWSTATEGENERATOR"),
            "__EVENTVALIDATION": _val("__EVENTVALIDATION"),
            "hiddenDownloadFile": rel_path.replace("/", "\\"),
            "ctl00$ctl00$ctl00$ContentPlaceHolder1$ContentPlaceHolder2$ContentPlaceHolder2$buttonDownload": "",
        }
        try:
            r1 = sess.post(PAGE_URL, data=data, timeout=90)
            r1.raise_for_status()
        except Exception as exc:
            raise RuntimeError(f"[harris] POST download failed for {filename}: {exc}") from exc

        content = r1.content
        head = content[:512].decode("utf-8", errors="replace").lower()
        if "<html" in head or "<!doctype" in head:
            raise ValueError(f"[harris] Got HTML instead of data for {filename} — check rel_path")

        print(f"[harris] downloaded {len(content):,} bytes: {filename}")
        return content

    # ── parse_report() ───────────────────────────────────────────────────────

    def parse_report(
        self, content: bytes, report_meta: Dict[str, Any]
    ) -> Iterable[Dict[str, Any]]:
        """
        Parse Harris CSV content and yield raw row dicts.
        Ported from harris_inmate.py._parse_rows() + _looks_like_dataset().

        Harris CSVs have NO column headers — all field access is positional.
        Yields dicts with:
          _cells        : List[str] — raw positional row
          _report_meta  : report metadata dict
          _scraped_at   : ISO timestamp
        """
        scraped_at = _utcnow_iso()
        text = content.decode("utf-8", errors="replace")
        kind = report_meta.get("kind", "bond")

        if not _looks_like_dataset(text, kind):
            print(f"[harris] skipping {report_meta['filename']} — does not look like a dataset")
            return

        rows = _parse_rows(text)
        row_count = 0
        for row in rows:
            if not any(row):
                continue
            yield {
                "_cells":       row,
                "_report_meta": report_meta,
                "_scraped_at":  scraped_at,
            }
            row_count += 1

        print(f"[harris] parsed {row_count} rows from {report_meta['filename']}")

    # ── normalize_record() ───────────────────────────────────────────────────

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Translate one Harris CSV row to the canonical schema.
        Ported from parse_bond/parse_misfel/parse_nafiling in harris_inmate.py.

        Routes by kind:
          bond:     court_group[0], case_number[1], offense[2], court_no[3],
                    last_name[4], first_middle[5], spn[6], race[7], sex[8],
                    bond_amount[9], bond_note[10], addr[11-15], city[16], zip[17]
          misfel:   name[0], dob[1], spn[2], bond_amount[3], bond_note[4],
                    case_date[5], court_group[6], case_number[7], offense[8],
                    addr[9-11], city[12], state[13], zip[14], phone[15]
          nafiling: court_group[0], case_number[1], offense[2], court_no[3],
                    last_name[4], first_middle[5], spn[6], filing_flag[7],
                    aux_flag[8], bond_amount[9], bond_note[10], addr[11-15],
                    city[16], zip[17]
        """
        report_meta = raw.get("_report_meta") or {}
        scraped_at  = raw.get("_scraped_at") or _utcnow_iso()
        kind        = report_meta.get("kind", "bond")
        publish_date = report_meta.get("publish_date")
        group       = report_meta.get("group")

        c = raw.get("_cells", [])

        def _c(i: int) -> Optional[str]:
            v = c[i] if i < len(c) else None
            return v.strip() if v else None

        spn         = None
        case_number = None
        offense     = None
        court_group = None
        court_no    = None
        last_name   = None
        first_name  = None
        full_name   = None
        race_code   = None
        sex_code    = None
        bond_amount: Optional[int] = None
        bond_note   = None
        address     = None
        city        = None
        state_abbr  = None
        zip_code    = None
        phone       = None
        dob         = None
        case_date   = None
        filing_flag = None
        aux_flag    = None
        needs_help  = False
        case_number_parse_warning: Optional[str] = None

        if kind == "bond":
            court_group  = _c(0)
            case_number  = _c(1)
            offense      = _c(2)
            court_no     = _c(3)
            last_name    = _c(4)
            first_middle = _c(5)
            spn          = _c(6)
            race_code    = _c(7)
            sex_code     = _c(8)
            bond_amount  = _to_int(_c(9))
            bond_note    = _c(10)
            address      = _addr_line([_c(i) for i in range(11, 16)])
            city         = _c(16)
            zip_code     = _c(17)
            full_name    = f"{last_name}, {first_middle}" if last_name else None
            first_name   = first_middle
            needs_help   = _needs_bond_help(bond_amount, bond_note)

        elif kind == "misfel":
            raw_name     = _c(0)
            dob          = _parse_yymmdd(_c(1))
            spn          = _c(2)
            bond_amount  = _to_int(_c(3))
            bond_note    = _c(4)
            case_date    = _parse_yymmdd(_c(5))
            court_group  = _c(6)
            _cn7         = _c(7)
            case_number_parse_warning: Optional[str] = None
            if _looks_like_harris_case_number(_cn7):
                # Standard 16-column layout: c[7] = case_number
                case_number  = _cn7
                offense      = _c(8)
                address      = _addr_line([_c(i) for i in range(9, 12)])
                city         = _c(12)
                state_abbr   = _c(13)
                zip_code     = _c(14)
                phone        = _c(15)
            else:
                # Variant 17-column layout: c[7] = court/sequence number,
                # c[8] = real case_number, everything from c[9] onward shifted.
                _cn8 = _c(8)
                case_number  = _cn8 if _looks_like_harris_case_number(_cn8) else None
                case_number_parse_warning = f"c7={_cn7!r};c8={_cn8!r}"
                print(
                    f"[harris] misfel variant layout: c[7]={_cn7!r} is not a valid "
                    f"case number — using c[8]={case_number!r} instead"
                )
                offense      = _c(9)
                address      = _addr_line([_c(i) for i in range(10, 13)])
                city         = _c(13)
                state_abbr   = _c(14)
                zip_code     = _c(15)
                phone        = _c(16)
            full_name    = raw_name
            if raw_name and "," in raw_name:
                parts      = raw_name.split(",", 1)
                last_name  = parts[0].strip()
                first_name = parts[1].strip()
            # Sanity check: bond amounts >= $500k are extremely rare.
            # In the variant 17-column layout, c[3] can be a court-docket / case-number
            # fragment that parses as a large integer. If the layout warning is set and
            # bond_amount is suspiciously large, null it out rather than store garbage.
            if bond_amount is not None and bond_amount >= 500_000 and case_number_parse_warning:
                bond_amount = None
                needs_help = False
            else:
                needs_help = _needs_bond_help(bond_amount, bond_note)

        elif kind == "nafiling":
            court_group  = _c(0)
            case_number  = _c(1)
            offense      = _c(2)
            court_no     = _c(3)
            last_name    = _c(4)
            first_middle = _c(5)
            spn          = _c(6)
            filing_flag  = _c(7)
            aux_flag     = _c(8)
            bond_amount  = _to_int(_c(9))
            bond_note    = _c(10)
            address      = _addr_line([_c(i) for i in range(11, 16)])
            city         = _c(16)
            zip_code     = _c(17)
            full_name    = f"{last_name}, {first_middle}" if last_name else None
            first_name   = first_middle
            needs_help   = _needs_bond_help(bond_amount, bond_note)

        else:
            return None

        if not spn and not case_number:
            return None

        upsert_key: Dict[str, Any] = {
            "county": self.COUNTY,
            "source": self.SOURCE,
            "kind":   kind,
        }
        if case_number:
            upsert_key["case_number"] = case_number
        elif spn:
            upsert_key["spn"]       = spn
            upsert_key["file_date"] = publish_date or ""

        record: Dict[str, Any] = {
            # ── Source ──
            "county":        self.COUNTY,
            "source_system": self.SOURCE,
            "kind":          kind,
            "group":         group,
            # ── Name ──
            "full_name":     full_name,
            "last_name":     last_name,
            "first_name":    first_name,
            # ── Case ──
            "spn":           spn or None,
            "case_number":   case_number or None,
            "offense":       offense or None,
            "court_group":   court_group or None,
            "court_no":      court_no or None,
            "bond_amount":   bond_amount,
            "bond_note":     bond_note or None,
            "needs_bond_help": needs_help,
            # ── Demographics ──
            "race":          race_code,
            "sex":           sex_code,
            "dob":           dob,
            # ── Address ──
            "address":       address,
            "city":          city,
            "state":         state_abbr,
            "zip":           zip_code,
            "phone":         phone,
            # ── Dates ──
            "case_date":     case_date,
            "file_date":     publish_date,
            # ── Timestamps ──
            "scraped_at":    scraped_at,
            "observed_at":   publish_date,
            # ingested_at — set by store_record()
            # ── Extra (nafiling) ──
            "filing_flag":   filing_flag,
            "aux_flag":      aux_flag,
            # ── Parse warnings ──
            **(  {"case_number_parse_warning": case_number_parse_warning}
                 if case_number_parse_warning else {}
              ),
            # ── Routing ──
            "_upsert_key":   upsert_key,
            "_collection":   _COLLECTION_MAP.get(kind, "harris_bond"),
        }

        return record

    # ── store_record() — multi-collection routing ────────────────────────────

    def store_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Route the record to the correct Harris collection based on kind.
        Harris has three collections: harris_bond, harris_misfel, harris_nafiling.
        """
        collection_name = record.pop("_collection", None) or _COLLECTION_MAP.get(
            record.get("kind", "bond"), "harris_bond"
        )

        upsert_key = record.get("_upsert_key")
        if not upsert_key:
            raise ValueError("normalize_record() must set '_upsert_key'")

        from datetime import datetime, timezone
        doc = dict(record)
        doc["ingested_at"] = datetime.now(timezone.utc).isoformat()
        doc.pop("_upsert_key", None)

        res = self.db[collection_name].update_one(
            upsert_key,
            {
                "$set": doc,
                "$setOnInsert": {"first_seen_at": doc["ingested_at"]},
            },
            upsert=True,
        )

        return {
            "inserted":    bool(res.upserted_id),
            "matched":     res.matched_count,
            "modified":    res.modified_count,
            "upsert_key":  upsert_key,
            "collection":  collection_name,
        }


# ── Dry-run entry point ──────────────────────────────────────────────────────
# Usage: python3 -m ingestion.reports.harris_reports --dry-run [--limit N]

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

    ap = argparse.ArgumentParser(description="Harris reports dry-run")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--limit",   type=int, default=2, help="Max reports to process")
    args = ap.parse_args()

    print(f"[harris] dry-run mode — no MongoDB writes — limit={args.limit} reports")
    ingestor = HarrisReportIngestor(_NullDb())

    reports = ingestor.fetch_report_list()
    print(f"[harris] found {len(reports)} reports on datasets page")

    for meta in reports[:args.limit]:
        print(f"\n[harris] downloading: {meta['filename']} ({meta['kind']}, {meta['group']})")
        try:
            content = ingestor.download_report(meta)
        except Exception as exc:
            print(f"  [FAIL] download failed: {exc}")
            continue

        rows = list(ingestor.parse_report(content, meta))
        print(f"  parsed {len(rows)} raw rows")

        sample_ok = sample_fail = 0
        for raw in rows[:5]:
            raw["_report_meta"] = meta
            record = ingestor.normalize_record(raw)
            if record is None:
                sample_fail += 1
                continue
            required = ["county", "source_system", "scraped_at", "kind", "case_number"]
            missing  = [f for f in required if not record.get(f)]
            status   = "WARN missing: " + str(missing) if missing else "OK"
            print(f"  [{status}] {json.dumps({k: v for k, v in record.items() if k not in ('_upsert_key', '_collection')}, default=str, indent=2)}")
            sample_ok += 1
        print(f"  sample: {sample_ok} OK, {sample_fail} skipped")

    sys.exit(0)
