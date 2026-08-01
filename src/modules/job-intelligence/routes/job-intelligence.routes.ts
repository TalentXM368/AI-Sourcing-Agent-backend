import { Router } from 'express';
import { parseJob, healthCheck } from '../controllers/job-intelligence.controller.js';

const router = Router();

router.post('/profile', parseJob);
router.get('/health', healthCheck);

export default router;
