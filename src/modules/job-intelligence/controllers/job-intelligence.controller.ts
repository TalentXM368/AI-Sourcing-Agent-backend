import type { Request, Response } from 'express';
import { StructuredDocumentSchema } from '../../candidate-intelligence/schemas/input.schema.js';
import { runJobPipeline } from '../pipeline.js';

export async function parseJob(req: Request, res: Response) {
  try {
    const validation = StructuredDocumentSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Request body must be a valid StructuredDocument',
        details: validation.error.issues,
      });
    }

    const doc = validation.data;
    const jobId = req.body.jobId || undefined;

    const startTime = Date.now();
    const profile = await runJobPipeline(doc, jobId);
    const processingTimeMs = Date.now() - startTime;

    return res.json({
      success: true,
      profile,
      processingTimeMs,
    });
  } catch (error) {
    console.error('[Job Intelligence Controller] Error:', error);
    return res.status(500).json({
      error: 'Job parsing failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function healthCheck(_req: Request, res: Response) {
  return res.json({
    status: 'healthy',
    service: 'job-intelligence',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
  });
}
