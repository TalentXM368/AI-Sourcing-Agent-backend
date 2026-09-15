import { pool } from '../db/index.js';
import { randomUUID } from 'crypto';
import type { StructuredDocument } from '../modules/candidate-intelligence/types/input.types.js';
import { classifyIndustry } from './industry-classifier.js';
import { classifyRegion } from './region-classifier.js';

const setStage = async (jobId: string, stage: string, status: string, message?: string) => {
  await pool.query(
    `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, message, created_at, updated_at)
     VALUES (gen_random_uuid(), 'job', $1, $2, $3, 0, $4, NOW(), NOW())
     ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $3, progress = 0, message = $4, updated_at = NOW()`,
    [jobId, stage, status, message || null],
  );
};

const completeStage = async (jobId: string, stage: string) => {
  await pool.query(
    `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
     WHERE entity_type = 'job' AND entity_id = $1 AND stage = $2`,
    [jobId, stage],
  );
};

const failStage = async (jobId: string, stage: string, error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  await pool.query(
    `UPDATE processing_status SET status = 'failed', message = $3, updated_at = NOW()
     WHERE entity_type = 'job' AND entity_id = $1 AND stage = $2`,
    [jobId, stage, msg],
  );
};

export async function runFullJobPipeline(
  jobId: string,
  doc: StructuredDocument,
): Promise<void> {
  // Phase 3: Job Intelligence
  await setStage(jobId, 'job_intelligence', 'running');
  let profile: any;
  try {
    const { runJobPipeline } = await import('../modules/job-intelligence/pipeline.js');
    profile = await runJobPipeline(doc, jobId);
    await completeStage(jobId, 'job_intelligence');
  } catch (err) {
    await failStage(jobId, 'job_intelligence', err);
    throw err;
  }

  const title = profile.title?.value || profile.title?.raw || 'Untitled';
  const company = profile.company?.value || profile.company?.raw || null;
  const location = profile.location?.raw || null;
  const description = profile.responsibilities?.join('. ') || profile.summary?.value || '';
  const requiredSkills = (profile.requiredSkills || []).map((s: any) => s.canonical || s.raw || String(s));
  const niceToHave = (profile.preferredSkills || []).map((s: any) => s.canonical || s.raw || String(s));
  const expMin = profile.experience?.min || null;
  const expMax = profile.experience?.max || null;

  // Classify industry and region
  const fullText = `${title} ${description} ${requiredSkills.join(' ')}`;
  const industryResult = await classifyIndustry(fullText, requiredSkills, title).catch(() => ({ industry: null }));
  const regionResult = classifyRegion(location || '');

  // Update jobs table
  await pool.query(
    `UPDATE jobs SET
      role = $2, company = $3, location = $4, description = $5,
      required_skills = $6, nice_to_have_skills = $7, avoid_skills = $8,
      experience_min = $9, experience_max = $10,
      industry = $11, region = $12,
      raw_text = $13, updated_at = NOW()
    WHERE id = $1`,
    [
      jobId, title, company, location, description,
      JSON.stringify(requiredSkills), JSON.stringify(niceToHave), JSON.stringify(profile.avoidSkills || []),
      expMin, expMax,
      industryResult.industry, regionResult,
      doc.plainText || doc.markdown || '',
    ],
  );

  // Phase 4: Embedding (metadata only; vectors go to Qdrant)
  await setStage(jobId, 'embedding', 'running');
  try {
    const { generateEmbeddings } = await import('../services/openai.js');
    const embedText = [title, company, location, description, requiredSkills.join(' '), doc.plainText || ''].filter(Boolean).join(' ');
    const skillsText = [...requiredSkills, ...niceToHave].join(' ');
    const roleText = title;
    await generateEmbeddings([embedText, skillsText, roleText])
    const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
    for (const purpose of ['full_text', 'skills', 'role']) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, model, dimensions, created_at)
         VALUES (gen_random_uuid(), 'job', $1, $2, 'text-embedding-3-small', $3, NOW())
         ON CONFLICT (entity_type, entity_id, purpose) DO NOTHING`,
        [jobId, purpose, embedDim],
      );
    }
    await completeStage(jobId, 'embedding');
  } catch (err) {
    await failStage(jobId, 'embedding', err);
  }

  // Phase 4b: Qdrant Indexing
  await setStage(jobId, 'indexing', 'running');
  try {
    const { getEmbeddingService } = await import('../modules/vector-intelligence/factory.js');
    const svc = getEmbeddingService();
    if (svc) {
      await svc.indexJobProfileSync(profile);
    }
    await completeStage(jobId, 'indexing');
  } catch (err) {
    console.error('[JobPipeline] Qdrant indexing failed (non-critical):', err);
    await completeStage(jobId, 'indexing');
  }

  // Phase 5: Matching — retrieve top N from Qdrant, then score only those
  await setStage(jobId, 'matching', 'running');
  try {
    // Step 1: Qdrant semantic search → retrieve top 200 candidates
    let qdrantCandidateIds: string[] = [];
    try {
      const { getEmbeddingService } = await import('../modules/vector-intelligence/factory.js');
      const svc = getEmbeddingService();
      if (svc) {
        const searchQuery = `${title} ${requiredSkills.join(' ')} ${location || ''}`;
        const searchResults = await svc.searchCandidates(searchQuery, 200);
        qdrantCandidateIds = searchResults.map(r => r.entityId);
        console.log(`[JobPipeline] Qdrant semantic search returned ${qdrantCandidateIds.length} candidates for job ${jobId}`);
      }
    } catch (searchErr) {
      console.error('[JobPipeline] Qdrant search failed, falling back to full scoring:', searchErr);
    }

    // Step 2: Score only the Qdrant-retrieved candidates (or all if Qdrant failed)
    const { matchJobToCandidateIds, matchJobToAllCandidates } = await import('../scoring/index.js');
    if (qdrantCandidateIds.length > 0) {
      await matchJobToCandidateIds(jobId, qdrantCandidateIds);
    } else {
      await matchJobToAllCandidates(jobId);
    }

    await completeStage(jobId, 'matching');
  } catch (err) {
    await failStage(jobId, 'matching', err);
  }

  // Phase 6: AI Evaluation — top 25 candidates (LLM-generated summaries)
  await setStage(jobId, 'ai_evaluation', 'running');
  try {
    const { evaluateCandidateWithLLM } = await import('../scoring/llm-evaluation.js');

    const rankedRow = await pool.query(
      `SELECT rc.id, rc.candidate_id, rc.total_score, rc.semantic_score, rc.skill_score, rc.experience_score, rc.education_score, rc.explanation, rc.llm_score,
              c.name, c.headline, c.location, c.skills, c.experience_years, c.summary,
              c.companies, c.work_history, c.education, c.email, c.phone
       FROM ranked_candidates rc
       JOIN candidates c ON c.id = rc.candidate_id
       WHERE rc.job_id = $1
       ORDER BY rc.total_score DESC
       LIMIT 25`,
      [jobId],
    );

    const jobRow = await pool.query(
      `SELECT id, role, company, location, description, required_skills, nice_to_have_skills,
              avoid_skills, experience_min, experience_max, industry, region
       FROM jobs WHERE id = $1`,
      [jobId],
    );
    const job = jobRow.rows[0];

    let evaluated = 0;
    for (const ranking of rankedRow.rows) {
      const candidateId = ranking.candidate_id;

      // Call LLM for real summary
      const llmResult = await evaluateCandidateWithLLM(ranking, job);

      // Build confidence from skill match as fallback/supplement
      const skills = Array.isArray(ranking.skills) ? ranking.skills : [];
      const requiredSkillsArr = requiredSkills;
      const exactMatches = skills.filter((s: any) =>
        requiredSkillsArr.some((r: string) => r.toLowerCase() === (s.name || s).toLowerCase()),
      );
      const missingSkills = requiredSkillsArr.filter((r: string) =>
        !skills.some((s: any) => (s.name || s).toLowerCase() === r.toLowerCase()),
      );
      const exactPct = requiredSkillsArr.length > 0 ? exactMatches.length / requiredSkillsArr.length : 0;

      let confidence: { level: string; score: number };
      if (exactPct >= 0.7) {
        confidence = { level: 'High', score: Math.min(0.95, 0.7 + exactPct * 0.25) };
      } else if (exactPct >= 0.4) {
        confidence = { level: 'Medium', score: 0.5 + exactPct * 0.3 };
      } else {
        confidence = { level: 'Low', score: 0.3 + exactPct * 0.2 };
      }

      const score = ranking.total_score;
      const displayScore = llmResult ? llmResult.score : score;
      const cardSummary = llmResult?.verdict || `${ranking.name} matches ${title} at ${score}%`;
      const detailSummary = llmResult?.reasoning || null;

      let recommendation = 'Consider';
      if (score >= 85 && exactPct >= 0.7) recommendation = 'Strong Hire';
      else if (score >= 70 && exactPct >= 0.5) recommendation = 'Good Hire';
      else if (score < 40 || exactPct < 0.2) recommendation = 'Not Recommended';

      const reasoning = {
        recommendation,
        explanation: cardSummary,
        matchedSkills: exactMatches.length,
        requiredSkills: requiredSkillsArr.length,
        experience: `${ranking.experience_years || 0} years`,
        summary: cardSummary,
        whyCandidateStandsOut: exactMatches.map((s: any) => s.name || s).slice(0, 3),
        potentialRisks: missingSkills.length > 0 ? [`Missing ${missingSkills.length} required skills`] : [],
        llmScore: llmResult?.score ?? null,
        llmVerdict: llmResult?.verdict ?? null,
        llmReasoning: llmResult?.reasoning ?? null,
      };

      await pool.query(
        `INSERT INTO ai_evaluations (id, job_id, candidate_id, match_score, display_score, confidence, card_summary, detail_summary, reasoning, provider, version, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())
         ON CONFLICT (job_id, candidate_id)
         DO UPDATE SET display_score = $4, confidence = $5, card_summary = $6, detail_summary = $7, reasoning = $8, provider = $9, version = ai_evaluations.version + 1`,
        [jobId, candidateId, score, displayScore, JSON.stringify(confidence), cardSummary, detailSummary, JSON.stringify(reasoning), llmResult ? 'pollinations/groq' : 'deterministic'],
      );
      evaluated++;
    }

    console.log(`[JobPipeline] AI evaluation: ${evaluated} candidates evaluated for job ${jobId}`);
    await completeStage(jobId, 'ai_evaluation');
  } catch (err) {
    console.error('[JobPipeline] AI evaluation failed (non-critical):', err);
    await completeStage(jobId, 'ai_evaluation');
  }

  console.log(`[JobPipeline] Completed full pipeline for job: ${jobId} (${title})`);
}
