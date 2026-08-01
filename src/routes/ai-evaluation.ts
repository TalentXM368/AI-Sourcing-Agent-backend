import { Router, Request, Response } from 'express';
import { pool } from '../db/index.js';

export function createAIEvaluationRouter(): Router {
  const router = Router();

  // GET /api/jobs/:jobId/evaluations
  router.get('/:jobId/evaluations', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await pool.query(
        `SELECT ae.*, c.name, c.headline, c.location, c.experience_years, c.skills
         FROM ai_evaluations ae
         JOIN candidates c ON c.id = ae.candidate_id
         WHERE ae.job_id = $1
         ORDER BY ae.display_score DESC
         LIMIT $2 OFFSET $3`,
        [jobId, limit, offset],
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM ai_evaluations WHERE job_id = $1`,
        [jobId],
      );

      res.json({
        evaluations: result.rows.map((r: any) => ({
          candidateId: r.candidate_id,
          name: r.name,
          headline: r.headline,
          location: r.location,
          experienceYears: r.experience_years,
          skills: r.skills,
          matchScore: r.match_score,
          displayScore: r.display_score,
          confidence: typeof r.confidence === 'string' ? JSON.parse(r.confidence) : r.confidence,
          cardSummary: r.card_summary,
          detailSummary: r.detail_summary,
          reasoning: r.reasoning ? (typeof r.reasoning === 'string' ? JSON.parse(r.reasoning) : r.reasoning) : null,
          rerankerScore: r.reranker_score,
          provider: r.provider,
          version: r.version,
          createdAt: r.created_at,
        })),
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get evaluations', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /api/jobs/:jobId/candidates/:candidateId/evaluation
  router.get('/:jobId/candidates/:candidateId/evaluation', async (req: Request, res: Response) => {
    try {
      const { jobId, candidateId } = req.params;

      const result = await pool.query(
        `SELECT ae.*, c.name, c.headline, c.location, c.summary, c.experience_years, c.skills,
                c.companies, c.work_history, c.education, c.projects, c.certifications, c.languages
         FROM ai_evaluations ae
         JOIN candidates c ON c.id = ae.candidate_id
         WHERE ae.job_id = $1 AND ae.candidate_id = $2`,
        [jobId, candidateId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'No evaluation found for this candidate-job pair' });
        return;
      }

      const r = result.rows[0];
      res.json({
        evaluation: {
          candidateId: r.candidate_id,
          name: r.name,
          headline: r.headline,
          location: r.location,
          summary: r.summary,
          experienceYears: r.experience_years,
          skills: r.skills,
          companies: r.companies,
          workHistory: r.work_history,
          education: r.education,
          projects: r.projects,
          certifications: r.certifications,
          languages: r.languages,
          matchScore: r.match_score,
          displayScore: r.display_score,
          confidence: typeof r.confidence === 'string' ? JSON.parse(r.confidence) : r.confidence,
          cardSummary: r.card_summary,
          detailSummary: r.detail_summary,
          reasoning: r.reasoning ? (typeof r.reasoning === 'string' ? JSON.parse(r.reasoning) : r.reasoning) : null,
          rerankerScore: r.reranker_score,
          provider: r.provider,
          version: r.version,
          createdAt: r.created_at,
        },
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get evaluation', message: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/jobs/:jobId/evaluate — manually trigger AI evaluation
  router.post('/:jobId/evaluate', async (req: Request, res: Response) => {
    try {
      const jobId = req.params.jobId as string;
      const candidateIds = Array.isArray(req.body.candidateIds) ? req.body.candidateIds : [];

      const { enqueueJob } = await import('../queue/index.js');
      await enqueueJob('ai-evaluation', {
        jobId,
        candidateIds,
        triggerSource: 'manual',
      });

      res.json({ message: 'AI evaluation queued', jobId, candidateCount: candidateIds.length || 'top 25' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to queue evaluation', message: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
