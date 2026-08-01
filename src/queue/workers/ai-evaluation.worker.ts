import { registerWorker } from '../index.js';
import type { QueueJobData } from '../job-types.js';
import { pool } from '../../db/index.js';

export function registerAIEvaluationWorker() {
  registerWorker('ai-evaluation', async (data: QueueJobData) => {
    const { jobId, candidateIds } = data as { jobId: string; candidateIds: string[]; triggerSource: string };

    await pool.query(
      `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, created_at, updated_at)
       VALUES (gen_random_uuid(), 'job', $1, 'ai-evaluation', 'running', 0, NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = 'running', progress = 0, updated_at = NOW()`,
      [jobId],
    );

    try {
      let topCandidateIds = candidateIds;
      if (topCandidateIds.length === 0) {
        const ranked = await pool.query(
          `SELECT candidate_id FROM ranked_candidates WHERE job_id = $1 ORDER BY total_score DESC LIMIT 25`,
          [jobId],
        );
        topCandidateIds = ranked.rows.map((r: any) => r.candidate_id);
      }

      if (topCandidateIds.length === 0) {
        await pool.query(
          `UPDATE processing_status SET status = 'completed', progress = 100, message = 'No candidates to evaluate', updated_at = NOW()
           WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'ai-evaluation'`,
          [jobId],
        );
        return { jobId, evaluated: 0 };
      }

      const jobRow = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
      const job = jobRow.rows[0];

      let evaluated = 0;
      for (let i = 0; i < topCandidateIds.length; i++) {
        const candidateId = topCandidateIds[i];
        const progress = Math.round(((i + 1) / topCandidateIds.length) * 100);

        await pool.query(
          `UPDATE processing_status SET progress = $2, updated_at = NOW()
           WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'ai-evaluation'`,
          [jobId, progress],
        );

        try {
          const ranked = await pool.query(
            `SELECT * FROM ranked_candidates WHERE job_id = $1 AND candidate_id = $2`,
            [jobId, candidateId],
          );
          if (ranked.rows.length === 0) continue;
          const ranking = ranked.rows[0];

          const candidateRow = await pool.query(
            `SELECT * FROM candidates WHERE id = $1`, [candidateId],
          );
          if (candidateRow.rows.length === 0) continue;
          const candidate = candidateRow.rows[0];

          let cardSummary: string | null = null;
          let detailSummaryStr: string | null = null;
          let confidence: { level: string; score: number } = { level: 'Medium', score: 0.6 };
          let reasoning: unknown = null;

          const skills = Array.isArray(candidate.skills) ? candidate.skills : [];
          const requiredSkills = job.required_skills || [];
          const niceToHave = job.nice_to_have_skills || [];
          const exactMatches = skills.filter((s: string) =>
            requiredSkills.some((r: string) => r.toLowerCase() === s.toLowerCase()),
          );
          const niceMatches = skills.filter((s: string) =>
            niceToHave.some((n: string) => n.toLowerCase() === s.toLowerCase()),
          );
          const missingSkills = requiredSkills.filter((r: string) =>
            !skills.some((s: string) => s.toLowerCase() === r.toLowerCase()),
          );

          const score = ranking.total_score;
          const exactPct = requiredSkills.length > 0 ? exactMatches.length / requiredSkills.length : 0;

          if (exactPct >= 0.7) {
            confidence = { level: 'High', score: Math.min(0.95, 0.7 + exactPct * 0.25) };
          } else if (exactPct >= 0.4) {
            confidence = { level: 'Medium', score: 0.5 + exactPct * 0.3 };
          } else {
            confidence = { level: 'Low', score: 0.3 + exactPct * 0.2 };
          }

          let recommendation = 'Consider';
          if (score >= 85 && exactPct >= 0.7) recommendation = 'Strong Hire';
          else if (score >= 70 && exactPct >= 0.5) recommendation = 'Good Hire';
          else if (score < 40 || exactPct < 0.2) recommendation = 'Not Recommended';

          cardSummary = `${candidate.name} matches ${job.role} at ${score}%. `;
          if (exactMatches.length > 0) cardSummary += `Strong in: ${exactMatches.slice(0, 3).join(', ')}. `;
          if (missingSkills.length > 0) cardSummary += `Missing: ${missingSkills.slice(0, 2).join(', ')}. `;
          cardSummary += `Recommendation: ${recommendation}.`;

          detailSummaryStr = `Overall fit: ${score}%. `;
          detailSummaryStr += `Matched ${exactMatches.length}/${requiredSkills.length} required skills. `;
          if (candidate.experience_years) detailSummaryStr += `${candidate.experience_years} years experience. `;
          if (candidate.location) detailSummaryStr += `Based in ${candidate.location}. `;
          detailSummaryStr += `Recommendation: ${recommendation}.`;

          reasoning = {
            recommendation,
            explanation: cardSummary,
            matchedSkills: exactMatches.length,
            requiredSkills: requiredSkills.length,
            experience: `${candidate.experience_years || 0} years`,
            summary: cardSummary,
            whyCandidateStandsOut: exactMatches.slice(0, 3),
            potentialRisks: missingSkills.length > 0 ? [`Missing ${missingSkills.length} required skills`] : [],
          };

          const displayScore = score;

          await pool.query(
            `INSERT INTO ai_evaluations (id, job_id, candidate_id, match_score, display_score, confidence, card_summary, detail_summary, reasoning, provider, version, created_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'deterministic', 1, NOW())
             ON CONFLICT (job_id, candidate_id)
             DO UPDATE SET display_score = $4, confidence = $5, card_summary = $6, detail_summary = $7, reasoning = $8, provider = 'deterministic', version = ai_evaluations.version + 1`,
            [jobId, candidateId, ranking.total_score, displayScore, JSON.stringify(confidence), cardSummary, detailSummaryStr, JSON.stringify(reasoning)],
          );

          evaluated++;
        } catch (err) {
          console.error(`[AI-Eval] Failed for candidate ${candidateId}:`, err);
        }
      }

      await pool.query(
        `UPDATE processing_status SET status = 'completed', progress = 100, message = $2, updated_at = NOW()
         WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'ai-evaluation'`,
        [jobId, `Evaluated ${evaluated}/${topCandidateIds.length} candidates`],
      );

      return { jobId, evaluated, total: topCandidateIds.length };
    } catch (err) {
      await pool.query(
        `UPDATE processing_status SET status = 'failed', message = $2, updated_at = NOW()
         WHERE entity_type = 'job' AND entity_id = $1 AND stage = 'ai-evaluation'`,
        [jobId, err instanceof Error ? err.message : String(err)],
      );
      throw err;
    }
  });
}
