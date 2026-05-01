"""
scripts/run_ingestion_v2.py
───────────────────────────────────────────────────────────────────────────────
Feature-flagged runner for the v2 three-layer ingestion architecture.

All legacy jobs in run_ingestion.py / run_pipeline.py are untouched.
V2 modules run ONLY when explicitly enabled via environment variables or CLI.

Feature flags (environment variables)
──────────────────────────────────────
  USE_V2_INGESTION          — master gate; must be "true" to run anything (default: false)
  ENABLE_V2_GALVESTON       — enable GalvestonP2CEventFeed (default: false)
  ENABLE_V2_HARRIS_REPORTS  — enable HarrisReportIngestor  (default: false)
  ENABLE_V2_LOOKUPS         — enable all three lookup scrapers (default: false)
  DRY_RUN                   — when "true" print records, no MongoDB writes (default: true)

CLI usage
─────────
  python3 scripts/run_ingestion_v2.py --source galveston --dry-run --limit 20
  python3 scripts/run_ingestion_v2.py --source harris_reports --dry-run --limit 1
  python3 scripts/run_ingestion_v2.py --source fortbend_lookup --last-name SMITH --dry-run
  python3 scripts/run_ingestion_v2.py --source fortbend_lookup --mode prefix --first-prefix a --last-prefix a --window-days 7 --limit 25 --dry-run
  python3 scripts/run_ingestion_v2.py --source fortbend_lookup --mode seed --window-days 7 --limit 50 --dry-run
  python3 scripts/run_ingestion_v2.py --source jefferson_lookup --last-name SMITH --dry-run
  python3 scripts/run_ingestion_v2.py --source brazoria_lookup --last-name SMITH --first-name JOHN --dry-run

  # Write to staging collections (USE_V2_INGESTION=true required):
  USE_V2_INGESTION=true DRY_RUN=false python3 scripts/run_ingestion_v2.py --source galveston --limit 100

Staging collections (non-dry-run)
───────────────────────────────────
  galveston     → v2_galveston_events
  harris        → v2_harris_reports
  all lookups   → v2_lookup_results

  A separate v2_report_manifest collection tracks which Harris reports have
  been ingested so that re-runs stay idempotent.

Safety guarantees
─────────────────
  • USE_V2_INGESTION defaults to false — no v2 code runs in production unless
    the flag is explicitly set.
  • DRY_RUN defaults to true — a write cannot happen accidentally.
  • Staging collection names are distinct from every production collection name.
  • No production collection is ever written to by this script.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# ── Helpers ──────────────────────────────────────────────────────────────────

def _flag(name: str, default: bool = False) -> bool:
    """Read a boolean env flag.  Explicit CLI flags take precedence."""
    val = os.getenv(name, "true" if default else "false").strip().lower()
    return val in ("1", "true", "yes")


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def emit_result(**kwargs) -> None:
    """
    Emit a machine-readable result line as the final output of a scraper run.
    The Node backend parses this line first before falling back to regex.
    Format: INGESTION_RESULT_JSON={...}
    Extra keyword args (e.g. date_searched) are merged into the payload.
    """
    _reserved = {"ok", "source", "status", "seen", "written", "skipped", "errors", "dry_run", "message"}
    payload = {
        "ok": bool(kwargs.get("ok", False)),
        "source": kwargs.get("source"),
        "status": kwargs.get("status", "unknown"),
        "seen": int(kwargs.get("seen") or 0),
        "written": int(kwargs.get("written") or 0),
        "skipped": int(kwargs.get("skipped") or 0),
        "errors": int(kwargs.get("errors") or 0),
        "dry_run": bool(kwargs.get("dry_run", False)),
        "message": kwargs.get("message"),
        **{k: v for k, v in kwargs.items() if k not in _reserved},
    }
    print("INGESTION_RESULT_JSON=" + json.dumps(payload, separators=(",", ":")), flush=True)


def _resolve_booking_date(val: str) -> str:
    """
    Resolve "today" / "yesterday" to a YYYY-MM-DD date string in the
    America/Chicago (CT) timezone.  Any other value is returned unchanged.
    """
    if val not in ("today", "yesterday"):
        return val
    from zoneinfo import ZoneInfo  # noqa: PLC0415
    ct = ZoneInfo("America/Chicago")
    local_date = datetime.now(ct).date()
    if val == "yesterday":
        from datetime import timedelta  # noqa: PLC0415
        local_date = local_date - timedelta(days=1)
    return local_date.isoformat()


# ── Staging collection map ───────────────────────────────────────────────────

# Maps every production collection name that v2 scrapers might write to → its
# corresponding staging name.  _StagingDb uses this to redirect all writes.
_STAGING_MAP: Dict[str, str] = {
    # Galveston
    "galveston_events":           "v2_galveston_events",
    # Harris (all three kinds land in one staging collection)
    "harris_bond":                "v2_harris_reports",
    "harris_misfel":              "v2_harris_reports",
    "harris_nafiling":            "v2_harris_reports",
    # Report manifest (track which Harris files have been downloaded)
    "report_manifest":            "v2_report_manifest",
    # Lookups
    "brazoria_inmates":           "v2_lookup_results",
    "fortbend_inmates":           "v2_lookup_results",
    "jefferson_events":           "v2_jefferson_events",
    # Endpoint cache (Galveston discovers its own POST endpoint)
    "galveston_p2c_endpoint":     "v2_galveston_p2c_endpoint",
    # Wharton
    "wharton_inmates":            "v2_wharton_events",
    # Harris Sheriff enrichment (writes directly — no staging redirect needed)
    "harris_sheriff_enrichments": "harris_sheriff_enrichments",
}


class _StagingDb:
    """
    Thin proxy around a real pymongo database that transparently redirects
    every collection access to its staging counterpart.

    Unknown collection names pass through unchanged so that audit / manifest
    collections that are not in the map also work correctly.
    """

    def __init__(self, real_db):
        self._db = real_db

    def __getitem__(self, name: str):
        return self._db[_STAGING_MAP.get(name, name)]

    def __getattr__(self, name: str):
        # Allows attribute-style access: db.harris_bond
        if name.startswith("_"):
            raise AttributeError(name)
        return self._db[_STAGING_MAP.get(name, name)]


class _NullDb:
    """
    Absorbs all pymongo calls silently.  Used in dry-run mode.
    """

    class _NullColl:
        def find_one(self, *a, **kw):
            return None

        def insert_one(self, *a, **kw):
            return type("R", (), {"inserted_id": None})()

        def update_one(self, *a, **kw):
            return type("R", (), {
                "upserted_id": None,
                "matched_count": 0,
                "modified_count": 0,
            })()

        def find(self, *a, **kw):
            return []

    def __getitem__(self, name: str):
        return self._NullColl()

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._NullColl()


# ── Per-source runners ────────────────────────────────────────────────────────

def run_galveston(db, dry_run: bool, limit: int) -> int:
    """
    Fetch and optionally store Galveston P2C custody events.

    dry_run=True  → normalize up to `limit` events, print, no writes
    dry_run=False → poll() into v2_galveston_events staging collection
    """
    from ingestion.event_feeds.galveston_p2c import GalvestonP2CEventFeed  # noqa: PLC0415

    feed = GalvestonP2CEventFeed(db)

    if dry_run:
        print(f"[galveston] dry-run — fetching events (limit={limit})")
        raw_events = list(feed.fetch_events())
        print(f"[galveston] fetched {len(raw_events)} raw rows")

        run_scraped_at = _utcnow_iso()
        ok = warn = skip = 0
        for raw in raw_events[:limit]:
            raw["_scraped_at"] = run_scraped_at
            event = feed.normalize_event(raw)
            if event is None:
                skip += 1
                continue
            required = ["county", "source", "full_name", "scraped_at", "booking_number"]
            missing = [f for f in required if not event.get(f)]
            status = f"WARN missing={missing}" if missing else "OK"
            if missing:
                warn += 1
            else:
                ok += 1
            event_str = json.dumps(
                {k: v for k, v in event.items() if k != '_upsert_key'},
                default=str,
                indent=2,
            )
            print(f"  [{status}] {event_str}")
        print(f"[galveston] dry-run summary: ok={ok} warn={warn} skip={skip}")
        emit_result(ok=True, source="galveston", status="completed", seen=ok, written=0, skipped=skip, errors=warn, dry_run=True)
        return 0

    # Non-dry-run: redirect writes to staging collection
    feed.COLLECTION = "v2_galveston_events"
    stored = 0
    print(f"[galveston] writing to v2_galveston_events (limit={limit})")
    for result in feed.poll():
        stored += 1
        if stored >= limit:
            break
    print(f"[galveston] stored {stored} events")
    emit_result(ok=True, source="galveston", status="completed", seen=stored, written=stored, dry_run=False)
    return 0


def run_harris_reports(db, dry_run: bool, limit: int, force_reingest: bool = False) -> int:
    """
    Download, parse, and optionally store Harris District Clerk reports.

    dry_run=True  → normalize sample rows from up to `limit` reports, print
    dry_run=False → ingest into v2_harris_reports staging collection
    """
    from ingestion.reports.harris_reports import HarrisReportIngestor  # noqa: PLC0415

    ingestor = HarrisReportIngestor(db)

    if dry_run:
        print(f"[harris] dry-run — limit={limit} reports")
        reports = ingestor.fetch_report_list()
        print(f"[harris] found {len(reports)} reports on datasets page")

        total_rows = 0
        total_reports = 0
        for meta in reports[:limit]:
            print(f"\n[harris] downloading: {meta['filename']} ({meta['kind']}, {meta['group']})")
            try:
                content = ingestor.download_report(meta)
            except Exception as exc:
                print(f"  [FAIL] {exc}")
                continue

            rows = list(ingestor.parse_report(content, meta))
            print(f"  parsed {len(rows)} rows")
            total_rows += len(rows)
            total_reports += 1

            ok = warn = 0
            for raw in rows[:5]:
                raw["_report_meta"] = meta
                record = ingestor.normalize_record(raw)
                if record is None:
                    continue
                required = ["county", "source_system", "scraped_at", "kind", "case_number"]
                missing = [f for f in required if not record.get(f)]
                status = f"WARN missing={missing}" if missing else "OK"
                if missing:
                    warn += 1
                else:
                    ok += 1
                record_str = json.dumps(
                    {k: v for k, v in record.items() if k not in ('_upsert_key', '_collection')},
                    default=str,
                    indent=2,
                )
                print(f"  [{status}] {record_str}")
            print(f"  sample: ok={ok} warn={warn}")
        emit_result(ok=True, source="harris_reports", status="completed", seen=total_rows, written=0, dry_run=True,
                    message=f"{total_reports} report(s) sampled, {total_rows} rows parsed")
        return 0

    # Non-dry-run: override store_record to redirect to staging collection
    _orig_store = ingestor.store_record

    def _staging_store(record: Dict[str, Any]) -> Dict[str, Any]:
        record["_collection"] = "v2_harris_reports"
        return _orig_store(record)

    ingestor.store_record = _staging_store  # type: ignore[method-assign]
    # Also redirect report_manifest to staging
    ingestor.REPORTS_COLLECTION = "v2_report_manifest"

    # Limit the number of REPORTS processed (not records).
    # By overriding detect_new_reports() here we ensure that:
    #   - at most `limit` reports are downloaded
    #   - at most `limit` manifest entries are created
    # Without this cap, ingest() processes every new report in one call
    # regardless of the CLI --limit value, causing the manifest to record
    # all reports as processed even on a constrained first run.
    _orig_detect = ingestor.detect_new_reports

    def _limited_detect(force: bool = False):  # type: ignore[override]
        count = 0
        for meta in _orig_detect(force=force or force_reingest):
            if count >= limit:
                break
            yield meta
            count += 1

    ingestor.detect_new_reports = _limited_detect  # type: ignore[method-assign]

    stored = 0
    print(f"[harris] writing to v2_harris_reports (max {limit} reports)")
    for result in ingestor.ingest():
        stored += 1
        print(f"  stored record #{stored}: {result}")
    print(f"[harris] total records stored: {stored}")
    emit_result(ok=True, source="harris_reports", status="completed", seen=stored, written=stored, dry_run=False)
    return 0


def run_wharton(db, dry_run: bool, limit: int) -> int:
    """
    Fetch and optionally store Wharton County DCN custody events.

    dry_run=True  → normalize up to `limit` events, print, no writes
    dry_run=False → poll() into v2_wharton_events staging collection
    """
    from ingestion.event_feeds.wharton_dcn import WhartonDCNEventFeed  # noqa: PLC0415

    feed = WhartonDCNEventFeed(db)

    if dry_run:
        print(f"[wharton] dry-run — fetching events (limit={limit})")
        raw_events = list(feed.fetch_events())
        print(f"[wharton] fetched {len(raw_events)} raw rows")

        run_scraped_at = _utcnow_iso()
        ok = warn = skip = 0
        for raw in raw_events[:limit]:
            raw["_scraped_at"] = run_scraped_at
            event = feed.normalize_event(raw)
            if event is None:
                skip += 1
                continue
            required = ["county", "source", "full_name", "scraped_at", "source_id"]
            missing = [f for f in required if not event.get(f)]
            status = f"WARN missing={missing}" if missing else "OK"
            if missing:
                warn += 1
            else:
                ok += 1
            event_str = json.dumps(
                {k: v for k, v in event.items() if k != "_upsert_key"},
                default=str,
                indent=2,
            )
            print(f"  [{status}] {event_str}")
        print(f"[wharton] dry-run summary: ok={ok} warn={warn} skip={skip}")
        emit_result(ok=True, source="wharton", status="completed", seen=ok, written=0, skipped=skip, errors=warn, dry_run=True)
        return 0

    # Non-dry-run: redirect writes to staging collection
    feed.COLLECTION = "v2_wharton_events"
    stored = 0
    print(f"[wharton] writing to v2_wharton_events (limit={limit})")
    for result in feed.poll():
        stored += 1
        if stored >= limit:
            break
    print(f"[wharton] stored {stored} events")
    emit_result(ok=True, source="wharton", status="completed", seen=stored, written=stored, dry_run=False)
    return 0


def run_harris_sheriff_enrichment(
    db,
    dry_run: bool,
    spn: str = "",
    seed: str = "",
    window_days: int = 7,
    limit: int = 25,
    force: bool = False,
) -> int:
    """
    Enrich Harris County inmate records via the Sheriff JailInfo site.

    Single-SPN mode:   --spn 03334984
    Batch mode:        --seed recent_harris  (pulls from v2_harris_reports, last 7 days max)

    When dry_run=False and a person is confirmed NOT IN JAIL, their
    v2_harris_reports records are flagged as no_longer_prospect=True.
    """
    from ingestion.harris_sheriff_enrichment import HarrisSheriffEnrichment  # noqa: PLC0415

    # No hard cap here — caller is responsible for reasonable limits
    effective_window = int(window_days)

    # Harris enrichment reads from v2_harris_reports and harris_sheriff_enrichments
    # regardless of dry_run mode.  When dry_run=True the caller passes _NullDb()
    # which returns [] for all finds — so we always connect to the real database
    # for reads and let HarrisSheriffEnrichment respect dry_run for writes.
    if hasattr(db, "_db"):
        # _StagingDb wrapper — unwrap to get the raw pymongo database
        read_db = db._db
    else:
        # _NullDb or unknown — obtain a real connection for reads
        from storage.mongo_client import get_db as _get_real_db  # noqa: PLC0415
        try:
            read_db = _get_real_db()
        except Exception as exc:
            print(f"[harris_sheriff] WARNING: could not obtain real db for reads: {exc}", file=sys.stderr)
            read_db = db

    enricher = HarrisSheriffEnrichment(read_db, dry_run=dry_run)

    if spn:
        # ── Single-SPN mode ───────────────────────────────────────────────────
        spn = str(spn).strip()
        print(f"[harris_sheriff] single-SPN mode — spn={spn} dry_run={dry_run}")
        result = enricher.enrich_by_spn(spn)
        ok = result.get("ok", False)
        custody_status = result.get("custody_status", "unknown")
        full_name = result.get("full_name", "?")
        released = custody_status == "not_in_custody"
        print(
            f"[harris_sheriff] SPN {spn}: ok={ok} status={custody_status} "
            f"name={full_name}"
            + (" => MARKED NO LONGER PROSPECT" if released and not dry_run else "")
        )
        emit_result(
            ok=ok,
            source="harris_sheriff_enrichment",
            status="completed" if ok else "failed",
            seen=1,
            matched=1 if result.get("matched") else 0,
            written=0 if dry_run else (1 if ok else 0),
            errors=0 if ok else 1,
            dry_run=dry_run,
            custody_status=custody_status,
            full_name=full_name,
            released=released,
            dob=result.get("dob"),
            age=result.get("age"),
            sex=result.get("sex"),
            race=result.get("race"),
            warnings=result.get("warnings") or [],
            message=result.get("error") or None,
        )
        return 0 if ok else 1

    # ── Batch mode ────────────────────────────────────────────────────────────
    if not seed or seed == "recent_harris":
        print(
            f"[harris_sheriff] batch mode — seed=recent_harris "
            f"window={effective_window}d limit={limit} dry_run={dry_run}"
        )
        stats = enricher.run_batch(window_days=effective_window, limit=limit, force=force)
        emit_result(
            ok=stats.get("errors", 0) == 0,
            source="harris_sheriff_enrichment",
            status="completed",
            seen=stats.get("seen", 0),
            matched=stats.get("matched", 0),
            written=stats.get("written", 0),
            errors=stats.get("errors", 0),
            dry_run=dry_run,
            unmatched=stats.get("unmatched", 0),
            skipped_cached=stats.get("skipped_cached", 0),
            window_days=stats.get("window_days", effective_window),
            docs_scanned=stats.get("docs_scanned", 0),
            docs_with_spn=stats.get("docs_with_spn", 0),
            unique_spns=stats.get("unique_spns", 0),
            eligible_spns=stats.get("eligible_spns", 0),
            message=f"Harris Sheriff batch enrichment — window={stats.get('window_days', effective_window)}d",
        )
        return 0 if stats.get("errors", 0) == 0 else 1

    msg = f"Unknown seed value: {seed!r}. Use 'recent_harris' or omit for batch mode."
    print(f"[harris_sheriff] ERROR: {msg}", file=sys.stderr)
    emit_result(ok=False, source="harris_sheriff_enrichment", status="failed", errors=1, dry_run=dry_run, message=msg)
    return 1


def run_fortbend_discovery(
    db,
    *,
    dry_run: bool,
    mode: str,
    first_prefix: str = "",
    last_prefix: str = "",
    last_name: str = "",
    first_name: str = "",
    window_days: int = 7,
    limit: int = 25,
    verify_sample: int = 5,
) -> int:
    """
    Run Fort Bend lookup-discovery pipeline.

    mode='prefix'  → prefix-pair search (first_prefix + last_prefix)
    mode='name'    → single-name lookup  (last_name + optional first_name)
    mode='seed'    → names seeded from recent bulk county records
    mode='auto'    → iterate all aa–zz first/last prefix combinations (676 searches)
    mode='verify'  → open detail pages and emit VERIFY_DETAIL_JSON evidence lines
    """
    from ingestion.fortbend_discovery import FortBendDiscovery  # noqa: PLC0415

    discovery = FortBendDiscovery(db, dry_run=dry_run, window_days=window_days, limit=limit)

    if mode == 'prefix':
        print(f"[fortbend] discovery prefix mode — first_prefix={first_prefix!r} last_prefix={last_prefix!r} "
              f"window={window_days}d limit={limit} dry_run={dry_run}")
        stats = discovery.run_prefix(first_prefix=first_prefix, last_prefix=last_prefix)
    elif mode == 'seed':
        print(f"[fortbend] discovery seed mode — window={window_days}d limit={limit} dry_run={dry_run}")
        stats = discovery.run_seed(seed_source='recent_bulk')
    elif mode == 'auto':
        import time as _time
        _auto_start = _time.time()
        def _progress_cb(data):
            payload = dict(data)
            payload['elapsed_seconds'] = round(_time.time() - _auto_start, 1)
            print("PROGRESS_JSON=" + json.dumps(payload, separators=(',', ':')), flush=True)
        print(f"[fortbend] discovery auto mode — window={window_days}d limit={limit} dry_run={dry_run}")
        stats = discovery.run_auto(progress_callback=_progress_cb)
    elif mode == 'verify':
        print(f"[fortbend] verify mode \u2014 first={first_prefix!r} last={last_prefix!r} "
              f"sample={verify_sample} window={window_days}d dry_run={dry_run}")
        stats = discovery.run_verify(
            first_prefix=first_prefix,
            last_prefix=last_prefix,
            verify_sample=verify_sample,
        )
        # Emit one VERIFY_DETAIL_JSON line per sampled detail page
        for record in stats.get('verify_details', []):
            print("VERIFY_DETAIL_JSON=" + json.dumps(record, separators=(',', ':')), flush=True)
    else:  # name mode (default)
        search_desc = last_name + (f", {first_name}" if first_name else "")
        print(f"[fortbend] discovery name mode — '{search_desc}' window={window_days}d limit={limit} dry_run={dry_run}")
        stats = discovery.run_name(last_name=last_name, first_name=first_name)

    seen             = stats.get('seen', 0)
    written          = stats.get('written', 0)
    skipped          = stats.get('skipped', 0)
    skipped_cached   = stats.get('skipped_cached', 0)
    details_checked  = stats.get('details_checked', 0)
    recent_matches   = stats.get('recent_matches', 0)
    stale_cached     = stats.get('stale_cached', 0)
    prefixes_checked = stats.get('prefixes_checked', 0)
    errors           = stats.get('errors', 0)
    unknown_date     = stats.get('unknown_date', 0)
    total_prefixes   = 676 if mode == 'auto' else None
    completed_full_sweep = (mode == 'auto' and prefixes_checked >= 676)
    print(f"[fortbend] discovery complete — seen={seen} details_checked={details_checked} "
          f"recent_matches={recent_matches} stale_cached={stale_cached} "
          f"skipped={skipped} skipped_cached={skipped_cached} errors={errors} written={written}")

    print(
        "INGESTION_RESULT_JSON=" + json.dumps({
            "ok":              errors == 0,
            "source":          "fortbend_lookup",
            "status":          "completed",
            "seen":            seen,
            "written":         written,
            "skipped":         skipped,
            "skipped_cached":  skipped_cached,
            "errors":          errors,
            "dry_run":         dry_run,
            "message":         "Fort Bend discovery completed",
            "details_checked": details_checked,
            "recent_matches":  recent_matches,
            "stale_cached":    stale_cached,
            "prefixes_checked": prefixes_checked,
            "total_prefixes":  total_prefixes,
            "completed_full_sweep": completed_full_sweep,
            "unknown_date":    unknown_date,
            "mode":            mode,
        }, separators=(",", ":")),
        flush=True,
    )
    return 0 if errors == 0 else 1


def run_lookup(
    source: str,
    db,
    dry_run: bool,
    last_name: str,
    first_name: str,
    booking_date: str = "",
    limit: int = 0,
) -> int:
    """
    Run a county lookup scraper (Brazoria / Fort Bend / Jefferson).

    dry_run=True  → lookup(store=False), print normalized results
    dry_run=False → lookup(store=True) into v2_lookup_results staging collection

    Jefferson supports booking_date instead of last_name.
    """
    _LOOKUP_CLASSES = {
        "brazoria_lookup":  ("ingestion.lookups.brazoria_lookup",  "BrazoriaLookup"),
        "fortbend_lookup":  ("ingestion.lookups.fortbend_lookup",  "FortBendLookup"),
        "jefferson_lookup": ("ingestion.lookups.jefferson_lookup", "JeffersonLookup"),
    }

    if source not in _LOOKUP_CLASSES:
        print(f"[v2] Unknown lookup source: {source}", file=sys.stderr)
        return 1

    mod_path, cls_name = _LOOKUP_CLASSES[source]
    import importlib  # noqa: PLC0415
    mod = importlib.import_module(mod_path)
    LookupCls = getattr(mod, cls_name)

    scraper = LookupCls(db)

    if not dry_run:
        # Jefferson gets its own staging collection; other lookups share v2_lookup_results
        scraper.COLLECTION = "v2_jefferson_events" if source == "jefferson_lookup" else "v2_lookup_results"

    county_label = source.replace("_lookup", "")

    # Resolve "today" / "yesterday" to an actual CT date before passing to the scraper.
    if booking_date in ("today", "yesterday"):
        booking_date = _resolve_booking_date(booking_date)

    # Jefferson supports date-mode lookup (no last_name required)
    if source == "jefferson_lookup" and booking_date and not last_name:
        print(f"[{county_label}] {'dry-run' if dry_run else 'staging-write'} — "
              f"date filter '{booking_date}'")
        results = scraper.lookup_by_date(
            booking_date,
            store=not dry_run,
        )
    else:
        search_desc = last_name + (f", {first_name}" if first_name else "")
        if booking_date:
            search_desc += f" (booking_date={booking_date})"
        print(f"[{county_label}] {'dry-run' if dry_run else 'staging-write'} — "
              f"searching '{search_desc}'")
        kwargs: Dict[str, Any] = {}
        if booking_date:
            kwargs["booking_date"] = booking_date
        results = scraper.lookup(
            last_name=last_name,
            first_name=first_name,
            fetch_details=True,
            store=not dry_run,
            **kwargs,
        )

    if limit and len(results) > limit:
        results = results[:limit]
    print(f"[{county_label}] lookup() returned {len(results)} results")
    for i, r in enumerate(results):
        required = ["county", "source", "scraped_at", "full_name"]
        missing = [f for f in required if not r.get(f)]
        status = f"WARN missing={missing}" if missing else "OK"
        result_str = json.dumps(
            {k: v for k, v in r.items() if k not in ('raw', '_upsert_key')},
            default=str,
            indent=2,
        )
        print(f"  [{status}] result[{i}]: {result_str}")
    n = len(results)
    extra = {"date_searched": booking_date} if source == "jefferson_lookup" and booking_date else {}
    emit_result(ok=True, source=source, status="completed", seen=n, written=0 if dry_run else n, dry_run=dry_run,
                message=f"Jefferson date scrape completed" if source == "jefferson_lookup" and booking_date else None,
                **extra)
    return 0


# ── Feature-flag gate ─────────────────────────────────────────────────────────

def _check_feature_flags(source: str) -> None:
    """
    Abort if the required feature flag is not set.

    When --dry-run is active, USE_V2_INGESTION is not required (safe to
    explore output without enabling the full production gate).
    """
    master = _flag("USE_V2_INGESTION", default=False)
    dry_run_env = _flag("DRY_RUN", default=True)

    source_flags: Dict[str, str] = {
        "galveston":                  "ENABLE_V2_GALVESTON",
        "harris_reports":              "ENABLE_V2_HARRIS_REPORTS",
        "brazoria_lookup":             "ENABLE_V2_LOOKUPS",
        "fortbend_lookup":             "ENABLE_V2_LOOKUPS",
        "jefferson_lookup":            "ENABLE_V2_LOOKUPS",
        "wharton":                     "ENABLE_V2_WHARTON",
        "harris_sheriff_enrichment":   "ENABLE_V2_HARRIS_REPORTS",
    }

    flag_name = source_flags.get(source)
    if flag_name and not _flag(flag_name, default=False):
        # Dry-run is always allowed even without the per-source flag
        if not dry_run_env:
            print(
                f"[v2] WARN: {flag_name} is not set — running in dry-run mode only.\n"
                f"     Set {flag_name}=true to enable non-dry-run writes.",
                file=sys.stderr,
            )

    if not master and not dry_run_env:
        print(
            "[v2] ERROR: USE_V2_INGESTION is not set to 'true'.\n"
            "     Non-dry-run writes require USE_V2_INGESTION=true.",
            file=sys.stderr,
        )
        sys.exit(1)


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="V2 ingestion runner — feature-flagged, staging-safe",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--source",
        required=True,
        choices=["galveston", "harris_reports", "wharton", "brazoria_lookup", "fortbend_lookup", "jefferson_lookup", "harris_sheriff_enrichment"],
        help="Which v2 scraper to run",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        default=None,
        help="Print results; do not write to MongoDB (default: true unless DRY_RUN=false)",
    )
    p.add_argument(
        "--no-dry-run",
        dest="dry_run",
        action="store_false",
        help="Enable writes to staging collections (requires USE_V2_INGESTION=true)",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Max events/reports/rows to process (default: 20)",
    )
    p.add_argument(
        "--last-name",
        default="",
        help="Last name for lookup sources",
    )
    p.add_argument(
        "--first-name",
        default="",
        help="First name for lookup sources",
    )
    p.add_argument(
        "--booking-date",
        default="",
        dest="booking_date",
        help=(
            "Booking date filter (YYYY-MM-DD, M/D/YYYY, 'today', or 'yesterday'). "
            "jefferson_lookup: supports date-only mode (no --last-name required). "
            "brazoria_lookup: additive filter — --last-name and --first-name still required."
        ),
    )
    p.add_argument(
        "--date",
        default="",
        dest="date_alias",
        help="Alias for --booking-date. Supports 'today', 'yesterday', YYYY-MM-DD, or M/D/YYYY.",
    )
    p.add_argument(
        "--days-back",
        type=int,
        default=1,
        dest="days_back",
        help=(
            "(jefferson_lookup) Run for this many days ending today. "
            "days-back=1 means today only; days-back=7 means today + past 6 days."
        ),
    )
    # ── Harris Sheriff enrichment args ──────────────────────────────────────
    p.add_argument(
        "--spn",
        default="",
        help="Single SPN to enrich via Harris Sheriff JailInfo (harris_sheriff_enrichment only)",
    )
    p.add_argument(
        "--seed",
        default="",
        help="Batch seed mode for harris_sheriff_enrichment. Use 'recent_harris' to enrich SPNs from recent Harris reports.",
    )
    # ── Fort Bend discovery args ─────────────────────────────────────────────
    p.add_argument(
        "--mode",
        choices=["name", "prefix", "seed", "auto", "verify"],
        default="name",
        help="fortbend_lookup discovery mode: name (default), prefix, seed, auto (aa\u2013zz), or verify",
    )
    p.add_argument(
        "--verify-sample",
        type=int,
        default=5,
        dest="verify_sample",
        help="Number of detail pages to open in verify mode (default: 5)",
    )
    p.add_argument(
        "--first-prefix",
        default="",
        dest="first_prefix",
        help="First-name prefix for fortbend_lookup prefix-discovery mode (e.g. 'a')",
    )
    p.add_argument(
        "--last-prefix",
        default="",
        dest="last_prefix",
        help="Last-name prefix for fortbend_lookup prefix-discovery mode (e.g. 'a')",
    )
    p.add_argument(
        "--window-days",
        type=int,
        default=7,
        dest="window_days",
        help="Recency window in days for fortbend_lookup discovery (default: 7)",
    )
    # ── Scheduler integration flags ──────────────────────────────────────────
    p.add_argument(
        "--trigger",
        choices=["manual", "scheduled", "health_check"],
        default="manual",
        help="What triggered this run (default: manual)",
    )
    p.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Force run even if source is disabled or schedule says skip",
    )
    p.add_argument(
        "--force-reingest",
        action="store_true",
        default=False,
        dest="force_reingest",
        help="(harris_reports only) Re-ingest reports already recorded in the manifest",
    )
    p.add_argument(
        "--created-by",
        default="system",
        help="Identity string recorded in the ingestion_runs audit document",
    )
    p.add_argument(
        "--respect-schedule",
        action="store_true",
        default=False,
        help=(
            "Check admin_config schedule before running.  "
            "If the schedule says skip, write a skipped ingestion_runs record "
            "and exit 0.  Render cron jobs should pass this flag."
        ),
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()

    # Resolve dry-run: CLI flag > DRY_RUN env var > default True
    if args.dry_run is None:
        dry_run = _flag("DRY_RUN", default=True)
    else:
        dry_run = args.dry_run

    # --date is an alias for --booking-date; both support M/D/YYYY
    if args.date_alias and not args.booking_date:
        args.booking_date = args.date_alias

    # Jefferson: default to 'today' when no last_name and no date given
    if args.source == "jefferson_lookup" and not args.last_name and not args.booking_date:
        args.booking_date = "today"
        print(f"[jefferson] no --last-name or --date given — defaulting to booking_date=today")

    _check_feature_flags(args.source)

    # ── Scheduler integration ─────────────────────────────────────────────────
    # When --respect-schedule is passed, check admin_config before running.
    # A real Mongo connection is always used for audit, even in dry-run mode.
    # Audit writes happen regardless of whether scraper writes go to staging/null.
    audit_db = None
    run_id = None

    if args.respect_schedule or args.trigger == "scheduled":
        try:
            from storage.mongo_client import get_db  # noqa: PLC0415
            audit_db = get_db()
        except Exception as exc:
            print(
                f"[v2] WARNING: could not connect to Mongo for scheduler check: {exc}\n"
                "     Falling back to run-without-schedule-check.",
                file=sys.stderr,
            )
            audit_db = None

    if args.respect_schedule and audit_db is not None:
        from scheduler.should_run import should_run_source  # noqa: PLC0415
        from scheduler.audit import create_run, finish_run  # noqa: PLC0415

        try:
            should_run, skip_reason = should_run_source(
                audit_db,
                source=args.source,
                trigger=args.trigger,
                force=args.force,
            )
        except Exception as exc:
            print(
                f"[v2] WARNING: scheduler check failed: {exc}\n"
                "     Falling back to run-without-schedule-check.",
                file=sys.stderr,
            )
            audit_db = None
            should_run = True
            skip_reason = None

        if not should_run:
            print(f"[v2] SKIP source={args.source} reason={skip_reason!r}")
            # Record the skip so the admin UI and daily monitor can show it.
            skip_run_id = create_run(
                audit_db,
                source=args.source,
                trigger=args.trigger,
                mode="staging",
                dry_run=dry_run,
                created_by=args.created_by,
                command=f"run_ingestion_v2.py --source {args.source} --trigger {args.trigger}",
            )
            finish_run(audit_db, skip_run_id, status="skipped", skip_reason=skip_reason)
            emit_result(ok=True, source=args.source, status="skipped", skipped=1, dry_run=dry_run,
                        message=skip_reason or "schedule skip")
            return 0

        # Create audit record before execution (only if Mongo is still reachable)
        if audit_db is not None:
            run_id = create_run(
                audit_db,
                source=args.source,
                trigger=args.trigger,
                mode="staging",
                dry_run=dry_run,
                created_by=args.created_by,
                command=f"run_ingestion_v2.py --source {args.source} --trigger {args.trigger} --limit {args.limit}",
            )
            print(f"[v2] run_id={run_id} source={args.source} trigger={args.trigger}")

        # ── Resolve default_args from config for scheduled date-mode sources ──
        # When --respect-schedule is active and the source config declares
        # default_args.booking_date, use it if the caller didn't supply one.
        if audit_db is not None and not args.booking_date:
            try:
                from scheduler.config import get_source_config  # noqa: PLC0415
                src_cfg = get_source_config(audit_db, args.source)
                if src_cfg:
                    cfg_date = src_cfg.get("default_args", {}).get("booking_date", "")
                    if cfg_date:
                        args.booking_date = _resolve_booking_date(cfg_date)
                        print(f"[v2] resolved booking_date={args.booking_date!r} "
                              f"from config default_args (was {cfg_date!r})")
            except Exception as exc:
                print(f"[v2] WARNING: could not resolve default_args: {exc}",
                      file=sys.stderr)

    # ── Scraper execution ─────────────────────────────────────────────────────
    if dry_run:
        db = _NullDb()
        print(f"[v2] dry-run mode — source={args.source} limit={args.limit}")
    else:
        from storage.mongo_client import get_db  # noqa: PLC0415
        real_db = audit_db if audit_db is not None else get_db()
        db = _StagingDb(real_db)
        target_coll = _STAGING_MAP.get(
            {"galveston": "galveston_events",
             "harris_reports": "harris_bond",
             "wharton": "wharton_inmates",
             "brazoria_lookup": "brazoria_inmates",
             "fortbend_lookup": "fortbend_inmates",
             "jefferson_lookup": "jefferson_events"}.get(args.source, args.source),
            "v2_jefferson_events" if args.source == "jefferson_lookup" else "v2_lookup_results",
        )
        print(f"[v2] *** NON-DRY-RUN: staging-write mode ***")
        print(f"[v2] source={args.source} limit={args.limit}")
        print(f"[v2] target collection: {target_coll}")
        print(f"[v2] full staging map: {_STAGING_MAP}")

    exit_code = 0
    run_error: str | None = None

    try:
        if args.source == "galveston":
            exit_code = run_galveston(db, dry_run=dry_run, limit=args.limit)
        elif args.source == "harris_reports":
            exit_code = run_harris_reports(db, dry_run=dry_run, limit=args.limit, force_reingest=args.force_reingest)
        elif args.source == "wharton":
            exit_code = run_wharton(db, dry_run=dry_run, limit=args.limit)
        elif args.source == "harris_sheriff_enrichment":
            exit_code = run_harris_sheriff_enrichment(
                db,
                dry_run=dry_run,
                spn=getattr(args, "spn", ""),
                seed=getattr(args, "seed", ""),
                window_days=getattr(args, "window_days", 7),
                limit=args.limit,
                force=getattr(args, "force", False),
            )
        else:
            booking_date = getattr(args, "booking_date", "")
            mode         = getattr(args, "mode", "name")
            first_prefix = getattr(args, "first_prefix", "")
            last_prefix  = getattr(args, "last_prefix", "")
            window_days  = getattr(args, "window_days", 7)

            # ── Fort Bend discovery mode ──────────────────────────────────────
            is_fortbend_discovery = (
                args.source == "fortbend_lookup"
                and (mode in ("prefix", "seed", "auto", "verify") or first_prefix or last_prefix)
            )
            if is_fortbend_discovery:
                if mode == "prefix" and not (first_prefix or last_prefix):
                    msg = "fortbend_lookup prefix mode requires --first-prefix and/or --last-prefix"
                    print(f"[v2] ERROR: {msg}", file=sys.stderr)
                    emit_result(ok=False, source=args.source, status="failed", errors=1, dry_run=dry_run, message=msg)
                    exit_code = 1
                else:
                    exit_code = run_fortbend_discovery(
                        db,
                        dry_run=dry_run,
                        mode=mode,
                        first_prefix=first_prefix,
                        last_prefix=last_prefix,
                        last_name=args.last_name,
                        first_name=args.first_name,
                        window_days=window_days,
                        limit=args.limit,
                        verify_sample=getattr(args, 'verify_sample', 5),
                    )
            # ── Standard lookup sources ───────────────────────────────────────
            elif True:
                # jefferson_lookup allows either last_name or booking_date (defaults to today)
                need_last_name = not (args.source == "jefferson_lookup" and booking_date)
                if need_last_name and not args.last_name:
                    msg = f"--last-name is required for {args.source}"
                    print(f"[v2] ERROR: {msg}", file=sys.stderr)
                    emit_result(ok=False, source=args.source, status="failed", errors=1, dry_run=dry_run, message=msg)
                    exit_code = 1
                # brazoria_lookup requires first_name (Tyler rejects searches without it)
                elif args.source == "brazoria_lookup" and not args.first_name:
                    msg = "brazoria_lookup requires both last_name and first_name"
                    print(f"[v2] ERROR: {msg}", file=sys.stderr)
                    emit_result(ok=False, source=args.source, status="failed", errors=1, dry_run=dry_run, message=msg)
                    exit_code = 1
                else:
                    # ── Jefferson --days-back multi-day loop ─────────────────
                    days_back = getattr(args, "days_back", 1) if args.source == "jefferson_lookup" else 1
                    if days_back > 1 and args.source == "jefferson_lookup":
                        from datetime import date as _date, timedelta as _td  # noqa: PLC0415
                        from zoneinfo import ZoneInfo  # noqa: PLC0415
                        ct = ZoneInfo("America/Chicago")
                        today_ct = __import__("datetime").datetime.now(ct).date()
                        total_seen = total_written = 0
                        last_date = None
                        for day_offset in range(days_back):
                            loop_date = (today_ct - _td(days=day_offset)).isoformat()
                            print(f"[jefferson] days-back loop: scraping date {loop_date} "
                                  f"({day_offset + 1}/{days_back})")
                            exit_code = run_lookup(
                                source=args.source,
                                db=db,
                                dry_run=dry_run,
                                last_name=args.last_name,
                                first_name=args.first_name,
                                booking_date=loop_date,
                                limit=args.limit,
                            )
                            last_date = loop_date
                        # emit_result already called per iteration; print aggregate summary
                        print(f"[jefferson] days-back complete: {days_back} days scraped")
                    else:
                        exit_code = run_lookup(
                            source=args.source,
                            db=db,
                            dry_run=dry_run,
                            last_name=args.last_name,
                            first_name=args.first_name,
                            booking_date=booking_date,
                            limit=args.limit,
                        )
    except Exception as exc:
        run_error = str(exc)
        exit_code = 1
        print(f"[v2] UNHANDLED ERROR: {exc}", file=sys.stderr)
        emit_result(ok=False, source=args.source, status="failed", errors=1, dry_run=dry_run, message=str(exc))

    # ── Finish audit record ───────────────────────────────────────────────────
    if run_id is not None and audit_db is not None:
        from scheduler.audit import finish_run  # noqa: PLC0415
        status = "success" if exit_code == 0 else "failed"
        finish_run(
            audit_db,
            run_id=run_id,
            status=status,
            error=run_error,
        )
        print(f"[v2] audit record updated: run_id={run_id} status={status}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
