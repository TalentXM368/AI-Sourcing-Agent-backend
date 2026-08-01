import type { Request, Response } from 'express';
import type { MatchingService } from '../services/matching-service.js';
import { MatchJobSchema, MatchCandidateSchema } from '../schemas/index.js';

export function createMatchingController(matchingService: MatchingService) {
  return {
    async matchJob(req: Request, res: Response): Promise<void> {
      try {
        const parsed = MatchJobSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Validation failed',
            details: parsed.error.flatten().fieldErrors,
          });
          return;
        }

        const { jobId, filters, topK, weights } = parsed.data;
        const result = await matchingService.matchJobToCandidates(jobId, filters, topK, weights);
        res.json(result);
      } catch (error) {
        console.error('[Matching] matchJob error:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async matchCandidate(req: Request, res: Response): Promise<void> {
      try {
        const parsed = MatchCandidateSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Validation failed',
            details: parsed.error.flatten().fieldErrors,
          });
          return;
        }

        const { candidateId, filters, topK, weights } = parsed.data;
        const result = await matchingService.matchCandidateToJobs(candidateId, filters, topK, weights);
        res.json(result);
      } catch (error) {
        console.error('[Matching] matchCandidate error:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async health(_req: Request, res: Response): Promise<void> {
      try {
        res.json({
          status: 'healthy',
          module: 'matching-intelligence',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
