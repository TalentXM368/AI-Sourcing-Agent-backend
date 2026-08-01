import { z } from 'zod';

export const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
});

export const SourceTrackingSchema = z.object({
  raw: z.string(),
  value: z.string(),
  extractor: z.string(),
  sourceSection: z.string(),
  confidence: ConfidenceSchema,
});

export const SkillEntrySchema = z.object({
  canonical: z.string(),
  raw: z.string(),
  category: z.string(),
  confidence: ConfidenceSchema,
});

export const ExperienceEntrySchema = z.object({
  company: SourceTrackingSchema,
  title: SourceTrackingSchema,
  employmentType: SourceTrackingSchema.nullable(),
  startDate: SourceTrackingSchema.nullable(),
  endDate: SourceTrackingSchema.nullable(),
  isCurrent: z.boolean(),
  durationMonths: z.number(),
  responsibilities: z.array(z.string()),
});

export const EducationEntrySchema = z.object({
  degree: SourceTrackingSchema,
  specialization: SourceTrackingSchema.nullable(),
  university: SourceTrackingSchema,
  graduationYear: SourceTrackingSchema.nullable(),
  educationLevel: SourceTrackingSchema.nullable(),
});

export const ProjectEntrySchema = z.object({
  name: SourceTrackingSchema,
  description: SourceTrackingSchema.nullable(),
  technologies: z.array(z.string()),
  url: SourceTrackingSchema.nullable(),
});

export const CertificationEntrySchema = z.object({
  name: SourceTrackingSchema,
  issuer: SourceTrackingSchema.nullable(),
  date: SourceTrackingSchema.nullable(),
});

export const LanguageEntrySchema = z.object({
  name: SourceTrackingSchema,
  proficiency: SourceTrackingSchema.nullable(),
});
