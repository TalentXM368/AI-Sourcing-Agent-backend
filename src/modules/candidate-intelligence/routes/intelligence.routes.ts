import { Router } from 'express';
import { parseCandidate, healthCheck } from '../controllers/intelligence.controller.js';

const router = Router();

router.post('/parse', parseCandidate);
router.get('/health', healthCheck);

export default router;
