import { scoreRelatedParty } from '../shared/src/scoring';

test('scoring thresholds', () => {
  const a = scoreRelatedParty({ sharesRecentAddress: true, reversePhoneHit: true });
  expect(a.score).toBeGreaterThanOrEqual(0.55);
  const b = scoreRelatedParty({ sharesRecentAddress: true, reversePhoneHit: true, explicitRelationship: true, lastNameCityMatch: true, appearsInProviders: 2, socialConsistencyScore: 0.8 });
  expect(b.score).toBeLessThanOrEqual(1);
  expect(b.label).toBe('likely_kin');
});
