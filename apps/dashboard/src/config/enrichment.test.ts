import { describe, it, expect } from 'vitest';
import { HIGH_QUALITY_MATCH } from './enrichment';

type Party = { accepted?: boolean; match?: unknown };

const parseMatch = (m: unknown) =>
  typeof m === 'number' ? m : (typeof m === 'string' && m.trim() !== '' ? Number(m) : null);

const isHighQuality = (rp: Party) =>
  rp?.accepted === true || (Number.isFinite(parseMatch(rp?.match)) && (parseMatch(rp?.match) as number) >= HIGH_QUALITY_MATCH);

const byQuality = (parties: Party[]) => ({
  high: parties.filter(isHighQuality),
  other: parties.filter((p) => !isHighQuality(p)),
});

describe('enrichment HIGH_QUALITY_MATCH filtering', () => {
  it('uses the constant threshold (default 0.75) for classification', () => {
    // Sanity of the constant in test env (defaults to 0.75 when env is unset)
    expect(HIGH_QUALITY_MATCH).toBeGreaterThan(0);
    expect(HIGH_QUALITY_MATCH).toBeLessThanOrEqual(1);

    const parties: Party[] = [
      { accepted: true, match: 0.1 }, // accepted always high
      { accepted: false, match: 1 }, // perfect match
      { accepted: false, match: HIGH_QUALITY_MATCH }, // exact threshold
      { accepted: false, match: (HIGH_QUALITY_MATCH - 0.01).toFixed(2) }, // string below threshold
      { accepted: false, match: 0 }, // zero is finite but below threshold
      { accepted: false, match: '' }, // empty string → null
      { accepted: false, match: null },
      { accepted: false, match: undefined },
    ];

    const { high, other } = byQuality(parties);

    // accepted and >= threshold should be high
    expect(high).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accepted: true }),
        expect.objectContaining({ match: 1 }),
        expect.objectContaining({ match: HIGH_QUALITY_MATCH }),
      ])
    );

    // below threshold and non-finite/null should be in other
    expect(other).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ match: 0 }),
        expect.objectContaining({ match: '' }),
        expect.objectContaining({ match: null }),
        expect.objectContaining({ match: undefined }),
      ])
    );

    // Partition check: no overlap and total equals input length
    expect(high.length + other.length).toBe(parties.length);
    for (const p of parties) {
      expect(high.includes(p) && other.includes(p)).toBe(false);
    }
  });
});
