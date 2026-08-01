import type { Request, Response } from 'express';
import { ResolutionService } from '../services/resolution.service.js';

const resolutionService = new ResolutionService();

export async function resolveCandidate(req: Request, res: Response) {
  try {
    const profile = req.body;

    if (!profile || !profile.candidateId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must be a CandidateProfile with candidateId',
      });
    }

    const resolved = await resolutionService.resolve(profile);

    return res.json({
      success: true,
      profile: resolved,
      resolutionTimeMs: resolved.resolutionMetadata.resolutionTimeMs,
    });
  } catch (error) {
    console.error('[Resolution Controller] Error:', error);
    return res.status(500).json({
      error: 'Resolution failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function healthCheck(req: Request, res: Response) {
  return res.json({
    status: 'healthy',
    service: 'candidate-resolution',
    version: '2.2.0',
    timestamp: new Date().toISOString(),
  });
}
