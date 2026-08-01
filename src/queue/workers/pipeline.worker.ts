import { registerWorker } from '../index.js';
import type { QueueJobData } from '../job-types.js';
import { pool } from '../../db/index.js';
import { enqueueJob } from '../index.js';

export function registerPipelineWorker() {
  registerWorker('pipeline', async (data: QueueJobData) => {
    const { entityType, entityId, triggerSource } = data as {
      entityType: 'candidate' | 'job';
      entityId: string;
      triggerSource: string;
    };

    const runId = (
      await pool.query(
        `INSERT INTO pipeline_runs (id, type, entity_id, status, progress, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'running', 0, NOW()) RETURNING id`,
        [`${entityType}-${triggerSource}`, entityId],
      )
    ).rows[0].id;

    const updateProgress = async (progress: number) => {
      await pool.query(
        `UPDATE pipeline_runs SET progress = $2 WHERE id = $1`,
        [runId, progress],
      );
    };

    try {
      if (entityType === 'candidate') {
        await runCandidatePipeline(entityId, updateProgress);
      } else {
        await runJobPipeline(entityId, updateProgress);
      }

      await pool.query(
        `UPDATE pipeline_runs SET status = 'completed', progress = 100, completed_at = NOW() WHERE id = $1`,
        [runId],
      );

      return { runId, entityType, entityId, status: 'completed' };
    } catch (err) {
      await pool.query(
        `UPDATE pipeline_runs SET status = 'failed', error = $2, completed_at = NOW() WHERE id = $1`,
        [runId, err instanceof Error ? err.message : String(err)],
      );
      throw err;
    }
  });
}

async function runCandidatePipeline(
  candidateId: string,
  updateProgress: (p: number) => Promise<void>,
): Promise<void> {
  const setStage = async (stage: string, status: string) => {
    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, created_at, updated_at)
       VALUES (gen_random_uuid(), 'candidate', $1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $3, progress = 0, updated_at = NOW()`,
      [candidateId, stage, status],
    );
  };
  const completeStage = async (stage: string) => {
    await pool.query(
      `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
       WHERE entity_type = 'candidate' AND entity_id = $1 AND stage = $2`,
      [candidateId, stage],
    );
  };

  await setStage('embedding', 'running');
  await updateProgress(20);
  await enqueueJob('embedding-generation', { entityType: 'candidate', entityId: candidateId });
  await completeStage('embedding');
  await updateProgress(40);

  const hasQdrant = !!(process.env.QDRANT_URL);
  if (hasQdrant) {
    await setStage('indexing', 'running');
    await updateProgress(50);
    await enqueueJob('candidate-indexing', { entityType: 'candidate', entityId: candidateId });
    await completeStage('indexing');
    await updateProgress(60);
  }

  await setStage('matching', 'running');
  await updateProgress(70);
  const jobs = await pool.query(`SELECT id FROM jobs WHERE status = 'open'`);
  for (const job of jobs.rows) {
    await enqueueJob('matching', { jobId: (job as any).id, triggerSource: 'candidate-upload' });
  }
  await completeStage('matching');
  await updateProgress(100);
}

async function runJobPipeline(
  jobId: string,
  updateProgress: (p: number) => Promise<void>,
): Promise<void> {
  const setStage = async (stage: string, status: string) => {
    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, created_at, updated_at)
       VALUES (gen_random_uuid(), 'job', $1, $2, $3, 0, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $3, progress = 0, updated_at = NOW()`,
      [jobId, stage, status],
    );
  };
  const completeStage = async (stage: string) => {
    await pool.query(
      `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
       WHERE entity_type = 'job' AND entity_id = $1 AND stage = $2`,
      [jobId, stage],
    );
  };

  await setStage('embedding', 'running');
  await updateProgress(20);
  await enqueueJob('embedding-generation', { entityType: 'job', entityId: jobId });
  await completeStage('embedding');
  await updateProgress(40);

  const hasQdrant = !!(process.env.QDRANT_URL);
  if (hasQdrant) {
    await setStage('indexing', 'running');
    await updateProgress(50);
    await enqueueJob('job-indexing', { entityType: 'job', entityId: jobId });
    await completeStage('indexing');
    await updateProgress(60);
  }

  await setStage('matching', 'running');
  await updateProgress(70);
  await enqueueJob('matching', { jobId, triggerSource: 'job-upload' });
  await completeStage('matching');
  await updateProgress(100);
}
