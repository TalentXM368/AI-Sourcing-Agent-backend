import type { RerankerProvider } from '../types/provider.types.js';
import type { ShortlistedCandidate } from '../types/input.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

export class RerankingService {
  constructor(private reranker: RerankerProvider | null) {}

  async rerank(
    jobProfile: JobProfile,
    candidates: ShortlistedCandidate[],
  ): Promise<Map<string, { rawScore: number; adjustment: number; displayScore: number }>> {
    const results = new Map<string, { rawScore: number; adjustment: number; displayScore: number }>();

    if (!this.reranker || candidates.length === 0) {
      for (const candidate of candidates) {
        results.set(candidate.candidateProfile.candidateId, {
          rawScore: 0.5,
          adjustment: 0,
          displayScore: candidate.matchScore,
        });
      }
      return results;
    }

    const jobText = [
      jobProfile.title.value,
      jobProfile.summary.value,
      jobProfile.requiredSkills.map(s => s.canonical).join(' '),
    ].filter(Boolean).join(' ');

    const documents = candidates.map(c => [
      c.candidateProfile.personal.name.value,
      c.candidateProfile.personal.headline?.value || '',
      c.candidateProfile.personal.summary,
      c.candidateProfile.skills.map(s => s.canonical).join(' '),
    ].filter(Boolean).join(' '));

    try {
      const rerankerResults = await this.reranker.rerank(jobText, documents, candidates.length);

      for (const result of rerankerResults) {
        const candidate = candidates[result.index];
        if (candidate) {
          const candidateId = candidate.candidateProfile.candidateId;
          const rawScore = result.score;
          const adjustment = Math.round((rawScore - 0.5) * 20);
          const clampedAdjustment = Math.max(-10, Math.min(10, adjustment));
          const displayScore = Math.max(0, Math.min(100, candidate.matchScore + clampedAdjustment));

          results.set(candidateId, {
            rawScore,
            adjustment: clampedAdjustment,
            displayScore,
          });
        }
      }

      for (const candidate of candidates) {
        const candidateId = candidate.candidateProfile.candidateId;
        if (!results.has(candidateId)) {
          results.set(candidateId, {
            rawScore: 0.5,
            adjustment: 0,
            displayScore: candidate.matchScore,
          });
        }
      }
    } catch (err) {
      console.error('[Reranking] Error:', err);
      for (const candidate of candidates) {
        results.set(candidate.candidateProfile.candidateId, {
          rawScore: 0.5,
          adjustment: 0,
          displayScore: candidate.matchScore,
        });
      }
    }

    return results;
  }
}
