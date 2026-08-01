import { Router } from 'express';
import { resolveCandidate, healthCheck } from '../controllers/resolution.controller.js';

const router = Router();

router.post('/resolve', resolveCandidate);
router.get('/health', healthCheck);

export default router;
