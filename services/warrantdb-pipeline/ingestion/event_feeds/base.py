"""
ingestion/event_feeds/base.py
─────────────────────────────────────────────────────────────────────────────
Base class for real-time / near-real-time event feed scrapers.

An "event feed" source exposes a live stream (or frequently refreshed snapshot)
of booking/arrest events.  Each booking is treated as an **immutable event**:
once recorded it is never overwritten, only supplemented.

Concretely, an EventFeedScraper implementation must:
  1. fetch_events()    — hit the upstream source, return raw rows
  2. normalize_event() — translate a raw row into a canonical EventRecord dict
  3. store_event()     — upsert the event into the target MongoDB collection

The poll() method wires these together and is the single entry point for
the ingestion scheduler.

Timestamp contract (all callers must honour this):
  scraped_at   — UTC ISO datetime when the HTTP response was received
  observed_at  — UTC ISO datetime when the event occurred (booking/arrest time)
                 Set to None / null if not available from source.
  ingested_at  — UTC ISO datetime set by store_event() when written to Mongo.
                 Do NOT set this in normalize_event() — it is always set here.
"""
from __future__ import annotations

import uuid
from abc import abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from ingestion.audited_scraper import AuditedScraper


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return _utcnow().isoformat()


class EventRecord(dict):
    """
    Thin dict subclass that enforces the canonical timestamp fields.
    Behaves exactly like a dict — just a marker type.
    """
    REQUIRED_FIELDS = ("scraped_at", "county", "source")

    def validate(self) -> List[str]:
        """Return a list of missing required fields (empty = valid)."""
        return [f for f in self.REQUIRED_FIELDS if not self.get(f)]


class EventFeedScraper(AuditedScraper):
    """
    Abstract base for event-feed ingestion.

    Subclass responsibilities
    ─────────────────────────
    COLLECTION : str   — name of the raw MongoDB collection to write into
    COUNTY     : str   — lowercase county name used in audit records
    SOURCE     : str   — human-readable source identifier, e.g. "galveston_p2c"
    POLL_INTERVAL_SECONDS : int — suggested polling interval (informational only;
                                  actual scheduling is external)

    Methods to implement
    ────────────────────
    fetch_events()     → Iterable[Dict]        raw rows from upstream source
    normalize_event()  → Optional[EventRecord] canonical dict; None = skip
    """

    # ── Subclass must set these ──────────────────────────────────────────────
    COLLECTION: str = ""
    COUNTY: str = ""
    SOURCE: str = ""
    POLL_INTERVAL_SECONDS: int = 300  # 5 minutes

    def __init__(self, db):
        if not self.COUNTY:
            raise NotImplementedError(f"{type(self).__name__} must define COUNTY")
        super().__init__(db, self.COUNTY)

    # ── Public entry point ───────────────────────────────────────────────────

    def poll(self) -> Iterable[Dict[str, Any]]:
        """
        Fetch → normalize → store pipeline.

        Yields the MongoDB upsert result dict for each event stored.
        Use this as the single entry point from the scheduler / run_ingestion.
        """
        self._audit_emit("started")
        run_scraped_at = _utcnow_iso()
        stored = skipped = errors = 0

        try:
            for raw in self.fetch_events():
                try:
                    raw["_scraped_at"] = run_scraped_at  # pass timing to normalize
                    event = self.normalize_event(raw)
                    if event is None:
                        skipped += 1
                        continue
                    missing = event.validate() if isinstance(event, EventRecord) else []
                    if missing:
                        self._audit_note(f"skip — missing fields: {missing}")
                        skipped += 1
                        continue
                    result = self.store_event(event)
                    stored += 1
                    self._audit_inc("events_yielded")
                    yield result
                except Exception as exc:  # noqa: BLE001
                    errors += 1
                    self._audit_inc("errors")
                    self._audit_note(f"error normalizing/storing event: {exc}")

        finally:
            self._audit_emit("finished", {
                "events_stored": stored,
                "events_skipped": skipped,
                "errors": errors,
            })

    # ── Methods subclasses must implement ───────────────────────────────────

    @abstractmethod
    def fetch_events(self) -> Iterable[Dict[str, Any]]:
        """
        Hit the upstream source and yield raw event dicts.

        Each dict should contain whatever the source provides.
        A `_scraped_at` key (ISO UTC string) is injected by poll() before
        normalize_event() is called — do not set it yourself here.
        """
        raise NotImplementedError

    @abstractmethod
    def normalize_event(self, raw: Dict[str, Any]) -> Optional[EventRecord]:
        """
        Translate one raw event dict into a canonical EventRecord.

        Return None to skip the record (e.g. bad data, navigation noise).

        Canonical timestamp fields:
          scraped_at  — copy from raw["_scraped_at"]
          observed_at — booking/arrest time from source (ISO UTC) or None
          ingested_at — DO NOT set; store_event() sets this at write time

        Deduplication key:
          _upsert_key — dict with all fields that uniquely identify this event
                        e.g. {"county": "galveston", "booking_number": "12345"}
        """
        raise NotImplementedError

    # ── Store helper (can be overridden) ────────────────────────────────────

    def store_event(self, event: EventRecord) -> Dict[str, Any]:
        """
        Upsert *event* into self.COLLECTION using event["_upsert_key"].

        Sets `ingested_at` on every write (both insert and update).
        Returns a summary dict with inserted/modified/matched counts.
        """
        if not self.COLLECTION:
            raise NotImplementedError(f"{type(self).__name__} must define COLLECTION")

        upsert_key = event.get("_upsert_key")
        if not upsert_key:
            raise ValueError(f"normalize_event() must set '_upsert_key'; got: {event}")

        doc = dict(event)
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
            "_id": str(res.upserted_id) if res.upserted_id else None,
            "upsert_key": upsert_key,
        }

    # ── Convenience ─────────────────────────────────────────────────────────

    @staticmethod
    def scraped_at_now() -> str:
        """Return the current UTC time as an ISO string for use in scraped_at."""
        return _utcnow_iso()
