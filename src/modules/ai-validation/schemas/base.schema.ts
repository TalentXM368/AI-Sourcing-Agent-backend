import { z } from 'zod';

export const ValidationActionSchema = z.enum(['keep', 'replace', 'flag_for_review']);
export type ValidationAction = z.infer<typeof ValidationActionSchema>;

export const BaseValidationResultSchema = z.object({
  fieldName: z.string().min(1),
  originalValue: z.string(),
  suggestedValue: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  action: ValidationActionSchema,
});
export type BaseValidationResult = z.infer<typeof BaseValidationResultSchema>;

export const NameValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.literal('personal.name'),
});
export type NameValidation = z.infer<typeof NameValidationSchema>;

export const CompanyValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.literal('experience.company'),
});
export type CompanyValidation = z.infer<typeof CompanyValidationSchema>;

export const JobTitleValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.literal('experience.title'),
});
export type JobTitleValidation = z.infer<typeof JobTitleValidationSchema>;

export const SkillValidationSchema = z.object({
  fieldName: z.literal('skills'),
  skills: z.array(z.object({
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    action: ValidationActionSchema,
  })),
  reason: z.string().min(1),
});
export type SkillValidation = z.infer<typeof SkillValidationSchema>;

export const EducationValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.enum(['education.degree', 'education.specialization', 'education.university']),
});
export type EducationValidation = z.infer<typeof EducationValidationSchema>;

export const ProjectValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.enum(['projects.name', 'projects.description']),
});
export type ProjectValidation = z.infer<typeof ProjectValidationSchema>;

export const CertificationValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.enum(['certifications.name', 'certifications.issuer']),
});
export type CertificationValidation = z.infer<typeof CertificationValidationSchema>;

export const LanguageValidationSchema = BaseValidationResultSchema.extend({
  fieldName: z.literal('languages.name'),
});
export type LanguageValidation = z.infer<typeof LanguageValidationSchema>;

export const SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  'personal.name': NameValidationSchema,
  'personal.headline': BaseValidationResultSchema,
  'experience.company': CompanyValidationSchema,
  'experience.title': JobTitleValidationSchema,
  'education.degree': EducationValidationSchema,
  'education.specialization': EducationValidationSchema,
  'education.university': EducationValidationSchema,
  'projects.name': ProjectValidationSchema,
  'projects.description': ProjectValidationSchema,
  'certifications.name': CertificationValidationSchema,
  'certifications.issuer': CertificationValidationSchema,
  'languages.name': LanguageValidationSchema,
  'skills': SkillValidationSchema,
};
