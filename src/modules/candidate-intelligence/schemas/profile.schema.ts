import { z } from 'zod';
import {
  ConfidenceSchema,
  SourceTrackingSchema,
  SkillEntrySchema,
  ExperienceEntrySchema,
  EducationEntrySchema,
  ProjectEntrySchema,
  CertificationEntrySchema,
  LanguageEntrySchema,
} from './extraction.schema.js';

const PersonalInfoSchema = z.object({
  name: SourceTrackingSchema,
  headline: SourceTrackingSchema.nullable(),
  summary: z.string(),
});

const ContactInfoSchema = z.object({
  email: SourceTrackingSchema.nullable(),
  phone: SourceTrackingSchema.nullable(),
  linkedin: SourceTrackingSchema.nullable(),
  github: SourceTrackingSchema.nullable(),
  portfolio: SourceTrackingSchema.nullable(),
  website: SourceTrackingSchema.nullable(),
  city: SourceTrackingSchema.nullable(),
  state: SourceTrackingSchema.nullable(),
  country: SourceTrackingSchema.nullable(),
});

const SocialLinksSchema = z.object({
  linkedin: SourceTrackingSchema.nullable(),
  github: SourceTrackingSchema.nullable(),
  portfolio: SourceTrackingSchema.nullable(),
  website: SourceTrackingSchema.nullable(),
});

const TimelineEntrySchema = z.object({
  type: z.enum(['experience', 'education', 'project']),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isCurrent: z.boolean(),
  title: z.string(),
  organization: z.string(),
});

const RawDocumentRefSchema = z.object({
  referenceId: z.string(),
  markdownLength: z.number(),
  plainTextLength: z.number(),
  sectionsCount: z.number(),
});

const ProfileMetadataSchema = z.object({
  resumeLanguage: z.string(),
  pages: z.number(),
  hasTables: z.boolean(),
  hasImages: z.boolean(),
  sectionCount: z.number(),
  sourceFileName: z.string(),
  sourceFileSize: z.number(),
  mimeType: z.string(),
});

const ProcessingContextSchema = z.object({
  parser: z.string(),
  parserVersion: z.string(),
  pipelineVersion: z.string(),
  processingTimeMs: z.number(),
  processedAt: z.string(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  extractorsRun: z.array(z.string()),
  normalizersRun: z.array(z.string()),
  resolversRun: z.array(z.string()),
});

const ValidationWarningSchema = z.object({
  field: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
});

const ValidationResultSchema = z.object({
  warnings: z.array(ValidationWarningSchema),
  isValid: z.boolean(),
});

const CompletenessResultSchema = z.object({
  score: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
  presentFields: z.array(z.string()),
});

export const CandidateProfileSchema = z.object({
  schemaVersion: z.literal('1.0'),
  candidateId: z.string(),
  personal: PersonalInfoSchema,
  contact: ContactInfoSchema,
  skills: z.array(SkillEntrySchema),
  experience: z.array(ExperienceEntrySchema),
  education: z.array(EducationEntrySchema),
  projects: z.array(ProjectEntrySchema),
  certifications: z.array(CertificationEntrySchema),
  languages: z.array(LanguageEntrySchema),
  socialLinks: SocialLinksSchema,
  timeline: z.array(TimelineEntrySchema),
  rawDocument: RawDocumentRefSchema,
  metadata: ProfileMetadataSchema,
  processing: ProcessingContextSchema,
  validation: ValidationResultSchema,
  completeness: CompletenessResultSchema,
});

export type CandidateProfileOutput = z.infer<typeof CandidateProfileSchema>;
