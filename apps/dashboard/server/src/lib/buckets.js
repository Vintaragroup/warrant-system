// buckets.js - mapping helpers between legacy window labels and time_bucket_v2 taxonomy
// Contract buckets: 0_24h, 24_48h, 48_72h, 3d_7d, 7d_30d, 30d_60d, 60d_plus

export const V2_BUCKET_ORDER = [
  '0_24h',
  '24_48h',
  '48_72h',
  '3d_7d',
  '7d_30d',
  '30d_60d',
  '60d_plus'
];

// Legacy dashboard windows -> set of buckets
export const WINDOW_TO_BUCKETS = {
  '24h': ['0_24h'],
  '48h': ['24_48h'],
  '72h': ['48_72h'],
  '3d_7d': ['3d_7d'],
  '7d': ['0_24h','24_48h','48_72h','3d_7d'],
  '30d': ['0_24h','24_48h','48_72h','3d_7d','7d_30d'],
};

export function bucketsForWindow(win) {
  return WINDOW_TO_BUCKETS[win?.toLowerCase?.()] || WINDOW_TO_BUCKETS['24h'];
}

// Map single bucket to legacy short label (for row-level freshness badges)
export function legacyWindowForBucket(bucket) {
  switch (bucket) {
    case '0_24h': return '24h';
    case '24_48h': return '48h';
    case '48_72h': return '72h';
    // Buckets beyond 72h collapse into broader windows; caller decides mapping for 7d/30d aggregates
    default: return bucket; // allow UI to display raw bucket if needed
  }
}

export function isV2Bucket(v) { return V2_BUCKET_ORDER.includes(v); }
