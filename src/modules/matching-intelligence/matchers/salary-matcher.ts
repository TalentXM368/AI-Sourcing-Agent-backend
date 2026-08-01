import type { SalaryMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export function matchSalary(job: JobProfile): SalaryMatchResult {
  const salaryMin = job.salary.minimum?.value ? parseFloat(job.salary.minimum.value) : null;
  const salaryMax = job.salary.maximum?.value ? parseFloat(job.salary.maximum.value) : null;

  if (salaryMin === null && salaryMax === null) {
    return { score: 70, overlap: true, overlapPercentage: 100 };
  }

  if (salaryMin !== null || salaryMax !== null) {
    return { score: 70, overlap: true, overlapPercentage: 100 };
  }

  return { score: 70, overlap: true, overlapPercentage: 100 };
}

export function matchSalaryWithExpectation(
  job: JobProfile,
  expectedSalaryMin: number,
  expectedSalaryMax: number,
): SalaryMatchResult {
  const jobMin = job.salary.minimum?.value ? parseFloat(job.salary.minimum.value) : null;
  const jobMax = job.salary.maximum?.value ? parseFloat(job.salary.maximum.value) : null;

  if (jobMin === null && jobMax === null) {
    return { score: 70, overlap: true, overlapPercentage: 100 };
  }

  const effectiveMin = jobMin || 0;
  const effectiveMax = jobMax || Infinity;

  const overlapMin = Math.max(effectiveMin, expectedSalaryMin);
  const overlapMax = Math.min(effectiveMax, expectedSalaryMax);

  if (overlapMin > overlapMax) {
    return { score: 20, overlap: false, overlapPercentage: 0 };
  }

  const overlapRange = overlapMax - overlapMin;
  const totalRange = Math.max(effectiveMax, expectedSalaryMax) - Math.min(effectiveMin, expectedSalaryMin);
  const overlapPercentage = totalRange > 0 ? (overlapRange / totalRange) * 100 : 100;

  const score = Math.round(50 + (overlapPercentage / 100) * 50);

  return {
    score: Math.max(0, Math.min(100, score)),
    overlap: true,
    overlapPercentage: Math.round(overlapPercentage),
  };
}
