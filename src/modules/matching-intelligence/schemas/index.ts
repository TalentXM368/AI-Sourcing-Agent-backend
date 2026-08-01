import { z } from 'zod';

const MatchingWeightsSchema = z.object({
  requiredSkills: z.number().min(0).max(1).optional(),
  semanticSimilarity: z.number().min(0).max(1).optional(),
  experience: z.number().min(0).max(1).optional(),
  education: z.number().min(0).max(1).optional(),
  industry: z.number().min(0).max(1).optional(),
  location: z.number().min(0).max(1).optional(),
  employment: z.number().min(0).max(1).optional(),
  salary: z.number().min(0).max(1).optional(),
}).optional();

const HardFiltersSchema = z.object({
  requiredSkills: z.array(z.string()).optional(),
  minimumExperienceYears: z.number().min(0).optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  employmentType: z.string().optional(),
  workMode: z.string().optional(),
  workAuthorization: z.string().optional(),
  noticePeriodDays: z.number().min(0).optional(),
  salaryRange: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
}).optional();

export const MatchJobSchema = z.object({
  jobId: z.string().uuid(),
  filters: HardFiltersSchema,
  topK: z.number().min(1).max(500).optional(),
  weights: MatchingWeightsSchema,
});

export const MatchCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  filters: HardFiltersSchema,
  topK: z.number().min(1).max(500).optional(),
  weights: MatchingWeightsSchema,
});

export type MatchJobInput = z.infer<typeof MatchJobSchema>;
export type MatchCandidateInput = z.infer<typeof MatchCandidateSchema>;
