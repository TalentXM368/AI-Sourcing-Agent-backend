import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { CandidateSemanticText } from '../types/index.js';

export function buildCandidateSemanticText(profile: CandidateProfile): CandidateSemanticText {
  const role = profile.personal.headline?.value
    || profile.experience[0]?.title.value
    || '';

  const skills = profile.skills.map(s => s.canonical).join(', ');

  const summary = profile.personal.summary || '';

  const experience = profile.experience
    .map(exp => {
      const parts = [exp.title.value, exp.company.value].filter(Boolean);
      if (exp.durationMonths > 0) parts.push(`(${exp.durationMonths} months)`);
      return parts.join(' at ');
    })
    .join('; ');

  const education = profile.education
    .map(edu => {
      const degree = edu.degree.value;
      const spec = edu.specialization?.value ? ` in ${edu.specialization.value}` : '';
      const uni = edu.university.value;
      return `${degree}${spec} from ${uni}`;
    })
    .join('; ');

  const locationParts = [
    profile.contact.city?.value,
    profile.contact.state?.value,
    profile.contact.country?.value,
  ].filter(Boolean);
  const location = locationParts.join(', ');

  const full = [
    role && `Role: ${role}`,
    skills && `Skills: ${skills}`,
    summary && `Summary: ${summary}`,
    experience && `Experience: ${experience}`,
    education && `Education: ${education}`,
    location && `Location: ${location}`,
  ].filter(Boolean).join('. ');

  return { role, skills, summary, experience, education, location, full };
}

export function buildCandidateQdrantPayload(
  profile: CandidateProfile,
  embeddingMetadata: {
    embeddingVersion: string;
    profileVersion: string;
    provider: string;
    model: string;
    dimensions: number;
    indexedAt: string;
  },
) {
  const locationParts = [
    profile.contact.city?.value,
    profile.contact.state?.value,
    profile.contact.country?.value,
  ].filter(Boolean);

  const experienceYears = profile.experience.reduce((sum, exp) => sum + exp.durationMonths, 0) / 12;

  const educationLevel = profile.education[0]?.educationLevel?.value || undefined;

  return {
    entityId: profile.candidateId,
    entityType: 'candidate' as const,
    ...embeddingMetadata,
    name: profile.personal.name.value,
    headline: profile.personal.headline?.value || undefined,
    skills: profile.skills.map(s => s.canonical),
    location: locationParts.join(', ') || undefined,
    experienceYears: Math.round(experienceYears * 10) / 10,
    educationLevel,
  };
}
