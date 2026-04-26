# ingestion/event_feeds/
#
# Real-time / near-real-time event feed ingestion.
# Sources that push or expose a live event stream (arrests, bookings, releases).
#
# Characteristics:
#   - Polling-based (every 5–10 minutes)
#   - Append-only event records; each booking is an immutable event
#   - High frequency, low latency
#   - Should NOT overwrite existing records — always append or upsert by event key
#
# Current implementations:
#   galveston_p2c  — Galveston County P2C portal (jqHandler.ashx AJAX endpoint)

from ingestion.event_feeds.base import EventFeedScraper
from ingestion.event_feeds.galveston_p2c import GalvestonP2CEventFeed

__all__ = ["EventFeedScraper", "GalvestonP2CEventFeed"]
