import { FIELD_SOURCE_PRIORITIES } from '../constants/index.js';

export function getSourcePriority(fieldName: string, sourceSection: string): number {
  const priorities = FIELD_SOURCE_PRIORITIES[fieldName];
  if (!priorities) return 0;
  const index = priorities.indexOf(sourceSection);
  return index >= 0 ? priorities.length - index : 0;
}

export function getFieldNamePrefix(category: string): string {
  const prefixMap: Record<string, string> = {
    personal: 'personal.',
    contact: 'contact.',
    experience: 'experience.',
    education: 'education.',
    projects: 'projects.',
    certifications: 'certifications.',
    languages: 'languages.',
    skills: 'skills',
  };
  return prefixMap[category] || category;
}
