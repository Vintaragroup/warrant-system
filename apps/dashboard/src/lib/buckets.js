// Frontend bucket helpers (mirrors server/src/lib/buckets.js minimal subset)
// Contract buckets: 0_24h, 24_48h, 48_72h, 3d_7d, 7d_30d, 30d_60d, 60d_plus

export function legacyWindowForBucket(bucket) {
  switch (bucket) {
    case '0_24h': return '24h';
    case '24_48h': return '48h';
    case '48_72h': return '72h';
    default: return bucket || null;
  }
}

export function bucketTone(bucket) {
  switch (bucket) {
    case '0_24h': return 'fresh';
    case '24_48h': return 'mid';
    case '48_72h': return 'aging';
    default: return 'stale';
  }
}

export function bucketClasses(bucket) {
  const tone = bucketTone(bucket);
  const map = {
    fresh: 'bg-green-50 text-green-700 border-green-200',
    mid: 'bg-amber-50 text-amber-700 border-amber-200',
    aging: 'bg-red-50 text-red-700 border-red-200',
    stale: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return map[tone] || map.stale;
}
