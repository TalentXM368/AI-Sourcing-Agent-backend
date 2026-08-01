import type { Request, Response } from 'express';
import type { EmbeddingService } from '../services/embedding-service.js';
import type { ReindexService } from '../services/reindex-service.js';

export function createVectorIntelligenceController(
  embeddingService: EmbeddingService,
  reindexService: ReindexService,
) {
  return {
    async health(_req: Request, res: Response): Promise<void> {
      try {
        const health = await embeddingService.health();
        res.json({
          status: health.provider && health.qdrant ? 'healthy' : 'degraded',
          ...health,
        });
      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async stats(_req: Request, res: Response): Promise<void> {
      try {
        const stats = await reindexService.getStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async searchCandidates(req: Request, res: Response): Promise<void> {
      try {
        const { query, topK = 10 } = req.body;
        if (!query) {
          res.status(400).json({ error: 'query is required' });
          return;
        }

        const results = await embeddingService.searchCandidates(query, topK);
        res.json({ results, count: results.length });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async searchJobs(req: Request, res: Response): Promise<void> {
      try {
        const { query, topK = 10 } = req.body;
        if (!query) {
          res.status(400).json({ error: 'query is required' });
          return;
        }

        const results = await embeddingService.searchJobs(query, topK);
        res.json({ results, count: results.length });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async reindexCandidates(_req: Request, res: Response): Promise<void> {
      try {
        const result = await reindexService.reindexAllCandidates();
        res.json({ message: 'Reindex complete', ...result });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async reindexJobs(_req: Request, res: Response): Promise<void> {
      try {
        const result = await reindexService.reindexAllJobs();
        res.json({ message: 'Reindex complete', ...result });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },

    async reindexAll(_req: Request, res: Response): Promise<void> {
      try {
        const result = await reindexService.reindexAll();
        res.json({ message: 'Full reindex complete', ...result });
      } catch (error) {
        res.status(500).json({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
