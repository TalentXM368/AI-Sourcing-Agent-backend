import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';

export function createProcessingRouter(): Router {
  const router = Router();

  // GET /api/processing/:entityType/:entityId
  router.get('/:entityType/:entityId', async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const result = await pool.query(
        `SELECT stage, status, progress, message, created_at, updated_at
         FROM processing_status
         WHERE entity_type = $1 AND entity_id = $2
         ORDER BY created_at ASC`,
        [entityType, entityId],
      );

      const stages = result.rows;
      const overallStatus = stages.every((s: any) => s.status === 'completed')
        ? 'completed'
        : stages.some((s: any) => s.status === 'failed')
          ? 'failed'
          : stages.some((s: any) => s.status === 'running')
            ? 'running'
            : 'pending';

      res.json({ entityType, entityId, overallStatus, stages });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get processing status', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/processing/active
  router.get('/active', async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT entity_type, entity_id, stage, status, progress, message, updated_at
         FROM processing_status
         WHERE status IN ('running', 'pending')
         ORDER BY updated_at DESC
         LIMIT 100`,
      );
      res.json({ active: result.rows });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get active processing', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/processing/:entityType/:entityId/history
  router.get('/:entityType/:entityId/history', async (req: Request, res: Response) => {
    try {
      const { entityType, entityId } = req.params;
      const result = await pool.query(
        `SELECT id, type, status, progress, result, error, started_at, completed_at, created_at
         FROM pipeline_runs
         WHERE entity_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [entityId],
      );
      res.json({ runs: result.rows });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get pipeline history', message: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
