import { Router } from 'express';
import type { EvaluationService } from '../services/evaluation-service.js';
import { createRecruiterController } from '../controllers/recruiter.controller.js';

export function createRecruiterRouter(evaluationService: EvaluationService): Router {
  const router = Router();
  const controller = createRecruiterController(evaluationService);

  router.post('/evaluate', controller.evaluate);
  router.get('/health', controller.health);

  return router;
}
