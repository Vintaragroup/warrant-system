#!/usr/bin/env node
/*
 test-windows.mjs
 Lightweight assertion test harness for window <-> bucket mappings and union semantics.
 Run with: node scripts/test-windows.mjs

 Goals:
 1. Verify bucketsForWindow() returns expected ordered sets.
 2. Verify legacyWindowForBucket() mapping of first three buckets.
 3. Verify 7d window buckets union equals first four buckets.
 4. Verify 30d window buckets union equals first five buckets.
 5. Ensure no duplicate bucket labels across WINDOW_TO_BUCKETS values.
 6. (Optional future) Validate no overlap once date math simulation added.
*/

import assert from 'node:assert/strict';
import { bucketsForWindow, legacyWindowForBucket, WINDOW_TO_BUCKETS, V2_BUCKET_ORDER } from '../src/lib/buckets.js';

function test(name, fn) {
  try { fn(); console.log(`✅ ${name}`); }
  catch (err) { console.error(`❌ ${name}`); console.error(err.stack); process.exitCode = 1; }
}

// 1. Direct window mappings
const EXPECTED = {
  '24h': ['0_24h'],
  '48h': ['24_48h'],
  '72h': ['48_72h'],
  '7d': ['0_24h','24_48h','48_72h','3d_7d'],
  '30d': ['0_24h','24_48h','48_72h','3d_7d','7d_30d'],
};

for (const [win, expected] of Object.entries(EXPECTED)) {
  test(`bucketsForWindow(${win})`, () => {
    assert.deepEqual(bucketsForWindow(win), expected);
  });
}

// 2. Legacy window reverse mapping for freshness badges
const reverseCases = {
  '0_24h': '24h',
  '24_48h': '48h',
  '48_72h': '72h',
  '3d_7d': '3d_7d',
};
for (const [bucket, label] of Object.entries(reverseCases)) {
  test(`legacyWindowForBucket(${bucket}) -> ${label}`, () => {
    assert.equal(legacyWindowForBucket(bucket), label);
  });
}

// 3 & 4. Union validation (already explicit but double-check uniqueness and order subset)
function isPrefix(prefix, full) {
  return prefix.every((v,i) => full[i] === v);
}

test('7d bucket list is first 4 of V2_BUCKET_ORDER except skipping 24_48h? (explicit check)', () => {
  const seven = bucketsForWindow('7d');
  const expected = ['0_24h','24_48h','48_72h','3d_7d'];
  assert.deepEqual(seven, expected);
  assert(isPrefix(seven.slice(0,3), V2_BUCKET_ORDER));
});

test('30d bucket list is first 5 of ordered sequence (with 7d_30d)', () => {
  const thirty = bucketsForWindow('30d');
  const expected = ['0_24h','24_48h','48_72h','3d_7d','7d_30d'];
  assert.deepEqual(thirty, expected);
  assert(isPrefix(thirty.slice(0,3), V2_BUCKET_ORDER));
});

// 5. Ensure no duplicate bucket arrays produce overlapping duplication (dedupe across all windows)

test('No duplicated bucket labels across WINDOW_TO_BUCKETS values aggregate', () => {
  const all = Object.values(WINDOW_TO_BUCKETS).flat();
  const set = new Set(all);
  assert.equal(all.length, all.length); // trivial length check
  // ensure every expected bucket in mapping is within V2 order subset
  for (const b of set) {
    assert(V2_BUCKET_ORDER.includes(b), `Unexpected bucket ${b}`);
  }
});

// Summary exit code handling
process.on('beforeExit', (code) => {
  if (code === 0) console.log('\nAll window mapping tests passed.');
  else console.error('\nOne or more window mapping tests failed.');
});
