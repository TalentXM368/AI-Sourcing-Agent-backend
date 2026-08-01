import type { CandidateProfile, CompletenessResult, ValidationWarning } from '../types/profile.types.js';

const REQUIRED_FIELDS = [
  'personal.name',
  'contact.email',
];

const IMPORTANT_FIELDS = [
  'personal.name',
  'contact.email',
  'contact.phone',
  'contact.linkedin',
  'skills',
  'experience',
  'education',
];

const OPTIONAL_FIELDS = [
  'contact.github',
  'contact.portfolio',
  'projects',
  'certifications',
  'languages',
];

export function validateCompleteness(profile: CandidateProfile): CompletenessResult {
  const presentFields: string[] = [];
  const missingFields: string[] = [];

  // Check required fields
  for (const field of REQUIRED_FIELDS) {
    const value = getFieldValue(profile, field);
    if (value !== null && value !== undefined && value !== '') {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  // Check important fields
  for (const field of IMPORTANT_FIELDS) {
    const value = getFieldValue(profile, field);
    if (value !== null && value !== undefined && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  // Check optional fields
  for (const field of OPTIONAL_FIELDS) {
    const value = getFieldValue(profile, field);
    if (value !== null && value !== undefined && value !== '' &&
        !(Array.isArray(value) && value.length === 0)) {
      presentFields.push(field);
    }
  }

  const totalFields = REQUIRED_FIELDS.length + IMPORTANT_FIELDS.length + OPTIONAL_FIELDS.length;
  const score = presentFields.length / totalFields;

  return {
    score: Math.round(score * 100) / 100,
    missingFields,
    presentFields,
  };
}

function getFieldValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}
