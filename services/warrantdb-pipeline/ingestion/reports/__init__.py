# ingestion/reports/
#
# Report / batch ingestion layer.
# Sources that publish structured reports on a fixed schedule (daily PDFs, CSV exports, etc.).
#
# Characteristics:
#   - Triggered once per day (or per report publication)
#   - Deterministic dataset per run — every report is fully consumed
#   - Structured document parsing (PDF, CSV, XLSX)
#   - Idempotent: re-running the same report must not create duplicates
#
# Current implementations:
#   harris_reports  — Harris County District Clerk JIMS public dataset CSVs

from ingestion.reports.base import ReportIngestor
from ingestion.reports.harris_reports import HarrisReportIngestor

__all__ = ["ReportIngestor", "HarrisReportIngestor"]
