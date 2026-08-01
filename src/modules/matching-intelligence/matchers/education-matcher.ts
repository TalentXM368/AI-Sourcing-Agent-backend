import type { EducationMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';

const EDUCATION_LEVELS: Record<string, number> = {
  secondary: 1,
  associate: 2,
  bachelor: 3,
  master: 4,
  doctorate: 5,
  certificate: 2,
};

function inferEducationLevel(degree: string): number {
  const lower = degree.toLowerCase();
  if (lower.includes('phd') || lower.includes('doctorate') || lower.includes('doctoral')) return 5;
  if (lower.includes('master') || lower.includes('mba') || lower.includes('m.s.') || lower.includes('m.a.')) return 4;
  if (lower.includes('bachelor') || lower.includes('b.s.') || lower.includes('b.a.') || lower.includes('b.e.')) return 3;
  if (lower.includes('associate')) return 2;
  if (lower.includes('diploma') || lower.includes('certificate') || lower.includes('certification')) return 2;
  return 1;
}

function matchSpecialization(candidateSpec: string, jobSpec: string): boolean {
  const cLower = candidateSpec.toLowerCase();
  const jLower = jobSpec.toLowerCase();
  if (cLower === jLower) return true;
  if (cLower.includes(jLower) || jLower.includes(cLower)) return true;

  const relatedSpecs: Record<string, string[]> = {
    'computer science': ['software engineering', 'computer engineering', 'information technology'],
    'software engineering': ['computer science', 'computer engineering'],
    'data science': ['statistics', 'machine learning', 'computer science'],
    'electrical engineering': ['electronics', 'computer engineering'],
    'business': ['mba', 'management', 'finance'],
    'information technology': ['computer science', 'information systems'],
  };

  const cRelated = relatedSpecs[cLower] || [];
  return cRelated.includes(jLower);
}

export function matchEducation(
  job: JobProfile,
  candidate: CandidateProfile,
): EducationMatchResult {
  const jobLevel = job.education.educationLevel?.value
    ? EDUCATION_LEVELS[job.education.educationLevel.value.toLowerCase()] || 0
    : 0;
  const jobDegree = job.education.degree?.value || '';
  const jobSpec = job.education.specialization?.value || '';

  let candidateMaxLevel = 0;
  let specializationMatch = false;
  let certificationsMet = true;

  for (const edu of candidate.education) {
    const level = inferEducationLevel(edu.degree.value);
    if (level > candidateMaxLevel) candidateMaxLevel = level;

    if (jobSpec && edu.specialization?.value) {
      if (matchSpecialization(edu.specialization.value, jobSpec)) {
        specializationMatch = true;
      }
    }
  }

  if (job.certifications?.length) {
    const candidateCerts = candidate.certifications.map(c => c.name.value.toLowerCase());
    const jobCertsLower = job.certifications.map(c => c.toLowerCase());
    const metCount = jobCertsLower.filter(c =>
      candidateCerts.some(cc => cc.includes(c) || c.includes(cc)),
    ).length;
    certificationsMet = metCount >= jobCertsLower.length * 0.5;
  }

  const levelMatch = jobLevel > 0 ? candidateMaxLevel >= jobLevel : true;

  let score = 50;
  if (levelMatch) score += 30;
  else {
    const deficit = jobLevel - candidateMaxLevel;
    score -= deficit * 15;
  }
  if (specializationMatch) score += 10;
  if (certificationsMet) score += 10;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    levelMatch,
    specializationMatch,
    certificationsMet,
  };
}
