export const RESOLUTION_VERSION = '2.2.0';

export const CONFIDENCE_THRESHOLDS = {
  VERY_HIGH: 0.95,
  HIGH: 0.80,
  MEDIUM: 0.60,
  LOW: 0.0,
} as const;

export const CONFLICT_MARGIN = 0.10;

export const FIELD_SOURCE_PRIORITIES: Record<string, string[]> = {
  'personal.name':          ['header', 'contact', 'email', 'linkedin', 'experience'],
  'personal.headline':      ['header', 'experience', 'summary'],
  'contact.email':          ['contact', 'header'],
  'contact.phone':          ['contact', 'header', 'experience'],
  'contact.linkedin':       ['contact', 'header'],
  'contact.github':         ['contact', 'header'],
  'contact.portfolio':      ['contact', 'header'],
  'contact.website':        ['contact', 'header'],
  'contact.city':           ['contact', 'header', 'experience'],
  'contact.state':          ['contact', 'header', 'experience'],
  'contact.country':        ['contact', 'header', 'experience'],
  'skills':                 ['skills', 'projects', 'experience', 'summary'],
  'experience.company':     ['experience', 'summary', 'projects'],
  'experience.title':       ['experience', 'summary'],
  'experience.employmentType': ['experience'],
  'experience.startDate':   ['experience'],
  'experience.endDate':     ['experience'],
  'education.university':   ['education'],
  'education.degree':       ['education'],
  'education.specialization': ['education'],
  'education.graduationYear': ['education'],
  'projects.name':          ['projects'],
  'projects.technologies':  ['projects', 'experience'],
  'certifications.name':    ['certifications'],
  'certifications.issuer':  ['certifications'],
  'languages.name':         ['languages'],
  'languages.proficiency':  ['languages'],
};

export type ConfidenceLevel = 'very_high' | 'high' | 'medium' | 'low';

export function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= CONFIDENCE_THRESHOLDS.VERY_HIGH) return 'very_high';
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'high';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'medium';
  return 'low';
}
