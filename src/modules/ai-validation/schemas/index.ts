export {
  BaseValidationResultSchema,
  ValidationActionSchema,
  NameValidationSchema,
  CompanyValidationSchema,
  JobTitleValidationSchema,
  SkillValidationSchema,
  EducationValidationSchema,
  ProjectValidationSchema,
  CertificationValidationSchema,
  LanguageValidationSchema,
  SCHEMA_REGISTRY,
} from './base.schema.js';

export type {
  BaseValidationResult,
  ValidationAction,
  NameValidation,
  CompanyValidation,
  JobTitleValidation,
  SkillValidation,
  EducationValidation,
  ProjectValidation,
  CertificationValidation,
  LanguageValidation,
} from './base.schema.js';

export { EnrichmentResultSchema, ENRICHMENT_SCHEMA } from './enrichment.schema.js';
export type { EnrichmentResult } from './enrichment.schema.js';
