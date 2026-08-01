import type { Request, Response } from 'express';
import type { EvaluationService } from '../services/evaluation-service.js';
import type { RecruiterAIInput, RecruiterAIOptions } from '../types/input.types.js';

interface RecruiterAIRequestBody {
  input: RecruiterAIInput;
  options?: RecruiterAIOptions;
}

export function createRecruiterController(evaluationService: EvaluationService) {
  return {
    async evaluate(req: Request, res: Response): Promise<void> {
      try {
        const body = req.body as RecruiterAIRequestBody;

        if (!body.input || !body.input.jobProfile || !body.input.shortlistedCandidates) {
          res.status(400).json({
            error: 'Validation failed',
            details: { input: ['Required: jobProfile and shortlistedCandidates'] },
          });
          return;
        }

        if (!Array.isArray(body.input.shortlistedCandidates) || body.input.shortlistedCandidates.length === 0) {
          res.status(400).json({
            error: 'Validation failed',
            details: { 'input.shortlistedCandidates': ['Must be a non-empty array'] },
          });
          return;
        }

        if (body.input.shortlistedCandidates.length > 50) {
          res.status(400).json({
            error: 'Validation failed',
            details: { 'input.shortlistedCandidates': ['Maximum 50 candidates'] },
          });
          return;
        }

        const result = await evaluationService.evaluate(body.input, body.options);
        res.json(result);
      } catch (error) {
        console.error('[RecruiterAI] evaluate error:', error);
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async health(_req: Request, res: Response): Promise<void> {
      try {
        res.json({
          status: 'healthy',
          module: 'recruiter-intelligence',
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
