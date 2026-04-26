"""
ingestion/lookups/base.py
─────────────────────────────────────────────────────────────────────────────
Base class for lookup / search-based enrichment scrapers.

IMPORTANT: LookupScraper implementations are ENRICHMENT TOOLS, not primary
ingestion sources.  They require an explicit person identity as input and
return structured results for that specific individual.

They must NOT:
  - Generate name lists internally (no alphabet sweeps, no wordlists)
  - Be scheduled as standalone pipeline sources
  - Attempt to enumerate the full jail population

They SHOULD be called:
  - When the enrichment worker needs additional data for a known inmate
  - From a batch enrichment job that iterates over simple_* records
  - Interactively for a specific subject

Caller contract
───────────────
The caller must provide at minimum a last_name.  Most sources also require or
benefit from a first_name.  Additional hints (dob, booking_number, etc.) may
be passed as keyword arguments and will be used if the source supports them.

search_person() returns a (possibly empty) list of LookupResult dicts.
Each result contains normalized fields and a detail_url if available.
The caller can then call fetch_detail(detail_url) to get full charge/bond data.

Timestamp contract
──────────────────
  scraped_at   — UTC ISO datetime when the search was performed
  observed_at  — booking/event time from source (ISO UTC) or None
  ingested_at  — set by store_record() if the caller chooses to persist results
"""
from __future__ import annotations

from abc import abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from ingestion.audited_scraper import AuditedScraper


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class LookupResult(dict):
    """
    Thin dict subclass representing one normalized result from a lookup search.
    Behaves exactly like a dict — just a marker type for type-checking.

    Expected top-level fields:
      full_name       str | None
      last_name       str | None
      first_name      str | None
      dob             str | None    (ISO date YYYY-MM-DD)
      booking_number  str | None
      booking_date    str | None    (ISO datetime UTC)
      bond_amount     float | None
      charges         list[dict]    (may be empty if not yet fetched)
      detail_url      str | None    (URL for fetch_detail())
      scraped_at      str           (ISO UTC datetime)
      observed_at     str | None    (ISO UTC datetime)
      source          str           (e.g. "brazoria_tyler")
      county          str           (e.g. "brazoria")
      _upsert_key     dict          (unique key for this record in MongoDB)
    """


class LookupScraper(AuditedScraper):
    """
    Abstract base for name/ID-driven enrichment lookups.

    Subclass responsibilities
    ─────────────────────────
    COLLECTION : str  — target raw MongoDB collection (for when results are stored)
    COUNTY     : str  — lowercase county name
    SOURCE     : str  — human-readable source identifier

    Methods to implement
    ────────────────────
    search_person()   — hit the upstream search endpoint, return list of LookupResult
    fetch_detail()    — fetch and parse a detail page for one result
    normalize_record() — translate raw source dict to canonical LookupResult
    """

    COLLECTION: str = ""
    COUNTY: str = ""
    SOURCE: str = ""

    def __init__(self, db):
        if not self.COUNTY:
            raise NotImplementedError(f"{type(self).__name__} must define COUNTY")
        super().__init__(db, self.COUNTY)

    # ── Public entry point ───────────────────────────────────────────────────

    def lookup(
        self,
        last_name: str,
        first_name: str = "",
        *,
        fetch_details: bool = True,
        store: bool = False,
        **kwargs: Any,
    ) -> List[LookupResult]:
        """
        Search for a person and optionally fetch detail pages.

        Parameters
        ──────────
        last_name     — subject's last name (required)
        first_name    — subject's first name (optional but reduces false positives)
        fetch_details — if True, call fetch_detail() on each result to populate charges
        store         — if True, upsert each result into COLLECTION
        **kwargs      — additional hints passed through to search_person()
                        (e.g. dob="1985-03-14", booking_number="B2024-001")

        Returns list of LookupResult dicts (may be empty).
        """
        if not last_name or not last_name.strip():
            raise ValueError("last_name is required for lookup()")

        self._audit_emit("started", {"last_name": last_name, "first_name": first_name})
        results: List[LookupResult] = []

        try:
            raw_results = self.search_person(last_name.strip(), first_name.strip(), **kwargs)

            for raw in raw_results:
                record = self.normalize_record(raw)
                if record is None:
                    self._audit_inc("errors")
                    continue

                if fetch_details and record.get("detail_url"):
                    try:
                        detail_raw = self.fetch_detail(record["detail_url"])
                        record = self._merge_detail(record, detail_raw)
                    except Exception as exc:  # noqa: BLE001
                        self._audit_note(f"detail fetch failed for {record.get('detail_url')}: {exc}")

                if store:
                    self.store_record(record)

                results.append(record)
                self._audit_inc("events_yielded")

        finally:
            self._audit_emit("finished", {
                "results_returned": len(results),
                "last_name": last_name,
                "first_name": first_name,
            })

        return results

    # ── Methods subclasses must implement ───────────────────────────────────

    @abstractmethod
    def search_person(
        self,
        last_name: str,
        first_name: str = "",
        **kwargs: Any,
    ) -> List[Dict[str, Any]]:
        """
        Hit the upstream search endpoint and return a list of raw result dicts.

        last_name  — required
        first_name — optional
        **kwargs   — optional hints (dob, booking_number, etc.)

        Each returned dict contains whatever the source provides in its list view.
        These dicts are passed to normalize_record() one at a time.
        """
        raise NotImplementedError

    @abstractmethod
    def fetch_detail(self, detail_url: str) -> Dict[str, Any]:
        """
        Fetch and parse the detail page for one search result.

        Returns a raw dict of additional fields from the detail page
        (charges, bond amounts, housing unit, etc.).
        This dict is merged into the LookupResult by _merge_detail().
        """
        raise NotImplementedError

    @abstractmethod
    def normalize_record(self, raw: Dict[str, Any]) -> Optional[LookupResult]:
        """
        Translate one raw result dict (from search_person() or fetch_detail())
        into a canonical LookupResult.

        Return None to skip the record.

        Must set these fields:
          scraped_at    — _utcnow_iso()
          county        — self.COUNTY.lower()
          source        — self.SOURCE
          _upsert_key   — stable dict key for MongoDB upsert

        Do NOT set ingested_at — store_record() sets this.
        """
        raise NotImplementedError

    # ── Optional override ────────────────────────────────────────────────────

    def _merge_detail(
        self, base: LookupResult, detail: Dict[str, Any]
    ) -> LookupResult:
        """
        Merge detail page fields into a base LookupResult.

        Default: shallow-merge detail into base (detail fields win on conflict,
        except for _upsert_key, scraped_at, county, source which are preserved).
        Subclasses may override for more nuanced merge logic.
        """
        preserved = {k: base[k] for k in ("_upsert_key", "scraped_at", "county", "source") if k in base}
        merged = LookupResult({**base, **detail, **preserved})
        if detail.get("detail_fetched_at"):
            merged["detail_fetched_at"] = detail["detail_fetched_at"]
        return merged

    # ── Store helper (can be overridden) ────────────────────────────────────

    def store_record(self, record: LookupResult) -> Dict[str, Any]:
        """
        Upsert record into self.COLLECTION.  Callers opt-in via store=True in lookup().
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
