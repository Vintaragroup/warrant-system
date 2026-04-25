export function sanitizeString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function sanitizePhone(value) {
  if (typeof value !== 'string') return undefined;
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: undefined, lastName: undefined, fullName: undefined };
  }
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: undefined, lastName: undefined, fullName: undefined };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: undefined, fullName: trimmed };
  }
  const [firstName, ...rest] = parts;
  const lastName = rest.join(' ');
  return { firstName, lastName, fullName: trimmed };
}

export function nextExpiry(ttlMinutes) {
  const minutes = Number.isFinite(Number(ttlMinutes)) ? Number(ttlMinutes) : 60;
  return new Date(Date.now() + minutes * 60_000);
}
