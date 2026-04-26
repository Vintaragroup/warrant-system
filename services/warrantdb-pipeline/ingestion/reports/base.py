"""
ingestion/reports/base.py
─────────────────────────────────────────────────────────────────────────────
Base class for report / batch ingestion.

A "report ingestor" consumes structured reports published by a county on a
fixed schedule: JIMS PDFs, CSV exports, XLSX data dumps, etc.

Pipeline contract
─────────────────
  fetch_report_list()   — query the source for available reports, return metadata
  detect_new_reports()  — filter the list to only unprocessed reports
  download_report()     — fetch the binary content of one report
  parse_report()        — yield raw record dicts from the binary content
  normalize_record()    — translate one raw record to canonical schema
  store_record()        — upsert the record into MongoDB

The ingest() method wires these together and is the single entry point.

Idempotency
───────────
Re-running against the same report must not create duplicates.  Every
implementation must define an _upsert_key that uniquely identifies a record
within the report (e.g. SPN + file_date, or case_number + kind).

Report tracking
───────────────
Downloaded reports are registered in self.REPORTS_COLLECTION so that
detect_new_reports() can skip already-processed reports across runs.

Timestamp contract
──────────────────
  scraped_at   — UTC ISO datetime when the report was downloaded
  observed_at  — effective date of the report (publish date / file_date) or None
  ingested_at  — UTC ISO datetime set by store_record() at write time
"""
from __future__ import annotations

import hashlib
from abc import abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from ingestion.audited_scraper import AuditedScraper


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()[:16]


class ReportIngestor(AuditedScraper):
    """
    Abstract base for report / batch ingestion.

    Subclass responsibilities
    ─────────────────────────
    COLLECTION         : str  — target raw MongoDB collection
    REPORTS_COLLECTION : str  — collection that tracks processed report metadata
    COUNTY             : str  — lowercase county name
    SOURCE             : str  — human-readable source identifier

    Methods to implement
    ────────────────────
    fetch_report_list()  → List[Dict]           available report metadata dicts
    detect_new_reports() → Iterable[Dict]       only unprocessed reports
    download_report()    → bytes                binary content
    parse_report()       → Iterable[Dict]       raw record dicts from content
    normalize_record()   → Optional[Dict]       canonical record or None to skip
    """

    COLLECTION: str = ""
    REPORTS_COLLECTION: str = "report_manifest"
    COUNTY: str = ""
    SOURCE: str = ""

    def __init__(self, db):
        if not self.COUNTY:
            raise NotImplementedError(f"{type(self).__name__} must define COUNTY")
        super().__init__(db, self.COUNTY)

    # ── Public entry point ───────────────────────────────────────────────────

    def ingest(self) -> Iterable[Dict[str, Any]]:
        """
        Full pipeline: detect new reports → download → parse → normalize → store.

        Yields the upsert result dict for each record stored.
        """
        self._audit_emit("started")
        reports_processed = records_stored = records_skipped = errors = 0

        try:
            for report_meta in self.detect_new_reports():
                report_scraped_at = _utcnow_iso()
                try:
                    content = self.download_report(report_meta)
                    self._mark_report_downloaded(report_meta, report_scraped_at)
                    reports_processed += 1
                except Exception as exc:  # noqa: BLE001
                    errors += 1
                    self._audit_note(f"download failed for {report_meta}: {exc}")
                    continue

                for raw in self.parse_report(content, report_meta):
                    try:
                        raw["_scraped_at"] = report_scraped_at
                        raw["_report_meta"] = report_meta
                        record = self.normalize_record(raw)
                        if record is None:
                            records_skipped += 1
                            continue
                        result = self.store_record(record)
                        records_stored += 1
                        self._audit_inc("events_yielded")
                        yield result
                    except Exception as exc:  # noqa: BLE001
                        errors += 1
                        self._audit_inc("errors")
                        self._audit_note(f"error normalizing record: {exc}")

                self._mark_report_ingested(report_meta)

        finally:
            self._audit_emit("finished", {
                "reports_processed": reports_processed,
                "records_stored": records_stored,
                "records_skipped": records_skipped,
                "errors": errors,
            })

    # ── Methods subclasses must implement ───────────────────────────────────

    @abstractmethod
    def fetch_report_list(self) -> List[Dict[str, Any]]:
        """
        Query the upstream source for available reports.

        Return a list of report metadata dicts.  Each dict should include at
        minimum a stable identifier that can be used to deduplicate across runs.
        Recommended fields: url, filename, publish_date, report_kind.
        """
        raise NotImplementedError

    @abstractmethod
    def detect_new_reports(self) -> Iterable[Dict[str, Any]]:
        """
        Filter fetch_report_list() to only unprocessed reports.

        Default implementation can compare against REPORTS_COLLECTION.
        Subclasses may override with source-specific change detection
        (e.g. file size, ETag, Last-Modified header, date in filename).
        """
        raise NotImplementedError

    @abstractmethod
    def download_report(self, report_meta: Dict[str, Any]) -> bytes:
        """
        Download the binary content for one report.

        Should raise on HTTP errors so ingest() can catch and continue.
        """
        raise NotImplementedError

    @abstractmethod
    def parse_report(
        self, content: bytes, report_meta: Dict[str, Any]
    ) -> Iterable[Dict[str, Any]]:
        """
        Parse report binary content and yield raw record dicts.

        content     — raw bytes (CSV, XLSX, PDF, etc.)
        report_meta — the metadata dict returned by fetch_report_list()
        """
        raise NotImplementedError

    @abstractmethod
    def normalize_record(self, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Translate one raw record dict to the canonical simple_* schema.

        Return None to skip the record (bad data, header row, etc.).
        Must set _upsert_key as a dict of fields that uniquely identify the record.

        Timestamp fields:
          scraped_at   — copy from raw["_scraped_at"]
          observed_at  — effective report date (from _report_meta) or None
          ingested_at  — DO NOT set; store_record() sets this
        """
        raise NotImplementedError

    # ── Store helper (can be overridden) ────────────────────────────────────

    def store_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upsert record into self.COLLECTION using record["_upsert_key"].
        Sets ingested_at at write time.
        """
        if not self.COLLECTION:
            raise NotImplementedError(f"{type(self).__name__} must define COLLECTION")

        upsert_key = record.get("_upsert_key")
        if not upsert_key:
            raise ValueError("normalize_record() must set '_upsert_key'")

        doc = dict(record)
        doc["ingested_at"] = _utcnow_iso()
        doc.pop("_upsert_key", None)

        res = self.db[self.COLLECTION].update_one(
            upsert_key,
            {
                "$set": doc,
                "$setOnInsert": {"first_seen_at": doc["ingested_at"]},
            },
            upsert=True,
        )

        return {
            "inserted": bool(res.upserted_id),
            "matched": res.matched_count,
            "modified": res.modified_count,
            "upsert_key": upsert_key,
        }

    # ── Report manifest helpers ──────────────────────────────────────────────

    def _is_report_processed(self, report_meta: Dict[str, Any]) -> bool:
        """Return True if this report has already been fully ingested."""
        key = self._report_key(report_meta)
        doc = self.db[self.REPORTS_COLLECTION].find_one(
            {"source": self.SOURCE, **key}
        )
        return bool(doc and doc.get("ingested_at"))

    def _mark_report_downloaded(
        self, report_meta: Dict[str, Any], scraped_at: str
    ) -> None:
        key = self._report_key(report_meta)
        self.db[self.REPORTS_COLLECTION].update_one(
            {"source": self.SOURCE, **key},
            {"$set": {"downloaded_at": scraped_at, "meta": report_meta}},
            upsert=True,
        )

    def _mark_report_ingested(self, report_meta: Dict[str, Any]) -> None:
        key = self._report_key(report_meta)
        self.db[self.REPORTS_COLLECTION].update_one(
            {"source": self.SOURCE, **key},
            {"$set": {"ingested_at": _utcnow_iso()}},
            upsert=True,
        )

    @staticmethod
    def _report_key(report_meta: Dict[str, Any]) -> Dict[str, Any]:
        """Derive a stable MongoDB filter key from report metadata."""
        if "url" in report_meta:
            return {"url": report_meta["url"]}
        if "filename" in report_meta:
            return {"filename": report_meta["filename"]}
        return {"meta_hash": hashlib.sha256(str(sorted(report_meta.items())).encode()).hexdigest()[:16]}
