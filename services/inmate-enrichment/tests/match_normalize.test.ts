import { normalizeMatch } from '../shared/src/normalize';

describe('normalizeMatch', () => {
  it('keeps numeric values within [0,1]', () => {
    expect(normalizeMatch(0)).toBe(0);
    expect(normalizeMatch(0.12)).toBeCloseTo(0.12, 6);
    expect(normalizeMatch(1)).toBe(1);
  });
  it('parses numeric strings', () => {
    expect(normalizeMatch('0')).toBe(0);
    expect(normalizeMatch('0.85')).toBeCloseTo(0.85, 6);
    expect(normalizeMatch('1')).toBe(1);
  });
  it('clamps out-of-range values', () => {
    expect(normalizeMatch(-0.5)).toBe(0);
    expect(normalizeMatch(1.5)).toBe(1);
    expect(normalizeMatch('2.3')).toBe(1);
  });
  it('returns null for non-numeric', () => {
    expect(normalizeMatch(undefined as any)).toBeNull();
    expect(normalizeMatch(null as any)).toBeNull();
    expect(normalizeMatch('')).toBeNull();
    expect(normalizeMatch('abc' as any)).toBeNull();
    expect(normalizeMatch(NaN as any)).toBeNull();
  });
});
