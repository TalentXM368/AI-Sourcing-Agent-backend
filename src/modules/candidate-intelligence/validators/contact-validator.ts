import type { ExtractedContact } from '../types/extracted.types.js';
import type { ValidationWarning } from '../types/profile.types.js';

export function validateContact(contact: ExtractedContact): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!contact.email) {
    warnings.push({ field: 'contact.email', message: 'Email not found', severity: 'warning' });
  } else if (!/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(contact.email.raw)) {
    warnings.push({ field: 'contact.email', message: 'Invalid email format', severity: 'error' });
  }

  if (!contact.phone) {
    warnings.push({ field: 'contact.phone', message: 'Phone not found', severity: 'info' });
  }

  if (!contact.linkedin) {
    warnings.push({ field: 'contact.linkedin', message: 'LinkedIn not found', severity: 'info' });
  }

  return warnings;
}
