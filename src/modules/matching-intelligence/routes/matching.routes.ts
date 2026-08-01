import { Router } from 'express';
import type { MatchingService } from '../services/matching-service.js';
import { createMatchingController } from '../controllers/matching.controller.js';

export function createMatchingRouter(matchingService: MatchingService): Router {
  const router = Router();
  const controller = createMatchingController(matchingService);

  router.post('/match-job', controller.matchJob);
  router.post('/match-candidate', controller.matchCandidate);
  router.get('/health', controller.health);

  return router;
}
