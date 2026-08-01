import { registerWorker } from '../index.js';
import type { QueueJobData } from '../job-types.js';
import { pool } from '../../db/index.js';

export function registerMatchingWorker() {
  registerWorker('matching', async (data: QueueJobData) => {
    const { jobId } = data as { jobId: string; triggerSource: string };

    const jobRow = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    if (jobRow.rows.length === 0) throw new Error(`Job ${jobId} not found`);

    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, created_at, updated_at)
       VALUES (gen_random_uuid(), 'job', $1, 'matching', 'running', 0, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = 'running', progress = 0, updated_at = NOW()`,
      [jobId],
    );

    try {
      const { getMatchingMode } = await import('../../services/pipeline-toggle.js');
      const mode = getMatchingMode();

      if (mode === 'legacy' || mode === 'hybrid') {
        const { matchJobToAllCandidates } = await import('../../scoring/index.js');
        await matchJobToAllCandidates(jobId);
      }

      if (mode === 'new' || mode === 'hybrid') {
        try {
          const { getMatchingService } = await import('../../modules/matching-intelligence/factory.js');
          const matchingService = getMatchingService();
          if (matchingService) {
            await matchingService.matchJobToCandidates(jobId, {}, 200);
          }
        } catch (err) {
          console.error(`[Matching] New pipeline failed (non-critical):`, err);
        }
      }

      await pool.query(
        `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
         WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'matching'`,
        [jobId],
      );

      const { enqueueJob } = await import('../index.js');
      await enqueueJob('ai-evaluation', {
        jobId,
        candidateIds: [],
        triggerSource: 'matching',
      });

      return { jobId, mode };
    } catch (err) {
      await pool.query(
        `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
         WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'matching'`,
        [jobId, err instanceof Error ? err.message : String(err)],
      );
      throw err;
    }
  });
}
