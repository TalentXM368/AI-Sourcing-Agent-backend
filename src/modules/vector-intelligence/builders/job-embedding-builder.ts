import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { JobSemanticText } from '../types/index.js';

export function buildJobSemanticText(profile: JobProfile): JobSemanticText {
  const title = profile.title.value || '';

  const skills = [
    ...profile.requiredSkills.map(s => s.canonical),
    ...profile.preferredSkills.map(s => s.canonical),
  ].join(', ');

  const summary = profile.summary.value || '';

  const responsibilities = profile.responsibilities.join('; ');

  const experienceParts: string[] = [];
  if (profile.experience.minimumYears?.value) {
    experienceParts.push(`Minimum ${profile.experience.minimumYears.value} years`);
  }
  if (profile.experience.maximumYears?.value) {
    experienceParts.push(`Maximum ${profile.experience.maximumYears.value} years`);
  }
  const experience = experienceParts.join(', ');

  const locationParts = [
    profile.location.city?.value,
    profile.location.state?.value,
    profile.location.country?.value,
  ].filter(Boolean);
  const location = locationParts.join(', ');

  const full = [
    title && `Title: ${title}`,
    skills && `Required Skills: ${skills}`,
    summary && `Description: ${summary}`,
    responsibilities && `Responsibilities: ${responsibilities}`,
    experience && `Experience: ${experience}`,
    location && `Location: ${location}`,
  ].filter(Boolean).join('. ');

  return { title, skills, summary, responsibilities, experience, location, full };
}

export function buildJobQdrantPayload(
  profile: JobProfile,
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
    profile.location.city?.value,
    profile.location.state?.value,
    profile.location.country?.value,
  ].filter(Boolean);

  return {
    entityId: profile.jobId,
    entityType: 'job' as const,
    ...embeddingMetadata,
    name: profile.title.value,
    headline: profile.company.value || undefined,
    skills: [
      ...profile.requiredSkills.map(s => s.canonical),
      ...profile.preferredSkills.map(s => s.canonical),
    ],
    location: locationParts.join(', ') || undefined,
    experienceYears: profile.experience.maximumYears?.value ? parseInt(profile.experience.maximumYears.value, 10) || undefined : undefined,
    educationLevel: profile.education.educationLevel?.value || undefined,
    industry: profile.industry.value || undefined,
    employmentType: profile.employmentType.value || undefined,
    seniority: profile.seniority.value || undefined,
  };
}
