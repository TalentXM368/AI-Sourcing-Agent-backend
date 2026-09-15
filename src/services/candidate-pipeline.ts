import { pool } from '../db/index.js';
import type { StructuredDocument } from '../modules/candidate-intelligence/types/input.types.js';

const setStage = async (entityType: string, entityId: string, stage: string, status: string, message?: string) => {
  await pool.query(
    `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, message, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, $5, NOW(), NOW())
     ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $4, progress = 0, message = $5, updated_at = NOW()`,
    [entityType, entityId, stage, status, message || null],
  );
};

const completeStage = async (entityType: string, entityId: string, stage: string) => {
  await pool.query(
    `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
     WHERE entity_type = $1 AND entity_id = $2 AND stage = $3`,
    [entityType, entityId, stage],
  );
};

const failStage = async (entityType: string, entityId: string, stage: string, error: unknown) => {
  await pool.query(
    `UPDATE processing_status SET status = 'failed', message = $4, updated_at = NOW()
     WHERE entity_type = $1 AND entity_id = $2 AND stage = $3`,
    [entityType, entityId, stage, error instanceof Error ? error.message : String(error)],
  );
};

export async function runFullCandidatePipeline(
  candidateId: string,
  doc: StructuredDocument,
): Promise<void> {
  // Phase 1: Candidate Intelligence
  await setStage('candidate', candidateId, 'intelligence', 'running');
  let profile: any;
  try {
    const { runPipeline } = await import('../modules/candidate-intelligence/pipeline.js');
    profile = await runPipeline(doc);
    profile.candidateId = candidateId;
    await completeStage('candidate', candidateId, 'intelligence');
  } catch (err) {
    await failStage('candidate', candidateId, 'intelligence', err);
    throw err;
  }

  // Phase 2.2: Candidate Resolution
  await setStage('candidate', candidateId, 'resolution', 'running');
  let resolved: any;
  try {
    const { ResolutionService } = await import('../modules/candidate-resolution/services/resolution.service.js');
    const service = new ResolutionService();
    resolved = await service.resolve(profile);
    await completeStage('candidate', candidateId, 'resolution');
  } catch (err) {
    await failStage('candidate', candidateId, 'resolution', err);
    // Non-critical — continue with unresolved profile
    resolved = profile;
  }

  // Phase 2.3: AI Validation
  await setStage('candidate', candidateId, 'validation', 'running');
  let validated: any;
  try {
    const { ValidationService } = await import('../modules/ai-validation/services/validation.service.js');
    const service = new ValidationService();
    validated = await service.validate(resolved, { enableEnrichment: true });
    await completeStage('candidate', candidateId, 'validation');
  } catch (err) {
    await failStage('candidate', candidateId, 'validation', err);
    // Non-critical — continue with resolved profile
    validated = resolved;
  }

  // Update candidates table with extracted data
  const name = profile.personal?.name?.value || 'Unknown';
  const headline = profile.personal?.headline?.value || null;
  const location = profile.personal?.location?.value || null;
  const email = profile.contact?.email?.value || null;
  const phone = profile.contact?.phone?.value || null;
  const linkedinUrl = profile.contact?.linkedin?.value || null;
  const githubUrl = profile.contact?.github?.value || null;
  const summary = profile.personal?.summary || null;
  const skillsJson = JSON.stringify((profile.skills || []).map((s: any) => ({
    name: s.canonical || s.raw,
    category: s.category || 'unknown',
  })));
  const companiesJson = JSON.stringify((profile.experience || []).map((e: any) => ({
    name: e.company?.value || e.company?.raw || 'Unknown',
    title: e.title?.value || e.title?.raw || 'Unknown',
    from: e.startDate?.value || null,
    to: e.endDate?.value || null,
  })));
  const workHistoryJson = JSON.stringify((profile.experience || []).map((e: any) => ({
    company: e.company?.value || e.company?.raw || 'Unknown',
    title: e.title?.value || e.title?.raw || 'Unknown',
    from: e.startDate?.value || null,
    to: e.endDate?.value || null,
    description: e.description || '',
    achievements: e.achievements || [],
    is_current: e.isCurrent || false,
  })));
  const educationJson = JSON.stringify((profile.education || []).map((e: any) => ({
    school: e.institution?.value || e.institution?.raw || 'Unknown',
    degree: e.degree?.value || e.degree?.raw || null,
    field: e.field?.value || e.field?.raw || null,
    year: e.year?.value || null,
    gpa: e.gpa?.value || null,
  })));
  const projectsJson = JSON.stringify((profile.projects || []).map((p: any) => ({
    name: p.name?.value || p.name?.raw || 'Unknown',
    description: p.description?.value || '',
    tech: p.technologies || [],
  })));
  const certificationsJson = JSON.stringify((profile.certifications || []).map((c: any) => ({
    name: c.name?.value || c.name?.raw || 'Unknown',
    issuer: c.issuer?.value || null,
    year: c.year?.value || null,
  })));
  const languagesJson = JSON.stringify((profile.languages || []).map((l: any) => ({
    name: l.name?.value || l.name?.raw || 'Unknown',
    proficiency: l.proficiency?.value || null,
  })));
  const experienceYears = profile.experience?.length
    ? Math.max(...profile.experience.map((e: any) => {
        const start = new Date(e.startDate?.value || Date.now());
        const end = e.endDate?.value === 'Present' ? new Date() : new Date(e.endDate?.value || Date.now());
        return Math.round((end.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      }))
    : null;

  await pool.query(
    `UPDATE candidates SET
      name = $2, headline = $3, location = $4, email = $5, phone = $6,
      linkedin_url = $7, github_url = $8, summary = $9, experience_years = $10,
      skills = $11, companies = $12, work_history = $13, education = $14,
      projects = $15, certifications = $16, languages = $17,
      parse_status = 'completed', parse_error = NULL, updated_at = NOW()
    WHERE id = $1`,
    [
      candidateId, name, headline, location, email, phone,
      linkedinUrl, githubUrl, summary, experienceYears,
      skillsJson, companiesJson, workHistoryJson, educationJson,
      projectsJson, certificationsJson, languagesJson,
    ],
  );

  // Phase 4: Embedding (metadata only; vectors go to Qdrant)
  await setStage('candidate', candidateId, 'embedding', 'running');
  try {
    const { generateEmbeddings } = await import('../services/openai.js');
    const fullText = [name, headline, location, summary, skillsJson, doc.plainText || ''].filter(Boolean).join(' ');
    const skillsText = (profile.skills || []).map((s: any) => s.canonical || s.raw).join(' ');
    const roleText = headline || '';
    await generateEmbeddings([fullText, skillsText, roleText])
    const embedDim = parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10)
    for (const purpose of ['full_text', 'skills', 'role']) {
      await pool.query(
        `INSERT INTO embeddings (id, entity_type, entity_id, purpose, model, dimensions, created_at)
         VALUES (gen_random_uuid(), 'candidate', $1, $2, 'text-embedding-3-small', $3, NOW())
         ON CONFLICT (entity_type, entity_id, purpose) DO NOTHING`,
        [candidateId, purpose, embedDim],
      );
    }
    await completeStage('candidate', candidateId, 'embedding');
  } catch (err) {
    await failStage('candidate', candidateId, 'embedding', err);
  }

  // Phase 4b: Qdrant Indexing
  await setStage('candidate', candidateId, 'indexing', 'running');
  try {
    const { getEmbeddingService } = await import('../modules/vector-intelligence/factory.js');
    const svc = getEmbeddingService();
    if (svc) {
      await svc.indexCandidateProfileSync(profile);
    }
    await completeStage('candidate', candidateId, 'indexing');
  } catch (err) {
    console.error('[CandidatePipeline] Qdrant indexing failed (non-critical):', err);
    await completeStage('candidate', candidateId, 'indexing');
  }

  // Phase 4c: Legacy matching
  await setStage('candidate', candidateId, 'matching', 'running');
  try {
    const { matchCandidateToAllJobs } = await import('../scoring/index.js');
    await matchCandidateToAllJobs(candidateId);
    await completeStage('candidate', candidateId, 'matching');
  } catch (err) {
    console.error('[CandidatePipeline] Legacy matching failed (non-critical):', err);
    await completeStage('candidate', candidateId, 'matching');
  }

  console.log(`[CandidatePipeline] Completed full pipeline for candidate: ${candidateId}`);
}
