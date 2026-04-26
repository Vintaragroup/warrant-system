# ingestion/lookups/
#
# Lookup / search-based enrichment layer.
# Sources that require a name or identifier as input — they cannot enumerate
# the full population.
#
# IMPORTANT: These scrapers are ENRICHMENT TOOLS, not primary ingestion sources.
# They should only be called when we already know who we are looking for.
# Do NOT run these as a scheduled primary pipeline step.
#
# Characteristics:
#   - Require explicit input (last_name, first_name, booking_number, etc.)
#   - Return structured result for a single person
#   - No brute-force name generation or alphabet-sweep
#   - Caller is responsible for providing subject identity
#
# Current implementations:
#   brazoria_lookup  — Brazoria County Tyler PublicAccess
#   fortbend_lookup  — Fort Bend County jail inquiry
#   jefferson_lookup — Jefferson County InmateSearch

from ingestion.lookups.base import LookupScraper
from ingestion.lookups.brazoria_lookup import BrazoriaLookup
from ingestion.lookups.fortbend_lookup import FortBendLookup
from ingestion.lookups.jefferson_lookup import JeffersonLookup

__all__ = ["LookupScraper", "BrazoriaLookup", "FortBendLookup", "JeffersonLookup"]
