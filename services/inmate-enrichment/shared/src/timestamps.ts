import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import tz from 'dayjs/plugin/timezone';
import { config } from './config';

dayjs.extend(utc);
dayjs.extend(tz);

const CANDIDATE_FIELDS = [
  // prioritize booking/booking_date style fields if present
  'booking_datetime',
  'booking_at',
  'booking_time',
  'booking_date',
  'scraped_at',
  '_ingested_at',
  'fetched_at',
  'migrated_at',
  'first_seen_at',
  'inserted_at',
  'detail_fetched_at',
] as const;

export type AnyDoc = Record<string, unknown>;

export function parseTimestamp(input: unknown): string | null {
  if (input == null) return null;
  // If it's already a Date
  if (input instanceof Date && !isNaN(input.getTime())) {
    return input.toISOString();
  }
  // If it's number-like (epoch seconds or ms)
  if (typeof input === 'number') {
    const ms = input > 1e12 ? input : input * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return null;
    // Try ISO directly
    const iso = dayjs(s);
    if (iso.isValid()) return iso.toDate().toISOString();
    // Try common formats
    const fmts = [
      'MM/DD/YYYY HH:mm:ss',
      'MM/DD/YYYY',
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD',
    ];
    for (const f of fmts) {
      const d = dayjs(s, f);
      if (d.isValid()) return d.toDate().toISOString();
    }
    // Try numeric string epoch
    if (/^\d{10,13}$/.test(s)) {
      const n = Number(s);
      const ms = s.length === 13 ? n : n * 1000;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
  }
  return null;
}

export function getIngestionTimestamp(doc: AnyDoc): string | null {
  for (const f of CANDIDATE_FIELDS) {
    if (doc && Object.prototype.hasOwnProperty.call(doc, f)) {
      const v = (doc as AnyDoc)[f];
      const parsed = parseTimestamp(v);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function isWithinWindow(isoString: string, hours = config.enrichmentWindowHours): boolean {
  const ts = dayjs(isoString);
  if (!ts.isValid()) return false;
  const cutoff = dayjs().utc().subtract(hours, 'hour');
  return ts.isAfter(cutoff);
}

export const candidateTimestampFields = CANDIDATE_FIELDS;
