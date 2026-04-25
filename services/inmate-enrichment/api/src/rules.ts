const TARGET_COUNTIES = new Set(['Harris', 'Fort Bend', 'Brazoria', 'Galveston', 'Jefferson']);

export function shouldAutoEnrich(doc: any): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const county = (doc?.county || '').toString();
  if (TARGET_COUNTIES.has(county)) reasons.push('county_target');
  const age = typeof doc?.age === 'number' ? doc.age : null;
  if (age != null && age >= 18 && age <= 35) reasons.push('age_18_35');
  const hasContact = (doc?.facts?.phones?.length || 0) > 0 || (doc?.facts?.emails?.length || 0) > 0;
  if (!hasContact) reasons.push('missing_contact');
  const bond = typeof doc?.bond_amount === 'number' ? doc.bond_amount : 0;
  if (bond >= 1000) reasons.push('bond_high');
  return { ok: reasons.length > 0, reasons };
}
