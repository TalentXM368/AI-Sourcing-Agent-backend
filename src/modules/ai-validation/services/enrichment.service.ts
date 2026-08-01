import type { ResolvedCandidateProfile } from '../../candidate-resolution/types/index.js';
import type { EnrichmentData, EnrichmentContext } from '../types/index.js';
import { buildEnrichmentPrompt } from '../prompts/index.js';
import { ENRICHMENT_SCHEMA } from '../schemas/index.js';
import { CONFIDENCE_THRESHOLDS, AI_VALIDATION_VERSION } from '../constants/index.js';
import { AIRouter } from '../providers/router.js';
import { CacheService } from './cache.service.js';

export class EnrichmentService {
  private router: AIRouter;
  private cache: CacheService;

  constructor(router?: AIRouter, cache?: CacheService) {
    this.router = router || new AIRouter();
    this.cache = cache || new CacheService();
  }

  async generateEnrichment(
    profile: ResolvedCandidateProfile,
    dryRun = false,
  ): Promise<{ enrichment: EnrichmentData; metadata: { providerUsed: string; tokensUsed: number; cached: boolean; skipped: boolean } }> {
    const emptyEnrichment: EnrichmentData = {
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

    const shouldSkip = this.shouldSkipEnrichment(profile);
    if (shouldSkip) {
      return {
        enrichment: emptyEnrichment,
        metadata: { providerUsed: '', tokensUsed: 0, cached: false, skipped: true },
      };
    }

    const ctx = this.buildContext(profile);
    const cacheKey = this.cache.buildKey(
      'enrichment',
      JSON.stringify(ctx),
      profile.personal.name?.value || '',
    );

    const cached = this.cache.get<EnrichmentData>(cacheKey);
    if (cached) {
      return {
        enrichment: cached,
        metadata: { providerUsed: 'cache', tokensUsed: 0, cached: true, skipped: false },
      };
    }

    if (dryRun) {
      return {
        enrichment: emptyEnrichment,
        metadata: { providerUsed: 'dry-run', tokensUsed: 0, cached: false, skipped: false },
      };
    }

    try {
      const systemPrompt = 'You are a professional resume enrichment assistant. Respond only with valid JSON.';
      const userPrompt = buildEnrichmentPrompt(ctx);
      const response = await this.router.route(systemPrompt, userPrompt);
      const parsed = JSON.parse(response.content);
      const validation = ENRICHMENT_SCHEMA.safeParse(parsed);

      if (!validation.success) {
        return {
          enrichment: emptyEnrichment,
          metadata: {
            providerUsed: response.provider,
            tokensUsed: response.tokensUsed,
            cached: false,
            skipped: false,
          },
        };
      }

      const enrichment: EnrichmentData = {
        industry: validation.data.industry,
        domain: validation.data.domain,
        seniority: validation.data.seniority,
        primaryRole: validation.data.primaryRole,
        secondaryRoles: validation.data.secondaryRoles,
        technologyStack: validation.data.technologyStack,
        functionalArea: validation.data.functionalArea,
        headline: validation.data.headline,
        summary: validation.data.summary,
      };

      this.cache.set(cacheKey, enrichment);

      return {
        enrichment,
        metadata: {
          providerUsed: response.provider,
          tokensUsed: response.tokensUsed,
          cached: false,
          skipped: false,
        },
      };
    } catch (error) {
      console.error('[EnrichmentService] Error generating enrichment:', error);
      return {
        enrichment: emptyEnrichment,
        metadata: { providerUsed: '', tokensUsed: 0, cached: false, skipped: false },
      };
    }
  }

  private shouldSkipEnrichment(profile: ResolvedCandidateProfile): boolean {
    const hasAnySkill = profile.skills.some(
      s => s.value && s.confidence >= CONFIDENCE_THRESHOLDS.ENRICHMENT_MIN_SOURCE,
    );
    const hasAnyTitle = profile.experience.some(
      e => e.title?.value && e.title.confidence >= CONFIDENCE_THRESHOLDS.ENRICHMENT_MIN_SOURCE,
    );
    return !hasAnySkill && !hasAnyTitle;
  }

  private buildContext(profile: ResolvedCandidateProfile): EnrichmentContext {
    return {
      candidateName: profile.personal.name?.value || 'Unknown',
      skills: profile.skills
        .filter(s => s.value && s.confidence >= CONFIDENCE_THRESHOLDS.ENRICHMENT_MIN_SOURCE)
        .map(s => String(s.value)),
      jobTitles: profile.experience
        .filter(e => e.title?.value && e.title.confidence >= CONFIDENCE_THRESHOLDS.ENRICHMENT_MIN_SOURCE)
        .map(e => String(e.title.value)),
      companies: profile.experience
        .filter(e => e.company?.value && e.company.confidence >= CONFIDENCE_THRESHOLDS.ENRICHMENT_MIN_SOURCE)
        .map(e => String(e.company.value)),
      summary: profile.personal.summary,
      degree: profile.education.length > 0
        ? String(profile.education[0].degree?.value || '')
        : null,
      yearsOfExperience: this.estimateYearsOfExperience(profile),
    };
  }

  private estimateYearsOfExperience(profile: ResolvedCandidateProfile): number | null {
    const now = new Date();
    let earliestYear = now.getFullYear();

    for (const exp of profile.experience) {
      if (exp.startDate?.value) {
        const year = this.parseYear(String(exp.startDate.value));
        if (year && year < earliestYear) {
          earliestYear = year;
        }
      }
    }

    if (earliestYear === now.getFullYear()) return null;
    return now.getFullYear() - earliestYear;
  }

  private parseYear(value: string): number | null {
    const match = value.match(/\b(19|20)\d{2}\b/);
    return match ? parseInt(match[0], 10) : null;
  }
}
