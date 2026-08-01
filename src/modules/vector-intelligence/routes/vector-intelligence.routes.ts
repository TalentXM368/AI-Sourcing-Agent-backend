import { Router } from 'express';
import type { EmbeddingService } from '../services/embedding-service.js';
import type { ReindexService } from '../services/reindex-service.js';
import { createVectorIntelligenceController } from '../controllers/vector-intelligence.controller.js';

export function createVectorIntelligenceRouter(
  embeddingService: EmbeddingService,
  reindexService: ReindexService,
): Router {
  const router = Router();
  const controller = createVectorIntelligenceController(embeddingService, reindexService);

  router.get('/health', controller.health);
  router.get('/stats', controller.stats);

  router.post('/search/candidates', controller.searchCandidates);
  router.post('/search/jobs', controller.searchJobs);

  router.post('/reindex/candidates', controller.reindexCandidates);
  router.post('/reindex/jobs', controller.reindexJobs);
  router.post('/reindex/all', controller.reindexAll);

  return router;
}
