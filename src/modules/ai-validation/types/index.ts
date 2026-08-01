import type { ResolvedCandidateProfile } from '../../candidate-resolution/types/index.js';

export interface AIValidationResult {
  fieldName: string;
  originalValue: string;
  suggestedValue: string;
  confidence: number;
  reason: string;
  action: 'keep' | 'replace' | 'flag_for_review';
  promptVersion: string;
}

export interface AIEnrichmentResult {
  fieldName: string;
  value: string;
  confidence: number;
  reason: string;
  promptVersion: string;
}

export interface AuditEntry {
  fieldName: string;
  originalValue: string;
  suggestedValue: string;
  confidenceBefore: number;
  confidenceAfter: number;
  reason: string;
  provider: string;
  model: string;
  promptVersion: string;
  timestamp: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface ValidationContext {
  fieldName: string;
  currentValue: string;
  confidence: number;
  nearbyText: string;
  alternatives: string[];
  candidateName: string;
  entryIndex?: number;
}

export interface EnrichmentContext {
  candidateName: string;
  skills: string[];
  jobTitles: string[];
  companies: string[];
  summary: string;
  degree: string | null;
  yearsOfExperience: number | null;
}

export interface ValidationMetadata {
  validatedAt: string;
  validationTimeMs: number;
  fieldsSentToAI: number;
  fieldsAccepted: number;
  fieldsRejected: number;
  fieldsFlaggedForReview: number;
  enrichmentFieldsGenerated: number;
  providerUsed: string;
  modelUsed: string;
  totalTokensUsed: number;
  totalCostEstimate: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface ValidatedCandidateProfile extends ResolvedCandidateProfile {
  enrichment: EnrichmentData;
  validationMetadata: ValidationMetadata;
  auditTrail: AuditEntry[];
  fieldsNeedingReview: string[];
}

export interface EnrichmentData {
  industry: string | null;
  domain: string | null;
  seniority: string | null;
  primaryRole: string | null;
  secondaryRoles: string[];
  technologyStack: string[];
  functionalArea: string | null;
  headline: string | null;
  summary: string | null;
}

export interface ValidationOptions {
  skipFields?: string[];
  forceFields?: string[];
  dryRun?: boolean;
  enableEnrichment?: boolean;
}

export interface ValidationRequest {
  profile: ResolvedCandidateProfile;
  options?: ValidationOptions;
}

export interface ValidationResponse {
  success: boolean;
  data: ValidatedCandidateProfile;
  metadata: ValidationMetadata;
}
