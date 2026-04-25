import crypto from 'crypto';

export function sha1Hex(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}

export function buildPartyId(name: string, city?: string | null, dob?: string | null): string {
  const key = [name?.toLowerCase().trim() || '', city?.toLowerCase().trim() || '', dob || ''].join('|');
  return sha1Hex(key);
}
