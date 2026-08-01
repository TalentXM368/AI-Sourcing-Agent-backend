export type { Confidence, SourceTracking, ConfidenceBuilder } from './common.types.js';
export { createConfidence, createSourceTracking } from './common.types.js';

export type {
  DoclingSection,
  DoclingTable,
  DoclingMetadata,
  DoclingImage,
  DoclingBlock,
  DoclingAST,
  StructuredDocument,
  ProcessedSection,
} from './input.types.js';

export type {
  ExtractedJobMetadata,
  ExtractedJobSkills,
  ExtractedJobExperience,
  ExtractedJobEducation,
  ExtractedJobCompensation,
  ExtractedJobLocation,
  ExtractedJobClassification,
  ExtractedJobContent,
  MergedJobExtractionResult,
} from './extracted.types.js';

export type {
  JobSkillEntry,
  JobExperienceRequirement,
  JobEducationRequirement,
  JobSalary,
  JobLocation,
  JobMetadata,
  JobProcessingContext,
  JobValidationWarning,
  JobValidationResult,
  JobQualityScore,
  JobProfile,
} from './profile.types.js';
