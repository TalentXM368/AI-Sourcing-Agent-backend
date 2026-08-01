import { describe, it, expect } from 'vitest';
import { MatchJobSchema, MatchCandidateSchema } from '../schemas/index.js';

describe('MatchJobSchema', () => {
  it('validates valid job match request', () => {
    const result = MatchJobSchema.safeParse({
      jobId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = MatchJobSchema.safeParse({
      jobId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('validates with all optional fields', () => {
    const result = MatchJobSchema.safeParse({
      jobId: '550e8400-e29b-41d4-a716-446655440000',
      filters: { country: 'US' },
      topK: 50,
      weights: { requiredSkills: 0.5 },
    });
    expect(result.success).toBe(true);
  });

  it('validates with filters', () => {
    const result = MatchJobSchema.safeParse({
      jobId: '550e8400-e29b-41d4-a716-446655440000',
      filters: {
        requiredSkills: ['javascript'],
        minimumExperienceYears: 3,
        country: 'US',
        state: 'CA',
        city: 'SF',
        employmentType: 'full-time',
        workMode: 'remote',
        workAuthorization: 'us-citizen',
        noticePeriodDays: 30,
        salaryRange: { min: 100000, max: 200000 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects topK > 500', () => {
    const result = MatchJobSchema.safeParse({
      jobId: '550e8400-e29b-41d4-a716-446655440000',
      topK: 501,
    });
    expect(result.success).toBe(false);
  });
});

describe('MatchCandidateSchema', () => {
  it('validates valid candidate match request', () => {
    const result = MatchCandidateSchema.safeParse({
      candidateId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    const result = MatchCandidateSchema.safeParse({
      candidateId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('validates with all optional fields', () => {
    const result = MatchCandidateSchema.safeParse({
      candidateId: '550e8400-e29b-41d4-a716-446655440000',
      filters: { country: 'US' },
      topK: 50,
      weights: { requiredSkills: 0.5 },
    });
    expect(result.success).toBe(true);
  });
});
