export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;

  // Strip all non-digits
  const digits = phone.replace(/\D/g, '');

  // E.164 format check (starts with +)
  if (phone.startsWith('+')) {
    return `+${digits}`;
  }

  // US/Canada: 10 digits or 1 + 10 digits
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // International: assume + prefix
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  // Return as-is if we can't normalize
  return phone;
}
