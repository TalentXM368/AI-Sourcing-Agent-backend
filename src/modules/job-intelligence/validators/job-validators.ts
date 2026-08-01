import type { JobProfile, JobValidationWarning } from '../types/index.js';

const REQUIRED_FIELDS = [
  'title',
  'company',
  'requiredSkills',
] as const;

const IMPORTANT_FIELDS = [
  'title',
  'company',
  'summary',
  'requiredSkills',
  'responsibilities',
  'employmentType',
  'seniority',
  'location',
] as const;

const OPTIONAL_FIELDS = [
  'preferredSkills',
  'salary',
  'benefits',
  'education',
  'experience',
  'technologies',
  'tools',
  'certifications',
  'languages',
  'department',
  'industry',
  'domain',
  'travelRequirements',
  'workAuthorization',
  'visaSponsorship',
  'shift',
] as const;

export function validateJobCompleteness(profile: JobProfile): { score: number; missingFields: string[]; presentFields: string[] } {
  const missingFields: string[] = [];
  const presentFields: string[] = [];

  const allFields = [...REQUIRED_FIELDS, ...IMPORTANT_FIELDS, ...OPTIONAL_FIELDS];
  const uniqueFields = [...new Set(allFields)];

  for (const field of uniqueFields) {
    if (isFieldPresent(profile, field)) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  const score = presentFields.length / uniqueFields.length;

  return { score, missingFields, presentFields };
}

export function validateJobWarnings(profile: JobProfile): JobValidationWarning[] {
  const warnings: JobValidationWarning[] = [];

  if (!profile.title?.value || profile.title.value === 'Unknown Role') {
    warnings.push({ field: 'title', message: 'Job title is missing or unknown', severity: 'warning' });
  }

  if (!profile.company?.value || profile.company.value === 'Unknown Company') {
    warnings.push({ field: 'company', message: 'Company name is missing', severity: 'warning' });
  }

  if (profile.requiredSkills.length === 0) {
    warnings.push({ field: 'requiredSkills', message: 'No required skills extracted', severity: 'warning' });
  }

  if (profile.responsibilities.length === 0) {
    warnings.push({ field: 'responsibilities', message: 'No responsibilities extracted', severity: 'info' });
  }

  if (!profile.summary?.value) {
    warnings.push({ field: 'summary', message: 'No job summary found', severity: 'info' });
  }

  if (!profile.location?.raw?.value && !profile.location?.city?.value) {
    warnings.push({ field: 'location', message: 'No location information found', severity: 'info' });
  }

  if (!profile.employmentType?.value) {
    warnings.push({ field: 'employmentType', message: 'Employment type not detected', severity: 'info' });
  }

  if (profile.experience.minimumYears && profile.experience.maximumYears) {
    const min = parseInt(profile.experience.minimumYears.value);
    const max = parseInt(profile.experience.maximumYears.value);
    if (!isNaN(min) && !isNaN(max) && min > max) {
      warnings.push({ field: 'experience', message: 'Minimum years exceeds maximum years', severity: 'error' });
    }
  }

  if (profile.salary.minimum && profile.salary.maximum) {
    const min = parseFloat(profile.salary.minimum.value);
    const max = parseFloat(profile.salary.maximum.value);
    if (!isNaN(min) && !isNaN(max) && min > max) {
      warnings.push({ field: 'salary', message: 'Salary minimum exceeds maximum', severity: 'error' });
    }
  }

  const skillNames = profile.requiredSkills.map(s => s.canonical);
  const dupes = skillNames.filter((name, i) => skillNames.indexOf(name) !== i);
  if (dupes.length > 0) {
    warnings.push({ field: 'requiredSkills', message: `Duplicate skills: ${[...new Set(dupes)].join(', ')}`, severity: 'warning' });
  }

  return warnings;
}

function isFieldPresent(profile: JobProfile, field: string): boolean {
  switch (field) {
    case 'title': return !!profile.title?.value;
    case 'company': return !!profile.company?.value;
    case 'summary': return !!profile.summary?.value;
    case 'requiredSkills': return profile.requiredSkills.length > 0;
    case 'preferredSkills': return profile.preferredSkills.length > 0;
    case 'responsibilities': return profile.responsibilities.length > 0;
    case 'employmentType': return !!profile.employmentType?.value;
    case 'seniority': return !!profile.seniority?.value;
    case 'location': return !!(profile.location?.city?.value || profile.location?.state?.value || profile.location?.country?.value || profile.location?.raw?.value);
    case 'salary': return !!(profile.salary.minimum?.value || profile.salary.maximum?.value || profile.salary.raw?.value);
    case 'benefits': return profile.benefits.length > 0;
    case 'education': return !!(profile.education.degree?.value || profile.education.educationLevel?.value);
    case 'experience': return !!(profile.experience.minimumYears?.value || profile.experience.maximumYears?.value);
    case 'technologies': return profile.technologies.length > 0;
    case 'tools': return profile.tools.length > 0;
    case 'certifications': return profile.certifications.length > 0;
    case 'languages': return profile.languages.length > 0;
    case 'department': return !!profile.department?.value;
    case 'industry': return !!profile.industry?.value;
    case 'domain': return !!profile.domain?.value;
    case 'travelRequirements': return !!profile.travelRequirements?.value;
    case 'workAuthorization': return !!profile.workAuthorization?.value;
    case 'visaSponsorship': return !!profile.visaSponsorship?.value;
    case 'shift': return !!profile.shift?.value;
    default: return false;
  }
}
