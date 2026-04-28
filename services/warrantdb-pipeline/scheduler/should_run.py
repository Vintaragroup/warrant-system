"""
scheduler/should_run.py
──────────────────────────────────────────────────────────────────────────────
Determines whether an ingestion source should run now, based on its
admin_config schedule document and the run history in ingestion_runs.

Returns a (bool, reason_str | None) tuple:
  (True, None)          — source should run
  (False, "reason")     — source should be skipped, with an explanation

Schedule strategies
───────────────────
  "interval"   — run if more than interval_minutes have elapsed since the last
                 non-dry-run attempted run (success or failed).
  "run_times"  — run only during a 5-minute window after each local HH:MM entry
                 in the run_times list.
"""
from __future__ import annotations

from datetime import datetime, date, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from scheduler.config import get_source_config


def should_run_source(
    db,
    source: str,
    now: Optional[datetime] = None,
    trigger: str = "scheduled",
    force: bool = False,
) -> Tuple[bool, Optional[str]]:
    """
    Decide whether `source` should run right now.

    Rules (evaluated in priority order):
      1. Unknown source           → skip
      2. Source disabled          → skip (unless force=True)
      3. trigger="manual"         → allow if enabled (bypasses schedule checks)
      4. skip_weekends=True + Sat/Sun → skip
      5. today not in allowed_days → skip
      6. max_runs_per_day reached → skip
      7. strategy="interval"      → compare elapsed time vs interval_minutes
      8. strategy="run_times"     → match current local time to a run window
    """
    config = get_source_config(db, source)
    if config is None:
        return False, f"source={source!r} is not a supported source"

    if not config.get("enabled", False):
        if force:
            # force=True allows even disabled sources (for manual emergency runs)
            return True, None
        return False, f"source={source!r} is disabled in admin_config"

    # Manual trigger bypasses schedule timing checks but still respects enabled flag
    if trigger == "manual" and not force:
        return True, None

    # Resolve local timezone
    tz_name = config.get("schedule", {}).get("timezone", "America/New_York")
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")

    now_utc = now if now is not None else datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    now_local = now_utc.astimezone(tz)
    weekday = now_local.isoweekday()  # 1=Mon … 7=Sun

    sched = config.get("schedule", {})

    # ── Weekend skip ──────────────────────────────────────────────────────────
    if sched.get("skip_weekends", False) and weekday in (6, 7):
        day_name = "Saturday" if weekday == 6 else "Sunday"
        return False, f"skip_weekends=True, today is {day_name}"

    # ── Allowed days ──────────────────────────────────────────────────────────
    allowed_days = sched.get("allowed_days") or [1, 2, 3, 4, 5, 6, 7]
    if weekday not in allowed_days:
        return False, f"weekday={weekday} not in allowed_days={allowed_days}"

    # ── Max runs per day ──────────────────────────────────────────────────────
    max_runs = sched.get("max_runs_per_day") or 0
    if max_runs > 0:
        today_str = now_local.date().isoformat()
        runs_today = _count_runs_today(db, source, today_str, tz)
        if runs_today >= max_runs:
            return False, (
                f"max_runs_per_day={max_runs} reached "
                f"(today={today_str}, runs_today={runs_today})"
            )

    # ── Strategy ─────────────────────────────────────────────────────────────
    strategy = sched.get("strategy", "interval")

    if strategy == "interval":
        interval_minutes = sched.get("interval_minutes")
        if not interval_minutes or interval_minutes <= 0:
            return False, (
                f"strategy=interval but interval_minutes is not configured "
                f"for source={source!r}"
            )
        last_run_at = _get_last_attempted_run_time(db, source)
        if last_run_at is not None:
            elapsed_min = (now_utc - last_run_at).total_seconds() / 60.0
            if elapsed_min < interval_minutes:
                return False, (
                    f"interval_minutes={interval_minutes}, "
                    f"last_run={last_run_at.isoformat()}, "
                    f"elapsed={elapsed_min:.1f}min — too soon"
                )
        return True, None

    if strategy == "run_times":
        run_times = sched.get("run_times") or []
        if not run_times:
            return False, (
                f"strategy=run_times but run_times list is empty "
                f"for source={source!r}"
            )
        # Allow a 5-minute window after each scheduled time
        now_floored = now_local.replace(second=0, microsecond=0)
        for rt in run_times:
            try:
                h, m = map(int, rt.split(":"))
            except (ValueError, AttributeError):
                continue
            window_start = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
            window_end = window_start + timedelta(minutes=5)
            if window_start <= now_floored < window_end:
                return True, None
        current_hhmm = now_local.strftime("%H:%M")
        return False, (
            f"strategy=run_times, no window matched "
            f"run_times={run_times} at {current_hhmm} {tz_name}"
        )

    if strategy == "manual":
        # This source requires an explicit trigger — never runs on a cron heartbeat.
        return False, (
            f"strategy=manual for source={source!r} — "
            "run via CLI or Admin UI with --trigger manual"
        )

    return False, f"unknown schedule strategy={strategy!r}"


# ── Private helpers ───────────────────────────────────────────────────────────

def _get_last_attempted_run_time(db, source: str) -> Optional[datetime]:
    """
    Return the started_at of the most recent non-dry-run run that had
    status success or failed (i.e. actually attempted, not skipped).
    """
    doc = db["ingestion_runs"].find_one(
        {
            "source": source,
            "dry_run": False,
            "status": {"$in": ["success", "failed"]},
        },
        sort=[("started_at", -1)],
        projection={"started_at": 1},
    )
    if not doc:
        return None
    return _parse_ts(doc.get("started_at"))


def _count_runs_today(db, source: str, today_local_str: str, tz: ZoneInfo) -> int:
    """
    Count non-dry-run, non-skipped runs that started on `today_local_str`
    (a local-calendar date in the source's configured timezone).
    """
    today_date = date.fromisoformat(today_local_str)
    day_start = datetime(
        today_date.year, today_date.month, today_date.day, 0, 0, 0, tzinfo=tz
    )
    day_end = datetime(
        today_date.year, today_date.month, today_date.day, 23, 59, 59, tzinfo=tz
    )
    start_utc = day_start.astimezone(timezone.utc).isoformat()
    end_utc = day_end.astimezone(timezone.utc).isoformat()

    return db["ingestion_runs"].count_documents({
        "source": source,
        "dry_run": False,
        "status": {"$in": ["success", "failed"]},
        "started_at": {"$gte": start_utc, "$lte": end_utc},
    })


def _parse_ts(ts) -> Optional[datetime]:
    """Parse an ISO string or datetime object to a timezone-aware datetime."""
    if ts is None:
        return None
    try:
        if isinstance(ts, str):
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if isinstance(ts, datetime):
            return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    except Exception:
        return None
    return None
