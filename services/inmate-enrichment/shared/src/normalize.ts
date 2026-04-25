export function normNamePart(s?: string | null): string {
  return (s || '')
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function toFullName(first?: string | null, middle?: string | null, last?: string | null): string {
  return [first, middle, last].map(normNamePart).filter(Boolean).join(' ').trim();
}

// Small nickname map tuned for common variants; keep conservative to avoid false positives
const NICKNAMES: Record<string, string[]> = {
  alexander: ['alex'],
  jose: ['pepe'],
  william: ['bill', 'will', 'billy'],
  robert: ['bob', 'rob', 'bobby'],
  michael: ['mike'],
  christopher: ['chris'],
  jonathan: ['jon', 'john'],
  john: ['jon'],
  giovanni: ['john', 'juan'],
};

export function firstNameVariants(first?: string | null): string[] {
  const base = normNamePart(first);
  if (!base) return [];
  const alts = NICKNAMES[base] || [];
  return [base, ...alts];
}

export function nameVariants(
  first?: string | null,
  middle?: string | null,
  last?: string | null
): { full: string; firstOnly: string; trimmed: string; firstAlts: string[]; last: string } {
  const f = normNamePart(first);
  const m = normNamePart(middle);
  const l = normNamePart(last);
  const full = toFullName(f, m, l);
  const firstOnly = toFullName(f, null, l);
  const trimmed = toFullName(f, m ? m.charAt(0) : null, l);
  const firstAlts = firstNameVariants(f);
  return { full, firstOnly, trimmed, firstAlts, last: l };
}

export function lastNameAgrees(a?: string | null, b?: string | null): boolean {
  const la = normNamePart(a);
  const lb = normNamePart(b);
  if (!la || !lb) return false;
  return la === lb;
}

export function cleanPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

export function cleanAddress(addr?: string | null): string | null {
  if (!addr) return null;
  return addr.trim().replace(/\s+/g, ' ');
}

export function deriveLocationFromAddress(addr: any, fallbacks?: { city?: string; state?: string; zip?: string }) {
  let city: string | undefined = fallbacks?.city || undefined;
  let state: string | undefined = fallbacks?.state || undefined;
  let zip: string | undefined = fallbacks?.zip || undefined;
  if (!addr) return { city, state, zip };
  if (typeof addr === 'string') {
    const lines = addr.split(/\n|\r|;/).map((s) => s.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    const parts = last.split(',').map((s) => s.trim()).filter(Boolean);
    const zipMatch = last.match(/\b\d{5}(?:-\d{4})?\b/);
    if (!city && parts[0]) city = parts[0];
    if (!state && parts[1]) state = parts[1];
    if (!zip && zipMatch) zip = zipMatch[0];
  } else if (typeof addr === 'object') {
    if (!city && addr.city) city = String(addr.city).trim();
    if (!state && addr.state) state = String(addr.state).trim();
    if (!zip && (addr.zip || addr.postal_code)) zip = String(addr.zip || addr.postal_code).trim();
  }
  return { city, state, zip };
}

// Coerce provider match values to a consistent numeric type
// - Accepts numbers or numeric strings (e.g., "0", "0.85")
// - Returns a finite number in [0, 1] when possible; otherwise null
export function normalizeMatch(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
  }
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v.trim()) : NaN);
  if (!Number.isFinite(n)) return null;
  // clamp to [0,1] to avoid accidental percentages or out-of-range values
  const clamped = Math.max(0, Math.min(1, n));
  return clamped;
}
