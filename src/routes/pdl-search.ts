import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchPersons, PdlError } from '../services/people-data-labs.js'
import { generateEmbeddings } from '../services/openai.js'

export const pdlSearchRouter = Router()

// ─── Zod Validation ──────────────────────────────────────────

const PdlSearchSchema = z.object({
  jobTitle: z.string().max(200).optional(),
  skills: z.array(z.string().max(100)).max(50).optional(),
  country: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  experience: z.string().max(20).optional(),
  keywords: z.string().max(200).optional(),
  size: z.number().int().min(1).max(100).optional(),
})

// ─── Processing Status Helpers ───────────────────────────────

const setStage = async (entityType: string, entityId: string, stage: string, status: string, message?: string) => {
  await pool.query(
    `INSERT INTO processing_status (id, entity_type, entity_id, stage, status, progress, message, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, $5, NOW(), NOW())
     ON CONFLICT (entity_type, entity_id, stage) DO UPDATE SET status = $4, progress = 0, message = $5, updated_at = NOW()`,
    [entityType, entityId, stage, status, message || null],
  )
}

const completeStage = async (entityType: string, entityId: string, stage: string) => {
  await pool.query(
    `UPDATE processing_status SET status = 'completed', progress = 100, updated_at = NOW()
     WHERE entity_type = $1 AND entity_id = $2 AND stage = $3`,
    [entityType, entityId, stage],
  )
}

const failStage = async (entityType: string, entityId: string, stage: string, error: unknown) => {
  await pool.query(
    `UPDATE processing_status SET status = 'failed', message = $4, updated_at = NOW()
     WHERE entity_type = $1 AND entity_id = $2 AND stage = $3`,
    [entityType, entityId, stage, error instanceof Error ? error.message : String(error)],
  )
}

// ─── POST /api/candidates/search ─────────────────────────────

pdlSearchRouter.post('/search', async (req: Request, res: Response) => {
  try {
    const body = PdlSearchSchema.parse(req.body)

    console.log('[PDL Search] Request:', JSON.stringify(body))

    const result = await searchPersons(body)

    console.log(`[PDL Search] Found ${result.total} results, normalized ${result.candidates.length}`)

    // Upsert each candidate into the existing candidates table
    const saved = []
    for (const candidate of result.candidates) {
      try {
        // Check if candidate already exists by pdl_id
        const existing = await db.selectFrom('candidates')
          .select(['id'])
          .where('pdl_id', '=', candidate.pdlId)
          .executeTakeFirst()

        if (existing) {
          // Update existing candidate
          await db.updateTable('candidates')
            .set({
              name: candidate.fullName || 'Unknown',
              email: candidate.emails[0] || null,
              phone: candidate.phoneNumbers[0] || null,
              linkedin_url: candidate.linkedinUrl,
              github_url: candidate.githubUrl,
              headline: candidate.headline,
              location: candidate.location,
              skills: JSON.stringify(candidate.skills.map(s => ({ name: s }))),
              companies: JSON.stringify(candidate.companyName ? [{ name: candidate.companyName, title: candidate.jobTitle }] : []),
              work_history: JSON.stringify(candidate.jobTitle ? [{
                title: candidate.jobTitle,
                company: candidate.companyName || '',
                is_current: true,
              }] : []),
              industry: candidate.industry,
              source: 'pdl',
              updated_at: new Date(),
            })
            .where('pdl_id', '=', candidate.pdlId)
            .execute()

          saved.push(existing.id)
        } else {
          // Insert new candidate
          const now = new Date()
          const newId = randomUUID()
          await db.insertInto('candidates')
            .values({
              id: newId,
              name: candidate.fullName || 'Unknown',
              email: candidate.emails[0] || null,
              phone: candidate.phoneNumbers[0] || null,
              linkedin_url: candidate.linkedinUrl,
              github_url: candidate.githubUrl,
              headline: candidate.headline,
              location: candidate.location,
              skills: JSON.stringify(candidate.skills.map(s => ({ name: s }))),
              companies: JSON.stringify(candidate.companyName ? [{ name: candidate.companyName, title: candidate.jobTitle }] : []),
              work_history: JSON.stringify(candidate.jobTitle ? [{
                title: candidate.jobTitle,
                company: candidate.companyName || '',
                is_current: true,
              }] : []),
              industry: candidate.industry,
              pdl_id: candidate.pdlId,
              source: 'pdl',
              parse_status: 'completed',
              stage: 'new',
              experience_years: 0,
              created_at: now,
              updated_at: now,
            })
            .execute()

          saved.push(newId)
        }
      } catch (err: any) {
        console.error(`[PDL Search] Failed to upsert candidate ${candidate.pdlId}:`, err.message)
      }
    }

    // Index saved candidates into embeddings + Qdrant (async, non-blocking)
    // NO scoring — candidates are ranked on-demand when a JD is created or re-ranked
    if (saved.length > 0) {
      indexPdlCandidates(saved).catch(err => {
        console.error('[PDL Search] Indexing failed:', err.message)
      })
    }

    res.json({
      candidates: result.candidates,
      total: result.total,
      scroll_token: result.scrollToken,
      saved: saved.length,
    })

    // Auto-save to search history
    try {
      const parts = [body.jobTitle, body.skills?.join(', '), body.country, body.industry, body.keywords].filter(Boolean)
      const queryLabel = parts.join(' · ') || 'PDL search'
      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'pdl', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), queryLabel, JSON.stringify(body), result.total, saved.length, saved],
      )
    } catch (err) {
      console.error('[PDL Search] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    if (error instanceof PdlError) {
      return res.status(error.statusCode).json({ error: error.message })
    }

    console.error('[PDL Search] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Index PDL Candidates (Embed + Qdrant only, NO scoring) ─
// Scoring happens on-demand when a JD is created or recruiter clicks "Re-rank"

async function indexPdlCandidates(candidateIds: string[]) {
  for (const id of candidateIds) {
    try {
      const candidate = await db.selectFrom('candidates')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!candidate) continue

      console.log(`[PDL Index] Indexing candidate: ${candidate.name} (${id})`)

      // Phase 1: Generate Embeddings (PostgreSQL)
      await setStage('candidate', id, 'embedding', 'running')
      try {
        const skillsArr = typeof candidate.skills === 'string'
          ? JSON.parse(candidate.skills)
          : Array.isArray(candidate.skills) ? candidate.skills : []
        const skillsText = skillsArr.map((s: any) => s.name).join(' ') || ''
        const fullText = `${candidate.name} ${candidate.headline || ''} ${candidate.location || ''} ${skillsText}`
        const roleText = candidate.headline || candidate.name

        const [fullVec, skillsVec, roleVec] = await generateEmbeddings([fullText, skillsText, roleText])

        for (const [purpose, vector] of [['full_text', fullVec], ['skills', skillsVec], ['role', roleVec]] as const) {
          await pool.query(
            `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
             VALUES ($1, 'candidate', $2, $3, $4, $5, NOW())
             ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $4, model = $5`,
            [randomUUID(), id, purpose, vector, process.env.EMBEDDING_MODEL || 'local']
          )
        }
        await completeStage('candidate', id, 'embedding')
        console.log(`[PDL Index] Embeddings generated for ${candidate.name}`)
      } catch (err) {
        await failStage('candidate', id, 'embedding', err)
        console.error(`[PDL Index] Embedding failed for ${candidate.name}:`, err)
      }

      // Phase 2: Qdrant Indexing
      await setStage('candidate', id, 'indexing', 'running')
      try {
        const { getEmbeddingService } = await import('../modules/vector-intelligence/factory.js')
        const svc = getEmbeddingService()
        if (svc) {
          const skillsArr = typeof candidate.skills === 'string'
            ? JSON.parse(candidate.skills)
            : Array.isArray(candidate.skills) ? candidate.skills : []
          const workHistoryArr = typeof candidate.work_history === 'string'
            ? JSON.parse(candidate.work_history)
            : Array.isArray(candidate.work_history) ? candidate.work_history : []

          const profile = {
            candidateId: id,
            personal: {
              name: { value: candidate.name || 'Unknown', confidence: 1, source: 'pdl' as const },
              headline: { value: candidate.headline || null, confidence: 0.9, source: 'pdl' as const },
              location: { value: candidate.location || null, confidence: 0.9, source: 'pdl' as const },
              summary: candidate.summary || null,
            },
            contact: {
              email: { value: candidate.email || null, confidence: 0.9, source: 'pdl' as const },
              phone: { value: candidate.phone || null, confidence: 0.9, source: 'pdl' as const },
              linkedin: { value: candidate.linkedin_url || null, confidence: 0.9, source: 'pdl' as const },
              github: { value: candidate.github_url || null, confidence: 0.9, source: 'pdl' as const },
            },
            skills: skillsArr.map((s: any) => ({
              raw: s.name || s,
              canonical: s.name || s,
              category: s.category || 'unknown',
              confidence: 0.8,
              source: 'pdl' as const,
            })),
            experience: workHistoryArr.map((w: any) => ({
              company: { value: w.company || w.name || 'Unknown', confidence: 0.8, source: 'pdl' as const },
              title: { value: w.title || 'Unknown', confidence: 0.8, source: 'pdl' as const },
              startDate: { value: w.from || null, confidence: 0.7, source: 'pdl' as const },
              endDate: { value: w.to || (w.is_current ? 'Present' : null), confidence: 0.7, source: 'pdl' as const },
              description: w.description || null,
              achievements: w.achievements || [],
              isCurrent: w.is_current || false,
            })),
            education: [],
            projects: [],
            certifications: [],
            languages: [],
            metadata: {
              overallConfidence: 0.85,
              dataQualityScore: 0.85,
              completenessScore: 0.8,
              processingTimestamp: new Date().toISOString(),
              extractionMethod: 'pdl' as const,
            },
          }

          await svc.indexCandidateProfileSync(profile as any)
          console.log(`[PDL Index] Qdrant indexed ${candidate.name}`)
        }
        await completeStage('candidate', id, 'indexing')
      } catch (err) {
        console.error(`[PDL Index] Qdrant indexing failed (non-critical) for ${candidate.name}:`, err)
        await completeStage('candidate', id, 'indexing')
      }

      console.log(`[PDL Index] Completed indexing for ${candidate.name} (embedded + indexed, not scored)`)
    } catch (err: any) {
      console.error(`[PDL Index] Failed for candidate ${id}:`, err.message)
    }
  }
}
