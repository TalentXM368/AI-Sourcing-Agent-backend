import type { RecruiterAIInput, ShortlistedCandidate, RecruiterAIOptions } from '../types/input.types.js';
import type { RecruiterAIOutput as EvaluationOutput, DetailSummary, RecruiterEvaluation } from '../types/evaluation.types.js';
import type { RerankerProvider } from '../types/provider.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import { RerankingService } from './reranking-service.js';
import { LLMService } from './llm-service.js';
import { calculateDisplayScore, deriveConfidenceLevel } from './score-adjustment.js';
import { buildReasoning } from './reasoning-builder.js';
import { buildEvaluationPrompt } from '../prompts/evaluation-prompt.js';
import { RECRUITER_CONSTANTS } from '../constants/index.js';

// Type assertion helpers - types come from existing pipeline, not Zod validation
function asJobProfile(data: unknown): JobProfile {
  return data as JobProfile;
}

function asCandidateProfile(data: unknown): CandidateProfile {
  return data as CandidateProfile;
}

function asShortlistedCandidate(data: unknown): ShortlistedCandidate {
  return data as ShortlistedCandidate;
}

export class EvaluationService {
  private rerankingService: RerankingService;
  private llmService: LLMService;
  private currentOptions: RecruiterAIOptions = {};

  constructor(reranker: RerankerProvider | null, llmService: LLMService) {
    this.rerankingService = new RerankingService(reranker);
    this.llmService = llmService;
  }

  async evaluate(
    input: RecruiterAIInput,
    options?: RecruiterAIOptions,
  ): Promise<EvaluationOutput> {
    const startTime = Date.now();
    this.currentOptions = options || {};
    const maxCandidates = this.currentOptions.maxCandidates || 10;

    const jobProfile = asJobProfile(input.jobProfile);
    const candidates = input.shortlistedCandidates
      .slice(0, maxCandidates)
      .map(c => asShortlistedCandidate(c));

    const crossEncoderResults = await this.rerankingService.rerank(
      jobProfile,
      candidates,
    );

    const evaluations: RecruiterEvaluation[] = [];
    let totalTokens = 0;

    const concurrencyLimit = RECRUITER_CONSTANTS.concurrency.maxLLMCalls;
    const chunks = this.chunkArray(candidates, concurrencyLimit);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(candidate => this.evaluateCandidate(
          jobProfile,
          candidate,
          crossEncoderResults,
        )),
      );

      for (const result of chunkResults) {
        evaluations.push(result.evaluation);
        totalTokens += result.tokensUsed;
      }
    }

    evaluations.sort((a, b) => b.displayScore - a.displayScore);

    return {
      jobId: jobProfile.jobId,
      evaluations,
      metadata: {
        provider: this.llmService.lastProvider,
        model: RECRUITER_CONSTANTS.version,
        reranker: this.currentOptions.reranker || 'none',
        totalCandidates: input.shortlistedCandidates.length,
        processedCandidates: evaluations.length,
        processingTimeMs: Date.now() - startTime,
        tokensUsed: totalTokens,
      },
    };
  }

  private async evaluateCandidate(
    jobProfile: JobProfile,
    candidate: ShortlistedCandidate,
    crossEncoderResults: Map<string, { rawScore: number; adjustment: number; displayScore: number }>,
  ): Promise<{ evaluation: RecruiterEvaluation; tokensUsed: number }> {
    const candidateId = candidate.candidateProfile.candidateId;
    const crossEncoderData = crossEncoderResults.get(candidateId) || {
      rawScore: 0.5,
      adjustment: 0,
      displayScore: candidate.matchScore,
    };

    const { crossEncoderAdjustment, displayScore } = calculateDisplayScore(
      candidate.matchScore,
      crossEncoderData.rawScore,
    );

    const prompt = buildEvaluationPrompt(
      jobProfile,
      candidate,
      crossEncoderData.rawScore,
      crossEncoderAdjustment,
      displayScore,
    );

    const response = await this.llmService.evaluate({
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
    });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      parsed = this.buildFallbackEvaluation(candidate, displayScore);
    }

    const confidence = deriveConfidenceLevel(candidate.confidence);

    const cardSummary = (parsed.cardSummary as string) || this.buildFallbackCardSummary(candidate);
    const detailSummary = (parsed.detailSummary as DetailSummary) || this.buildFallbackDetailSummary(candidate);
    const rawReasoning = parsed.reasoning as Record<string, unknown> || {};

    const reasoning = buildReasoning(
      candidate,
      jobProfile,
      displayScore,
      {
        explanation: (rawReasoning.explanation as string) || `Candidate matches ${candidate.matchedSkills.length} of ${jobProfile.requiredSkills.length} required skills with a ${candidate.matchScore}% match score.`,
        summary: (rawReasoning.summary as string) || cardSummary,
        whyStandsOut: (rawReasoning.whyCandidateStandsOut as string[]) || [],
        risks: (rawReasoning.potentialRisks as string[]) || [],
        careerStability: (rawReasoning.careerStability as string) || 'Not assessed',
        careerProgression: (rawReasoning.careerProgression as string) || 'Not assessed',
        domainExpertise: (rawReasoning.domainExpertise as string) || 'Not assessed',
        leadershipIndicators: (rawReasoning.leadershipIndicators as string) || 'Not assessed',
        interviewFocus: (rawReasoning.suggestedInterviewFocus as string[]) || candidate.missingSkills.map(s => `Assess ${s} proficiency`),
        learningCurve: (rawReasoning.learningCurve as string) || 'Not assessed',
        teamFit: (rawReasoning.teamFit as string) || 'Not assessed',
        availability: (rawReasoning.availabilityNoticePeriod as string) || 'Not assessed',
        salaryFit: (rawReasoning.salaryFit as string) || 'Not assessed',
      },
    );

    return {
      evaluation: {
        candidateId,
        matchScore: candidate.matchScore,
        crossEncoderAdjustment,
        displayScore,
        confidence,
        cardSummary,
        detailSummary,
        reasoning,
        rerankMetadata: {
          reranker: this.currentOptions.reranker || 'none',
          rawScore: crossEncoderData.rawScore,
          adjustmentApplied: crossEncoderAdjustment,
        },
        aiMetadata: {
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          tokensUsed: response.tokensUsed,
        },
      },
      tokensUsed: response.tokensUsed,
    };
  }

  private buildFallbackEvaluation(candidate: ShortlistedCandidate, _displayScore: number): Record<string, unknown> {
    return {
      cardSummary: this.buildFallbackCardSummary(candidate),
      detailSummary: this.buildFallbackDetailSummary(candidate),
      reasoning: {
        explanation: `Candidate matches ${candidate.matchedSkills.length} skills with a ${candidate.matchScore}% match score.`,
      },
    };
  }

  private buildFallbackCardSummary(candidate: ShortlistedCandidate): string {
    const name = candidate.candidateProfile.personal.name.value;
    const matched = candidate.matchedSkills.length;
    const missing = candidate.missingSkills.length;
    return `${name} matches ${matched} required skills with ${missing} gaps. Score: ${candidate.matchScore}%.`;
  }

  private buildFallbackDetailSummary(candidate: ShortlistedCandidate): DetailSummary {
    const matched = candidate.matchedSkills.length;
    const missing = candidate.missingSkills.length;
    return {
      overallFit: `Candidate matches ${matched} of ${matched + missing} required skills.`,
      whyMatched: `Strong match on: ${candidate.matchedSkills.slice(0, 5).join(', ')}.`,
      missingRequirements: candidate.missingSkills.length > 0 ? `Missing: ${candidate.missingSkills.join(', ')}` : 'No missing requirements',
      potentialRisks: 'Unable to assess risks without AI analysis',
      keyStrengths: `Matches ${matched} skills, experience score: ${candidate.experienceScore}%`,
      interviewFocus: candidate.missingSkills.length > 0
        ? `Focus on: ${candidate.missingSkills.map(s => `Assess ${s} proficiency`).join('; ')}`
        : 'General technical assessment',
      finalRecommendation: `Score: ${candidate.matchScore}% — review recommended`,
    };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
