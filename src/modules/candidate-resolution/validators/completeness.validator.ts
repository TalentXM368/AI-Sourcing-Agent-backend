import type { ResolvedCandidateProfile } from '../types/index.js';

export function validateCompleteness(profile: ResolvedCandidateProfile): string[] {
  const missing: string[] = [];

  if (!profile.personal?.name?.value || profile.personal.name.value === 'Unknown') {
    missing.push('personal.name');
  }
  if (!profile.contact?.email?.value) missing.push('contact.email');
  if (!profile.contact?.phone?.value) missing.push('contact.phone');
  if (!profile.contact?.linkedin?.value) missing.push('contact.linkedin');
  if (profile.skills.length === 0) missing.push('skills');
  if (profile.experience.length === 0) missing.push('experience');
  if (profile.education.length === 0) missing.push('education');

  return missing;
}
