import type { Request, Response } from 'express';
import { runPipeline } from '../pipeline.js';
import { StructuredDocumentSchema } from '../schemas/input.schema.js';

export async function parseCandidate(req: Request, res: Response) {
  try {
    const body = req.body;

    // Validate input
    const validation = StructuredDocumentSchema.safeParse(body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: validation.error.issues,
      });
    }

    const doc = validation.data;
    const profile = await runPipeline(doc);

    return res.json({
      success: true,
      profile,
      processingTimeMs: profile.processing.processingTimeMs,
    });
  } catch (error) {
    console.error('[Intelligence Controller] Parse error:', error);
    return res.status(500).json({
      error: 'Failed to parse candidate',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function healthCheck(req: Request, res: Response) {
  return res.json({
    status: 'healthy',
    service: 'candidate-intelligence',
    version: '2.1.0',
    timestamp: new Date().toISOString(),
  });
}
