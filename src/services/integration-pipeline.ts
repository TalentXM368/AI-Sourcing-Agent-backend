import { pool } from '../db/index.js';
import { getMatchingMode } from './pipeline-toggle.js';

export async function runCandidatePipeline(candidateId: string): Promise<void> {
  const hasRedis = !!process.env.REDIS_URL;

  if (hasRedis) {
    const { enqueueJob } = await import('../queue/index.js');
    await enqueueJob('pipeline', {
      entityType: 'candidate',
      entityId: candidateId,
      triggerSource: 'upload',
    });
    return;
  }

  await runCandidatePipelineInline(candidateId);
}

export async function runJobPipeline(jobId: string): Promise<void> {
  const hasRedis = !!process.env.REDIS_URL;

  if (hasRedis) {
    const { enqueueJob } = await import('../queue/index.js');
    await enqueueJob('pipeline', {
      entityType: 'job',
      entityId: jobId,
      triggerSource: 'upload',
    });
    return;
  }

  await runJobPipelineInline(jobId);
}

async function runCandidatePipelineInline(candidateId: string): Promise<void> {
  const setStage = async (stage: string, status: string, message?: string) => {
    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, message, created_at, updated_at)
       VALUES (gen_random_uuid(), 'candidate', $1, $2, $3, 0, $4, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $3, progress = 0, message = $4, updated_at = NOW()`,
      [candidateId, stage, status, message || null],
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
  try {
    const { generateEmbeddings } = await import('../services/openai.js');
    const row = await pool.query(
      `SELECT id, name, headline, location, summary, skills, raw_text FROM candidates WHERE id = $1`,
      [candidateId],
    );
    if (row.rows.length > 0) {
      const r = row.rows[0];
      const fullText = [r.name, r.headline, r.location, r.summary, JSON.stringify(r.skills), r.raw_text].filter(Boolean).join(' ');
      const skillsText = Array.isArray(r.skills) ? r.skills.join(' ') : '';
      const roleText = r.headline || '';
      const vectors = await generateEmbeddings([fullText, skillsText, roleText]);
      const purposes = ['full_text', 'skills', 'role'];
      for (let i = 0; i < vectors.length && i < purposes.length; i++) {
        await pool.query(
          `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
           VALUES (gen_random_uuid(), 'candidate', $1, $2, $3, 'text-embedding-3-small', NOW())
           ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
          [candidateId, purposes[i], vectors[i]],
        );
      }
    }
    await completeStage('embedding');
  } catch (err) {
    await pool.query(
      `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
       WHERE entity_type = 'candidate' AND entity_id = $1 AND stage = 'embedding'`,
      [candidateId, err instanceof Error ? err.message : String(err)],
    );
  }

  const mode = getMatchingMode();
  if (mode === 'legacy' || mode === 'hybrid') {
    await setStage('matching', 'running');
    try {
      const { matchCandidateToAllJobs } = await import('../scoring/index.js');
      await matchCandidateToAllJobs(candidateId);
      await completeStage('matching');
    } catch (err) {
      await pool.query(
        `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
         WHERE entity_type = 'candidate' AND entity_id = $1 AND stage = 'matching'`,
        [candidateId, err instanceof Error ? err.message : String(err)],
      );
    }
  }

  if (mode === 'new' || mode === 'hybrid') {
    await setStage('indexing', 'running');
    try {
      const { getEmbeddingService } = await import('../modules/vector-intelligence/factory.js');
      const svc = getEmbeddingService();
      if (svc) {
        const row = await pool.query(`SELECT * FROM candidates WHERE id = $1`, [candidateId]);
        if (row.rows.length > 0) {
          const r = row.rows[0];
          const provider = (svc as any).provider;
          if (provider) {
            const fullText = [r.name, r.headline, r.location, r.summary, JSON.stringify(r.skills), r.raw_text].filter(Boolean).join(' ');
            const [vector] = await provider.generateEmbeddings([fullText]);
            const indexer = (svc as any).indexer;
            if (indexer) {
              await indexer.upsertCandidate(candidateId, vector, {
                name: r.name, headline: r.headline,
                location: r.location, skills: r.skills,
                indexedAt: new Date().toISOString(),
              });
            }
          }
        }
      }
      await completeStage('indexing');
    } catch (err) {
      console.error('[Pipeline] Qdrant indexing failed (non-critical):', err);
      await completeStage('indexing');
    }
  }
}

async function runJobPipelineInline(jobId: string): Promise<void> {
  const setStage = async (stage: string, status: string, message?: string) => {
    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, message, created_at, updated_at)
       VALUES (gen_random_uuid(), 'job', $1, $2, $3, 0, $4, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $3, progress = 0, message = $4, updated_at = NOW()`,
      [jobId, stage, status, message || null],
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
  try {
    const { generateEmbeddings } = await import('../services/openai.js');
    const row = await pool.query(
      `SELECT id, role, company, location, description, required_skills, nice_to_have_skills, raw_text FROM jobs WHERE id = $1`,
      [jobId],
    );
    if (row.rows.length > 0) {
      const r = row.rows[0];
      const fullText = [r.role, r.company, r.location, r.description, JSON.stringify(r.required_skills), r.raw_text].filter(Boolean).join(' ');
      const skillsText = [...(r.required_skills || []), ...(r.nice_to_have_skills || [])].join(' ');
      const roleText = r.role || '';
      const vectors = await generateEmbeddings([fullText, skillsText, roleText]);
      const purposes = ['full_text', 'skills', 'role'];
      for (let i = 0; i < vectors.length && i < purposes.length; i++) {
        await pool.query(
          `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
           VALUES (gen_random_uuid(), 'job', $1, $2, $3, 'text-embedding-3-small', NOW())
           ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
          [jobId, purposes[i], vectors[i]],
        );
      }
    }
    await completeStage('embedding');
  } catch (err) {
    await pool.query(
      `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
       WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'embedding'`,
      [jobId, err instanceof Error ? err.message : String(err)],
    );
  }

  const mode = getMatchingMode();
  await setStage('matching', 'running');
  try {
    if (mode === 'legacy' || mode === 'hybrid') {
      const { matchJobToAllCandidates } = await import('../scoring/index.js');
      await matchJobToAllCandidates(jobId);
    }
    if (mode === 'new' || mode === 'hybrid') {
      try {
        const { getMatchingService } = await import('../modules/matching-intelligence/factory.js');
        const svc = getMatchingService();
        if (svc) await svc.matchJobToCandidates(jobId, {}, 200);
      } catch (err) {
        console.error('[Pipeline] New matching failed (non-critical):', err);
      }
    }
    await completeStage('matching');
  } catch (err) {
    await pool.query(
      `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
       WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'matching'`,
      [jobId, err instanceof Error ? err.message : String(err)],
    );
  }
}
