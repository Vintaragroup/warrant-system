"""
ingestion/fortbend_discovery.py
────────────────────────────────────────────────────────────────────────────
Fort Bend lookup-discovery pipeline.

Wraps FortBendLookup (ingestion/lookups/fortbend_lookup.py) with:
  - prefix-pair discovery mode  (first_prefix + last_prefix)
  - single-name lookup mode     (last_name [+ first_name])
  - seed-from-recent-bulk mode  (names pulled from galveston/harris/wharton)

Recency window
──────────────
  Default: 7 days.
  Records with booking_date within window → written to v2_fortbend_events.
  Records outside window or unknown date  → upserted into fortbend_seen_profiles.

Stale cache (fortbend_seen_profiles)
─────────────────────────────────────
  Before opening a detail page the cache is consulted.
  Strong/medium identity records are skipped when recheck_after > now.
  Weak (name-only) identities are always rechecked.

Identity confidence
───────────────────
  booking_number + jail_id → strong
  booking_number           → strong
  jail_id / inmate_id      → strong
  full_name + dob          → medium
  full_name only           → weak
"""
from __future__ import annotations

import hashlib
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _utcnow_iso() -> str:
    return _utcnow().isoformat()


def _normalize_name(name: Optional[str]) -> str:
    if not name:
        return ''
    return re.sub(r'\s+', '_', name.upper().strip())


def _build_identity_key(
    booking_number: Optional[str],
    jail_id: Optional[str],
    full_name: Optional[str],
    dob: Optional[str],
) -> Tuple[str, str]:
    """Return (identity_key, confidence_level)."""
    bn = (booking_number or '').strip() or None
    ji = (jail_id or '').strip() or None
    fn = _normalize_name(full_name) or None

    if bn and ji:
        return f"booking:{bn}|jail:{ji}", "strong"
    if bn:
        return f"booking:{bn}", "strong"
    if ji:
        return f"jail:{ji}", "strong"
    if fn and dob:
        return f"name:{fn}|dob:{dob}", "medium"
    if fn:
        return f"name:{fn}", "weak"
    h = hashlib.sha1((full_name or '').encode()).hexdigest()[:8]
    return f"unknown:{h}", "weak"


def _parse_iso_date(s: Optional[str]) -> Optional[datetime]:
    """Parse ISO date string into a UTC-aware datetime."""
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace('Z', '+00:00'))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


def _recheck_delta(confidence: str) -> timedelta:
    if confidence == 'strong':
        return timedelta(days=14)
    if confidence == 'medium':
        return timedelta(days=7)
    return timedelta(hours=48)  # weak


def _should_skip_cached(profile: Optional[Dict], now: datetime) -> bool:
    """Return True only when a strong/medium cached profile says recheck_after > now."""
    if not profile:
        return False
    confidence = profile.get('identity_confidence', 'weak')
    if confidence not in ('strong', 'medium'):
        return False  # always recheck weak identities
    recheck_after = profile.get('recheck_after')
    if not recheck_after:
        return False
    if isinstance(recheck_after, str):
        recheck_after = _parse_iso_date(recheck_after)
    if recheck_after is None:
        return False
    if hasattr(recheck_after, 'tzinfo') and recheck_after.tzinfo is None:
        recheck_after = recheck_after.replace(tzinfo=timezone.utc)
    return recheck_after > now


# ── FortBendDiscovery ─────────────────────────────────────────────────────────

class FortBendDiscovery:
    """
    Fort Bend lookup-discovery pipeline.

    Parameters
    ──────────
    db          — real or null MongoDB database handle
    dry_run     — if True, no writes to MongoDB (but detail pages are still fetched)
    window_days — recency window in days (default 7)
    limit       — max search-result rows to process (0 = unlimited)
    """

    EVENTS_COLLECTION   = 'v2_fortbend_events'
    PROFILES_COLLECTION = 'fortbend_seen_profiles'

    def __init__(self, db, *, dry_run: bool = True, window_days: int = 7, limit: int = 25):
        self.db          = db
        self.dry_run     = dry_run
        self.window_days = window_days
        self.limit       = limit

    # ── Public run methods ────────────────────────────────────────────────────

    def run_auto(self, progress_callback=None) -> Dict[str, Any]:
        """
        Automated aa–zz prefix discovery.

        Iterates every combination of first_prefix × last_prefix from a–z,
        submitting 676 searches total.  The stale cache prevents re-processing
        records seen within the recheck window.

        Stops early if self.limit rows have been processed (0 = no limit).
        """
        from ingestion.lookups.fortbend_lookup import FortBendLookup  # noqa: PLC0415
        scraper = FortBendLookup(self.db)
        alphabet = 'abcdefghijklmnopqrstuvwxyz'

        aggregate: Dict[str, Any] = {
            'prefixes_checked': 0,
            'seen':             0,
            'skipped_cached':   0,
            'details_checked':  0,
            'recent_matches':   0,
            'stale_cached':     0,
            'skipped':          0,
            'errors':           0,
            'written':          0,
        }
        total_rows = 0

        for first_p in alphabet:
            for last_p in alphabet:
                aggregate['prefixes_checked'] += 1
                rows = scraper.search_person(last_name=last_p, first_name=first_p)
                if rows:
                    stats = self._process_rows(rows, scraper, already_limited=True)
                    for k in ('seen', 'skipped_cached', 'details_checked',
                              'recent_matches', 'stale_cached', 'skipped', 'errors', 'written'):
                        aggregate[k] += stats.get(k, 0)
                    total_rows += stats.get('seen', 0)

                if progress_callback is not None:
                    try:
                        current_prefix = f"{first_p}{last_p}".upper()
                        progress_callback({
                            'current_prefix': current_prefix,
                            'prefixes_total': 676,
                            **aggregate,
                        })
                    except Exception:
                        pass

                if self.limit and total_rows >= self.limit:
                    print(f"[fortbend_discovery] auto mode — limit {self.limit} rows reached, stopping")
                    break
            if self.limit and total_rows >= self.limit:
                break

        return aggregate

    def run_prefix(self, first_prefix: str, last_prefix: str) -> Dict[str, Any]:
        """Search using a prefix pair (e.g. first_prefix='a', last_prefix='a')."""
        from ingestion.lookups.fortbend_lookup import FortBendLookup  # noqa: PLC0415
        scraper = FortBendLookup(self.db)
        rows = scraper.search_person(
            last_name=last_prefix.strip(),
            first_name=first_prefix.strip(),
        )
        return self._process_rows(rows, scraper)

    def run_verify(
        self,
        first_prefix: str,
        last_prefix: str,
        verify_sample: int = 5,
    ) -> Dict[str, Any]:
        """
        Verification mode: search with a prefix pair, open up to *verify_sample*
        detail pages, and return evidence records for each page.

        Emits no DB writes — always operates in dry-run evidence-gathering mode.
        Returns a stats dict that includes a ``verify_details`` list.
        """
        from ingestion.lookups.fortbend_lookup import FortBendLookup  # noqa: PLC0415
        scraper = FortBendLookup(self.db)
        rows = scraper.search_person(
            last_name=last_prefix.strip(),
            first_name=first_prefix.strip(),
        )

        now          = _utcnow()
        window_start = now - timedelta(days=self.window_days)

        stats: Dict[str, Any] = {
            'seen':            len(rows),
            'details_checked': 0,
            'recent_matches':  0,
            'stale_cached':    0,
            'unknown_date':    0,
            'skipped':         0,
            'skipped_cached':  0,
            'errors':          0,
            'written':         0,
            'verify_details':  [],
        }

        sample_rows = rows[:verify_sample] if verify_sample else rows
        cache_coll  = self.db[self.PROFILES_COLLECTION]

        for i, row in enumerate(sample_rows):
            detail_url = row.get('detail_url')
            if not detail_url:
                stats['skipped'] += 1
                continue

            # Build preliminary identity from search-row fields
            jail_id_raw = (row.get('id') or '').strip() or None
            last  = (row.get('last_name')  or '').strip().upper() or None
            first = (row.get('first_name') or '').strip().upper() or None
            full_name_row = (f"{last}, {first}" if last and first else last) or ''

            prelim_key, prelim_conf = _build_identity_key(
                row.get('booking_number'), jail_id_raw, full_name_row, row.get('dob'),
            )

            # Check stale cache (read-only)
            cached = None
            try:
                cached = cache_coll.find_one({'identity_key': prelim_key})
            except Exception:
                pass
            is_skip_cached = _should_skip_cached(cached, now)

            stats['details_checked'] += 1
            parse_warnings: List[str] = []

            try:
                detail = scraper.fetch_detail(detail_url)
            except Exception as exc:
                stats['errors'] += 1
                stats['verify_details'].append({
                    'index':               i + 1,
                    'search_first':        first_prefix,
                    'search_last':         last_prefix,
                    'full_name':           full_name_row,
                    'detail_url':          detail_url,
                    'identity_key':        prelim_key,
                    'identity_confidence': prelim_conf,
                    'booking_date':        None,
                    'booking_date_source': 'fetch_error',
                    'raw_booking_date_text': None,
                    'within_window':       None,
                    'window_days':         self.window_days,
                    'decision':            'error',
                    'charges_count':       0,
                    'bond_count':          0,
                    'first_charge':        None,
                    'first_bond_amount':   None,
                    'parse_warnings':      [f'detail fetch error: {exc}'],
                })
                continue

            # Merge detail with search-row
            booking_number   = (detail.get('booking_number') or row.get('booking_number') or '').strip() or None
            booking_date_str = detail.get('booking_date') or row.get('booking_date')
            full_name_detail = detail.get('full_name') or full_name_row
            dob_detail       = detail.get('dob') or row.get('dob')

            identity_key, identity_conf = _build_identity_key(
                booking_number, jail_id_raw, full_name_detail, dob_detail,
            )

            # Booking-date evidence
            if booking_date_str:
                booking_date_source = 'detail_page'
            else:
                booking_date_source = 'not_found'
                parse_warnings.append(
                    'booking date not found — Fort Bend portal does not expose booking date'
                )

            booking_dt = _parse_iso_date(booking_date_str)

            if is_skip_cached:
                decision      = 'would_skip_cached'
                within_window = None
                stats['skipped_cached'] += 1
            elif booking_dt is None:
                # No date: treat as current roster (active inmate) → would write
                decision      = 'would_write_event'
                within_window = None
                stats['unknown_date']   += 1
                stats['recent_matches'] += 1
            elif booking_dt >= window_start:
                decision      = 'would_write_event'
                within_window = True
                stats['recent_matches'] += 1
            else:
                decision      = 'would_cache_stale'
                within_window = False
                stats['stale_cached']   += 1

            # Charges / bond evidence
            charges         = detail.get('charges') or []
            charges_count   = len(charges)
            bond_amounts    = [c.get('bond_amount') for c in charges if c.get('bond_amount')]
            bond_count      = len(bond_amounts)
            first_charge    = None
            if charges:
                first_charge = (
                    charges[0].get('offense')
                    or charges[0].get('charge')
                    or charges[0].get('description')
                )
            first_bond_amount = bond_amounts[0] if bond_amounts else detail.get('bond_amount')

            stats['verify_details'].append({
                'index':               i + 1,
                'search_first':        first_prefix,
                'search_last':         last_prefix,
                'full_name':           full_name_detail or full_name_row,
                'detail_url':          detail_url,
                'identity_key':        identity_key,
                'identity_confidence': identity_conf,
                'booking_date':        booking_date_str,
                'booking_date_source': booking_date_source,
                'raw_booking_date_text': None,
                'within_window':       within_window,
                'window_days':         self.window_days,
                'decision':            decision,
                'charges_count':       charges_count,
                'bond_count':          bond_count,
                'first_charge':        first_charge,
                'first_bond_amount':   first_bond_amount,
                'parse_warnings':      parse_warnings,
            })

        return stats

    def run_name(self, last_name: str, first_name: str = '') -> Dict[str, Any]:
        """Search using an explicit last_name [+ first_name]."""
        from ingestion.lookups.fortbend_lookup import FortBendLookup  # noqa: PLC0415
        scraper = FortBendLookup(self.db)
        rows = scraper.search_person(last_name=last_name, first_name=first_name)
        return self._process_rows(rows, scraper)

    def run_seed(self, seed_source: str = 'recent_bulk') -> Dict[str, Any]:
        """Seed names from recent bulk county records and search for each."""
        names = self._collect_seed_names(seed_source)
        print(f"[fortbend_discovery] seed mode — {len(names)} unique name(s) from '{seed_source}'")

        from ingestion.lookups.fortbend_lookup import FortBendLookup  # noqa: PLC0415
        scraper = FortBendLookup(self.db)

        all_rows: List[Dict] = []
        seen_searches: set = set()

        for last, first in names:
            key = (last.upper(), (first or '').upper())
            if key in seen_searches:
                continue
            seen_searches.add(key)
            rows = scraper.search_person(last_name=last, first_name=first or '')
            all_rows.extend(rows)
            if self.limit and len(all_rows) >= self.limit:
                all_rows = all_rows[: self.limit]
                break

        return self._process_rows(all_rows, scraper, already_limited=True)

    # ── Core processing ───────────────────────────────────────────────────────

    def _process_rows(
        self,
        rows: List[Dict[str, Any]],
        scraper: Any,
        *,
        already_limited: bool = False,
    ) -> Dict[str, Any]:
        if self.limit and not already_limited and len(rows) > self.limit:
            rows = rows[: self.limit]

        now          = _utcnow()
        window_start = now - timedelta(days=self.window_days)

        stats: Dict[str, Any] = {
            'seen':            len(rows),
            'details_checked': 0,
            'recent_matches':  0,
            'stale_cached':    0,
            'skipped':         0,   # rows with no detail_url
            'skipped_cached':  0,   # rows skipped due to active stale cache
            'errors':          0,
            'written':         0,
        }

        # For dry-run the NullDb returns None for find_one (safe).
        cache_coll  = self.db[self.PROFILES_COLLECTION]
        events_coll = self.db[self.EVENTS_COLLECTION]

        for row in rows:
            detail_url = row.get('detail_url')
            if not detail_url:
                stats['skipped'] += 1
                continue

            # ── Preliminary identity from search-row ─────────────────────────
            jail_id_raw = (row.get('id') or '').strip() or None
            last  = (row.get('last_name')  or '').strip().upper() or None
            first = (row.get('first_name') or '').strip().upper() or None
            full_name_row: Optional[str] = None
            if last and first:
                full_name_row = f"{last}, {first}"
            elif last:
                full_name_row = last

            prelim_key, prelim_conf = _build_identity_key(
                row.get('booking_number'),
                jail_id_raw,
                full_name_row,
                row.get('dob'),
            )

            # ── Stale cache check ────────────────────────────────────────────
            cached = None
            try:
                cached = cache_coll.find_one({'identity_key': prelim_key})
            except Exception:
                pass  # NullDb returns None

            if _should_skip_cached(cached, now):
                stats['skipped_cached'] += 1
                if not self.dry_run:
                    try:
                        cache_coll.update_one(
                            {'identity_key': prelim_key},
                            {'$set': {'last_checked_at': now.isoformat()}},
                        )
                    except Exception:
                        pass
                continue

            # ── Fetch detail page ────────────────────────────────────────────
            stats['details_checked'] += 1
            try:
                detail = scraper.fetch_detail(detail_url)
            except Exception as exc:
                print(f"[fortbend_discovery] detail fetch error ({detail_url}): {exc}")
                stats['errors'] += 1
                continue

            # ── Merge detail with search-row data ────────────────────────────
            booking_number   = (detail.get('booking_number') or row.get('booking_number') or '').strip() or None
            booking_date_str = detail.get('booking_date') or row.get('booking_date')
            full_name_detail = detail.get('full_name') or full_name_row
            dob_detail       = detail.get('dob') or row.get('dob')
            jail_id          = jail_id_raw

            identity_key, identity_conf = _build_identity_key(
                booking_number, jail_id, full_name_detail, dob_detail,
            )
            detail_hash = hashlib.sha1(detail_url.encode()).hexdigest()[:16]

            # Derive name parts for event/profile docs
            fn_detail = detail.get('first_name') or first
            ln_detail = detail.get('last_name')  or last
            mn_detail = detail.get('middle_name')

            # ── Recency check ────────────────────────────────────────────────
            # Fort Bend does NOT expose booking_date on any page (search results
            # or detail pages).  booking_date_str will always be None here.
            #
            # Logic:
            #   - booking_dt is None (no date available)  → treat as CURRENT roster
            #                                               → write event
            #   - booking_dt within window                → write event
            #   - booking_dt before window start          → stale (cache only)
            booking_dt = _parse_iso_date(booking_date_str)
            is_stale_by_date = booking_dt is not None and booking_dt < window_start

            if not is_stale_by_date:
                # ── Current / recent record (or date unknown): write event ───
                stats['recent_matches'] += 1
                event_doc: Dict[str, Any] = {
                    'source':              'fortbend_lookup',
                    'county':              'fortbend',
                    'full_name':           full_name_detail,
                    'first_name':          fn_detail,
                    'middle_name':         mn_detail,
                    'last_name':           ln_detail,
                    'booking_date':        booking_date_str,
                    'dob':                 dob_detail,
                    'race':                detail.get('race'),
                    'sex':                 detail.get('sex'),
                    'booking_number':      booking_number,
                    'jail_id':             jail_id,
                    'agency':              detail.get('agency'),
                    'charges':             detail.get('charges') or [],
                    'bond_amount':         detail.get('bond_amount'),
                    'detail_url':          detail_url,
                    'detail_url_hash':     detail_hash,
                    'identity_key':        identity_key,
                    'identity_confidence': identity_conf,
                    'scraped_at':          now.isoformat(),
                    'raw':                 detail,
                }
                if not self.dry_run:
                    try:
                        events_coll.update_one(
                            {'identity_key': identity_key},
                            {
                                '$set': event_doc,
                                '$setOnInsert': {'created_at': now.isoformat()},
                            },
                            upsert=True,
                        )
                        stats['written'] += 1
                        # Upsert stale cache with recheck_after so we don't
                        # re-process this person within the current window.
                        try:
                            cache_coll.update_one(
                                {'identity_key': identity_key},
                                {
                                    '$set': {
                                        'source':              'fortbend_lookup',
                                        'county':              'fortbend',
                                        'full_name':           full_name_detail,
                                        'booking_number':      booking_number,
                                        'jail_id':             jail_id,
                                        'identity_key':        identity_key,
                                        'identity_confidence': identity_conf,
                                        'last_checked_at':     now.isoformat(),
                                        'stale_reason':        'recently_written',
                                        'recheck_after':       (now + timedelta(days=self.window_days)).isoformat(),
                                        'active_event_written': True,
                                    },
                                    '$setOnInsert': {'first_seen_at': now.isoformat()},
                                },
                                upsert=True,
                            )
                        except Exception:
                            pass
                    except Exception as exc:
                        print(f"[fortbend_discovery] event write error: {exc}")
                        stats['errors'] += 1
                else:
                    print(
                        f"[fortbend_discovery] [dry-run] would write event: "
                        f"{full_name_detail} booking={booking_date_str}"
                    )

            else:
                # ── Stale by booking_date: cache only, no event ──────────────
                stats['stale_cached'] += 1
                stale_reason   = 'outside_window'
                recheck_delta  = _recheck_delta(identity_conf)
                recheck_after  = (now + recheck_delta).isoformat()

                profile_doc: Dict[str, Any] = {
                    'source':              'fortbend_lookup',
                    'county':              'fortbend',
                    'full_name':           full_name_detail,
                    'first_name':          fn_detail,
                    'middle_name':         mn_detail,
                    'last_name':           ln_detail,
                    'booking_number':      booking_number,
                    'jail_id':             jail_id,
                    'dob':                 dob_detail,
                    'identity_key':        identity_key,
                    'identity_confidence': identity_conf,
                    'last_booking_date_seen': booking_date_str,
                    'last_detail_url':     detail_url,
                    'detail_url_hash':     detail_hash,
                    'last_checked_at':     now.isoformat(),
                    'stale_reason':        stale_reason,
                    'recheck_after':       recheck_after,
                    'active_event_written': False,
                }
                if not self.dry_run:
                    try:
                        cache_coll.update_one(
                            {'identity_key': identity_key},
                            {
                                '$set': profile_doc,
                                '$setOnInsert': {'first_seen_at': now.isoformat()},
                            },
                            upsert=True,
                        )
                    except Exception as exc:
                        print(f"[fortbend_discovery] stale profile write error: {exc}")
                        stats['errors'] += 1
                else:
                    print(
                        f"[fortbend_discovery] [dry-run] would cache stale profile: "
                        f"{full_name_detail} booking={booking_date_str} reason={stale_reason}"
                    )

        return stats

    # ── Seed name collection ──────────────────────────────────────────────────

    def _collect_seed_names(self, seed_source: str) -> List[Tuple[str, str]]:
        """
        Collect (last_name, first_name) pairs from recent bulk county records.
        Gracefully falls back when collections are unavailable (e.g. dry-run NullDb).
        """
        names: List[Tuple[str, str]] = []

        if seed_source == 'recent_bulk':
            collections_and_fields = [
                ('galveston_events', 'last_name', 'first_name'),
                ('harris_bond',      'last_name', 'first_name'),
                ('wharton_inmates',  'last_name', 'first_name'),
            ]
            cutoff = (_utcnow() - timedelta(days=30)).isoformat()
            per_coll_limit = max(200, (self.limit or 200) * 3)

            for coll_name, last_field, first_field in collections_and_fields:
                try:
                    coll = self.db[coll_name]
                    docs = list(
                        coll.find(
                            {'scraped_at': {'$gte': cutoff}},
                            {last_field: 1, first_field: 1, '_id': 0},
                        ).limit(per_coll_limit)
                    )
                    for doc in docs:
                        last  = (doc.get(last_field)  or '').strip().upper()
                        first = (doc.get(first_field) or '').strip().upper()
                        if last:
                            names.append((last, first))
                except Exception as exc:
                    print(f"[fortbend_discovery] seed from {coll_name} failed: {exc}")

        # Deduplicate while preserving order
        seen: set = set()
        unique: List[Tuple[str, str]] = []
        for pair in names:
            if pair not in seen:
                seen.add(pair)
                unique.append(pair)

        # Return enough names to fill limit * 3 searches (many may yield 0 results)
        cap = (self.limit or 100) * 3
        return unique[:cap]
