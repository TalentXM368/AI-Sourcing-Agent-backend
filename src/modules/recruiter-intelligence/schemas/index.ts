import { z } from 'zod';

const SkillSchema = z.object({
  canonical: z.string(),
  raw: z.string(),
  category: z.string(),
  confidence: z.union([z.number(), z.object({ score: z.number(), reasons: z.array(z.string()) })]),
}).passthrough();

const StringField = z.object({
  raw: z.string(),
  value: z.string(),
  extractor: z.string(),
  sourceSection: z.string(),
  confidence: z.object({
    score: z.number(),
    reasons: z.array(z.string()),
  }),
}).passthrough();

const CandidateProfileSchema = z.object({
  schemaVersion: z.string(),
  candidateId: z.string(),
  personal: z.object({
    name: StringField,
    headline: StringField.nullable(),
    summary: z.string(),
  }),
  contact: z.object({
    email: StringField.nullable(),
    phone: StringField.nullable(),
    linkedin: StringField.nullable(),
    github: StringField.nullable(),
    portfolio: StringField.nullable(),
    website: StringField.nullable(),
    city: StringField.nullable(),
    state: StringField.nullable(),
    country: StringField.nullable(),
  }),
  skills: z.array(SkillSchema),
  experience: z.array(z.object({
    company: StringField,
    title: StringField,
    employmentType: StringField.nullable(),
    startDate: StringField.nullable(),
    endDate: StringField.nullable(),
    isCurrent: z.boolean(),
    durationMonths: z.number(),
    responsibilities: z.array(z.string()),
  }).passthrough()),
  education: z.array(z.object({
    degree: StringField,
    specialization: StringField.nullable(),
    university: StringField,
    graduationYear: StringField.nullable(),
    educationLevel: StringField.nullable(),
  }).passthrough()),
  completeness: z.object({
    score: z.number(),
    missingFields: z.array(z.string()),
    presentFields: z.array(z.string()),
  }).optional(),
}).passthrough();

const JobProfileSchema = z.object({
  schemaVersion: z.string(),
  jobId: z.string(),
  title: StringField,
  summary: StringField,
  company: StringField,
  industry: StringField,
  domain: z.any().nullable(),
  department: z.any().nullable(),
  employmentType: StringField,
  workMode: StringField,
  seniority: StringField,
  experience: z.object({
    minimumYears: z.any().nullable(),
    maximumYears: z.any().nullable(),
    preferredYears: z.any().nullable(),
  }),
  education: z.object({
    degree: z.any().nullable(),
    specialization: z.any().nullable(),
    educationLevel: z.any().nullable(),
  }),
  salary: z.object({
    currency: z.any().nullable(),
    minimum: z.any().nullable(),
    maximum: z.any().nullable(),
    period: z.any().nullable(),
    raw: z.any().nullable(),
  }),
  location: z.object({
    city: z.any().nullable(),
    state: z.any().nullable(),
    country: z.any().nullable(),
    raw: z.any().nullable(),
  }),
  requiredSkills: z.array(SkillSchema),
  preferredSkills: z.array(SkillSchema),
}).passthrough();

const ShortlistedCandidateSchema = z.object({
  candidateProfile: CandidateProfileSchema,
  matchScore: z.number().min(0).max(100),
  semanticScore: z.number().min(0).max(1),
  skillScore: z.number().min(0).max(100),
  experienceScore: z.number().min(0).max(100),
  educationScore: z.number().min(0).max(100),
  locationScore: z.number().min(0).max(100),
  industryScore: z.number().min(0).max(100),
  employmentScore: z.number().min(0).max(100),
  salaryScore: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  additionalSkills: z.array(z.string()),
  hardFilterPassed: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const RecruiterAIInputSchema = z.object({
  jobProfile: JobProfileSchema,
  shortlistedCandidates: z.array(ShortlistedCandidateSchema).min(1).max(50),
});

export const RecruiterAIOptionsSchema = z.object({
  maxCandidates: z.number().min(1).max(50).optional().default(10),
  reranker: z.enum(['cohere', 'local-bge', 'local-jina', 'none']).optional().default('cohere'),
  provider: z.enum(['openai', 'claude', 'gemini', 'groq', 'auto']).optional().default('auto'),
  includeMetadata: z.boolean().optional().default(true),
});

export const RecruiterAIRequestSchema = z.object({
  input: RecruiterAIInputSchema,
  options: RecruiterAIOptionsSchema.optional(),
});

export type RecruiterAIInputValidated = z.infer<typeof RecruiterAIInputSchema>;
export type RecruilerAIOptionsValidated = z.infer<typeof RecruiterAIOptionsSchema>;
export type RecruiterAIRequestValidated = z.infer<typeof RecruiterAIRequestSchema>;
