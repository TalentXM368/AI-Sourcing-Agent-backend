import { Router } from 'express';
import { validateCandidate, healthCheck } from '../controllers/validation.controller.js';

const router = Router();

router.post('/validate', validateCandidate);
router.get('/health', healthCheck);

export default router;
