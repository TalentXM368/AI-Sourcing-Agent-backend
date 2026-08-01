import { z } from 'zod';

const SourceTrackingSchema = z.object({
  value: z.string(),
  raw: z.string(),
  extractor: z.string(),
  sourceSection: z.string(),
  confidence: z.number().min(0).max(1),
});

const JobSkillEntrySchema = z.object({
  canonical: z.string(),
  raw: z.string(),
  category: z.string(),
  confidence: z.number().min(0).max(1),
});

const JobExperienceRequirementSchema = z.object({
  minimumYears: SourceTrackingSchema.nullable(),
  maximumYears: SourceTrackingSchema.nullable(),
  preferredYears: SourceTrackingSchema.nullable(),
});

const JobEducationRequirementSchema = z.object({
  degree: SourceTrackingSchema.nullable(),
  specialization: SourceTrackingSchema.nullable(),
  educationLevel: SourceTrackingSchema.nullable(),
});

const JobSalarySchema = z.object({
  currency: SourceTrackingSchema.nullable(),
  minimum: SourceTrackingSchema.nullable(),
  maximum: SourceTrackingSchema.nullable(),
  period: SourceTrackingSchema.nullable(),
  raw: SourceTrackingSchema.nullable(),
});

const JobLocationSchema = z.object({
  city: SourceTrackingSchema.nullable(),
  state: SourceTrackingSchema.nullable(),
  country: SourceTrackingSchema.nullable(),
  raw: SourceTrackingSchema.nullable(),
});

const JobMetadataSchema = z.object({
  sourceFileName: z.string().nullable(),
  sourceFileSize: z.number().nullable(),
  mimeType: z.string().nullable(),
  pages: z.number().nullable(),
  hasTables: z.boolean(),
  sectionCount: z.number(),
});

const JobProcessingContextSchema = z.object({
  pipelineVersion: z.string(),
  processingTimeMs: z.number(),
  processedAt: z.string(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  extractorsRun: z.array(z.string()),
  normalizersRun: z.array(z.string()),
});

const JobValidationWarningSchema = z.object({
  field: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
});

const JobValidationResultSchema = z.object({
  warnings: z.array(JobValidationWarningSchema),
  isValid: z.boolean(),
});

const JobQualityScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  fieldConfidence: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  suggestions: z.array(z.string()),
});

export const JobProfileSchema = z.object({
  schemaVersion: z.literal('1.0'),
  jobId: z.string(),

  title: SourceTrackingSchema,
  summary: SourceTrackingSchema,
  company: SourceTrackingSchema,
  industry: SourceTrackingSchema,
  domain: SourceTrackingSchema.nullable(),
  department: SourceTrackingSchema.nullable(),

  employmentType: SourceTrackingSchema,
  workMode: SourceTrackingSchema,
  seniority: SourceTrackingSchema,

  experience: JobExperienceRequirementSchema,
  education: JobEducationRequirementSchema,
  salary: JobSalarySchema,
  location: JobLocationSchema,

  requiredSkills: z.array(JobSkillEntrySchema),
  preferredSkills: z.array(JobSkillEntrySchema),
  certifications: z.array(z.string()),
  languages: z.array(z.string()),

  responsibilities: z.array(z.string()),
  benefits: z.array(z.string()),
  technologies: z.array(z.string()),
  tools: z.array(z.string()),

  workAuthorization: SourceTrackingSchema.nullable(),
  visaSponsorship: SourceTrackingSchema.nullable(),
  travelRequirements: SourceTrackingSchema.nullable(),
  shift: SourceTrackingSchema.nullable(),

  metadata: JobMetadataSchema,
  processing: JobProcessingContextSchema,
  validation: JobValidationResultSchema,
  quality: JobQualityScoreSchema,
});

export type JobProfileOutput = z.infer<typeof JobProfileSchema>;
