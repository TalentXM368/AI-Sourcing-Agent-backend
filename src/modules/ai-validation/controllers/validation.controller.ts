import type { Request, Response } from 'express';
import { ValidationService } from '../services/validation.service.js';
import type { ValidationOptions } from '../types/index.js';

const validationService = new ValidationService();

export async function validateCandidate(req: Request, res: Response) {
  try {
    const { profile, options } = req.body as { profile: unknown; options?: ValidationOptions };

    if (!profile || typeof profile !== 'object') {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must contain a ResolvedCandidateProfile',
      });
    }

    const p = profile as Record<string, unknown>;
    if (!p.candidateId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Profile must contain candidateId',
      });
    }

    const result = await validationService.validate(
      profile as Parameters<ValidationService['validate']>[0],
      options,
    );

    return res.json({
      success: true,
      data: result,
      metadata: result.validationMetadata,
    });
  } catch (error) {
    console.error('[Validation Controller] Error:', error);
    return res.status(500).json({
      error: 'Validation failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function healthCheck(_req: Request, res: Response) {
  return res.json({
    status: 'healthy',
    service: 'ai-validation',
    version: '2.3.0',
    timestamp: new Date().toISOString(),
  });
}
