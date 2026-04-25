export type Evidence = { type: string; value?: string; weight?: number; provider?: string };

export type PartySignals = {
  sharesRecentAddress?: boolean; // within 24 months
  reversePhoneHit?: boolean;
  explicitRelationship?: boolean;
  lastNameCityMatch?: boolean;
  appearsInProviders?: number; // count of independent providers
  socialConsistencyScore?: number; // 0..1
};

export function scoreRelatedParty(signals: PartySignals): { score: number; label: 'likely_kin' | 'possible_contact' | 'low' } {
  let score = 0;
  if (signals.sharesRecentAddress) score += 0.35;
  if (signals.reversePhoneHit) score += 0.2;
  if (signals.explicitRelationship) score += 0.2;
  if (signals.lastNameCityMatch) score += 0.1;
  if ((signals.appearsInProviders || 0) >= 2) score += 0.1;
  if ((signals.socialConsistencyScore || 0) >= 0.7) score += 0.05;
  if (score > 1) score = 1;
  const label: 'likely_kin' | 'possible_contact' | 'low' = score >= 0.7 ? 'likely_kin' : score >= 0.5 ? 'possible_contact' : 'low';
  return { score, label };
}
