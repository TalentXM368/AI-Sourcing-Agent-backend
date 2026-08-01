import type { ResolvedCandidateProfile } from '../../candidate-resolution/types/index.js';
import type { ResolvedField } from '../../candidate-resolution/interfaces/index.js';
import type {
  ValidationOptions,
  ValidatedCandidateProfile,
  ValidationMetadata,
  AuditEntry,
  EnrichmentData,
  AIValidationResult,
  ValidationContext,
} from '../types/index.js';
import { AI_VALIDATION_VERSION, AI_VALIDATABLE_FIELDS, CONFIDENCE_THRESHOLDS } from '../constants/index.js';
import { ConfidenceAnalyzer } from './confidence-analyzer.js';
import { PromptBuilder } from './prompt-builder.js';
import { ResponseValidator } from './response-validator.js';
import { MergeEngine } from './merge-engine.js';
import { EnrichmentService } from './enrichment.service.js';
import { CacheService } from './cache.service.js';
import { AuditService } from './audit.service.js';
import { AIRouter } from '../providers/router.js';

const DEFAULT_OPTIONS: Required<ValidationOptions> = {
  skipFields: [],
  forceFields: [],
  dryRun: false,
  enableEnrichment: true,
};

export class ValidationService {
  private confidenceAnalyzer: ConfidenceAnalyzer;
  private promptBuilder: PromptBuilder;
  private responseValidator: ResponseValidator;
  private mergeEngine: MergeEngine;
  private enrichmentService: EnrichmentService;
  private cache: CacheService;
  private auditService: AuditService;
  private router: AIRouter;

  constructor() {
    this.confidenceAnalyzer = new ConfidenceAnalyzer();
    this.promptBuilder = new PromptBuilder();
    this.responseValidator = new ResponseValidator();
    this.mergeEngine = new MergeEngine();
    this.cache = new CacheService();
    this.auditService = new AuditService();
    this.router = new AIRouter();
    this.enrichmentService = new EnrichmentService(this.router, this.cache);
  }

  async validate(
    profile: ResolvedCandidateProfile,
    options?: ValidationOptions,
  ): Promise<ValidatedCandidateProfile> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    this.auditService.clear();

    const fieldsNeedingReview: string[] = [];

    const validationContexts = this.confidenceAnalyzer.analyze(profile, {
      skipFields: opts.skipFields,
      forceFields: opts.forceFields,
    });

    const auditEntries: AuditEntry[] = [];
    let fieldsAccepted = 0;
    let fieldsRejected = 0;
    let fieldsFlaggedForReview = 0;
    let totalTokensUsed = 0;

    for (const ctx of validationContexts) {
      const result = await this.validateField(ctx, opts.dryRun);

      if (result) {
        const existing = this.findField(profile, ctx.fieldName);
        if (existing) {
          const mergeResult = this.mergeEngine.mergeField(existing.field, result);
          this.setField(profile, ctx.fieldName, mergeResult.field);

          if (mergeResult.accepted) fieldsAccepted++;
          else fieldsRejected++;

          const auditEntry: AuditEntry = {
            ...mergeResult.auditEntry,
            provider: this.router.lastProvider,
          };
          auditEntries.push(auditEntry);
          this.auditService.record(auditEntry);
          totalTokensUsed += result.confidence > 0 ? 1 : 0;

          if (this.isLowConfidence(existing.field, result)) {
            fieldsFlaggedForReview++;
            fieldsNeedingReview.push(ctx.fieldName);
          }
        }
      }
    }

    let enrichment: EnrichmentData = {
      industry: null,
      domain: null,
      seniority: null,
      primaryRole: null,
      secondaryRoles: [],
      technologyStack: [],
      functionalArea: null,
      headline: null,
      summary: null,
    };

    let enrichmentTokens = 0;
    let enrichmentProvider = '';

    if (opts.enableEnrichment) {
      const enrichResult = await this.enrichmentService.generateEnrichment(profile, opts.dryRun);
      enrichment = enrichResult.enrichment;
      enrichmentTokens = enrichResult.metadata.tokensUsed;
      enrichmentProvider = enrichResult.metadata.providerUsed;
      totalTokensUsed += enrichmentTokens;
    }

    const validationTimeMs = Date.now() - startTime;
    const cacheStats = this.cache.stats;

    const metadata: ValidationMetadata = {
      validatedAt: new Date().toISOString(),
      validationTimeMs,
      fieldsSentToAI: validationContexts.length,
      fieldsAccepted,
      fieldsRejected,
      fieldsFlaggedForReview,
      enrichmentFieldsGenerated: this.countNonEmptyEnrichment(enrichment),
      providerUsed: enrichmentProvider || this.router.lastProvider,
      modelUsed: '',
      totalTokensUsed,
      totalCostEstimate: 0,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
    };

    return {
      ...profile,
      enrichment,
      validationMetadata: metadata,
      auditTrail: auditEntries,
      fieldsNeedingReview,
    };
  }

  private async validateField(ctx: ValidationContext, dryRun: boolean): Promise<AIValidationResult | null> {
    if (dryRun) {
      return {
        fieldName: ctx.fieldName,
        originalValue: ctx.currentValue,
        suggestedValue: ctx.currentValue,
        confidence: ctx.confidence,
        reason: 'dry-run',
        action: 'keep',
        promptVersion: this.promptBuilder.getPromptVersion(ctx.fieldName),
      };
    }

    const cacheKey = this.cache.buildKey(ctx.fieldName, ctx.currentValue, ctx.nearbyText);
    const cached = this.cache.get<AIValidationResult>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const systemPrompt = this.promptBuilder.buildSystemPrompt();
      const userPrompt = this.promptBuilder.buildValidationPrompt(ctx);
      const response = await this.router.route(systemPrompt, userPrompt);
      const validated = this.responseValidator.validateResponse(response.content, ctx.fieldName);

      if (!validated) return null;

      validated.originalValue = ctx.currentValue;
      validated.confidence = response.content ? validated.confidence : ctx.confidence;

      if (this.responseValidator.isHallucination(validated.suggestedValue, ctx.currentValue)) {
        return null;
      }

      this.cache.set(cacheKey, validated);
      return validated;
    } catch (error) {
      console.error(`[ValidationService] Error validating field ${ctx.fieldName}:`, error);
      return null;
    }
  }

  private findField(
    profile: ResolvedCandidateProfile,
    fieldName: string,
  ): { field: ResolvedField<unknown>; setField: (value: ResolvedField<unknown>) => void } | null {
    const parts = fieldName.replace(/\[\d+\]/g, '').split('.');
    const indexMatch = fieldName.match(/\[(\d+)\]/);
    const index = indexMatch ? parseInt(indexMatch[1], 10) : undefined;

    if (parts[0] === 'personal') {
      if (parts[1] === 'name') return { field: profile.personal.name, setField: (v) => { (profile.personal as unknown as Record<string, unknown>).name = v; } };
      if (parts[1] === 'headline') return { field: profile.personal.headline!, setField: (v) => { (profile.personal as unknown as Record<string, unknown>).headline = v; } };
    }

    if (parts[0] === 'contact') {
      const key = parts[1] as keyof typeof profile.contact;
      const val = profile.contact[key];
      if (val) return { field: val as ResolvedField<unknown>, setField: (v) => { (profile.contact as unknown as Record<string, unknown>)[key as string] = v; } };
    }

    if (parts[0] === 'experience' && index !== undefined) {
      const exp = profile.experience[index];
      if (!exp) return null;
      if (parts[1] === 'company') return { field: exp.company, setField: (v) => { exp.company = v as ResolvedField<string>; } };
      if (parts[1] === 'title') return { field: exp.title, setField: (v) => { exp.title = v as ResolvedField<string>; } };
    }

    if (parts[0] === 'education' && index !== undefined) {
      const edu = profile.education[index];
      if (!edu) return null;
      if (parts[1] === 'degree') return { field: edu.degree, setField: (v) => { edu.degree = v as ResolvedField<string>; } };
      if (parts[1] === 'specialization') return { field: edu.specialization!, setField: (v) => { (edu as unknown as Record<string, unknown>).specialization = v; } };
      if (parts[1] === 'university') return { field: edu.university, setField: (v) => { edu.university = v as ResolvedField<string>; } };
    }

    if (parts[0] === 'projects' && index !== undefined) {
      const proj = profile.projects[index];
      if (!proj) return null;
      if (parts[1] === 'name') return { field: proj.name, setField: (v) => { proj.name = v as ResolvedField<string>; } };
      if (parts[1] === 'description') return { field: proj.description!, setField: (v) => { (proj as unknown as Record<string, unknown>).description = v; } };
    }

    if (parts[0] === 'certifications' && index !== undefined) {
      const cert = profile.certifications[index];
      if (!cert) return null;
      if (parts[1] === 'name') return { field: cert.name, setField: (v) => { cert.name = v as ResolvedField<string>; } };
      if (parts[1] === 'issuer') return { field: cert.issuer!, setField: (v) => { (cert as unknown as Record<string, unknown>).issuer = v; } };
    }

    if (parts[0] === 'languages' && index !== undefined) {
      const lang = profile.languages[index];
      if (!lang) return null;
      if (parts[1] === 'name') return { field: lang.name, setField: (v) => { lang.name = v as ResolvedField<string>; } };
    }

    if (parts[0] === 'skills' && index !== undefined) {
      const skill = profile.skills[index];
      if (!skill) return null;
      return { field: skill as unknown as ResolvedField<unknown>, setField: (v) => { profile.skills[index] = v as ResolvedField<string>; } };
    }

    return null;
  }

  private setField(
    profile: ResolvedCandidateProfile,
    fieldName: string,
    value: ResolvedField<unknown>,
  ): void {
    const found = this.findField(profile, fieldName);
    if (found) {
      found.setField(value);
    }
  }

  private isLowConfidence(original: ResolvedField<unknown>, aiResult: AIValidationResult): boolean {
    return original.confidence < CONFIDENCE_THRESHOLDS.VALIDATE && aiResult.action === 'replace';
  }

  private countNonEmptyEnrichment(enrichment: EnrichmentData): number {
    let count = 0;
    if (enrichment.industry) count++;
    if (enrichment.domain) count++;
    if (enrichment.seniority) count++;
    if (enrichment.primaryRole) count++;
    if (enrichment.secondaryRoles.length > 0) count++;
    if (enrichment.technologyStack.length > 0) count++;
    if (enrichment.functionalArea) count++;
    if (enrichment.headline) count++;
    if (enrichment.summary) count++;
    return count;
  }
}
