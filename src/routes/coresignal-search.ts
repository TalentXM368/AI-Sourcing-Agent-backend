import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchCoresignalUsers, CoresignalError } from '../services/coresignal.js'
import { generateEmbeddings } from '../services/openai.js'

export const coresignalSearchRouter = Router()

// ─── Zod Validation ──────────────────────────────────────────

const CoresignalSearchSchema = z.object({
  query: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  skills: z.array(z.string().max(100)).max(50).optional(),
  location: z.string().max(100).optional(),
  company: z.string().max(100).optional(),
  size: z.number().int().min(1).max(1000).optional(),
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

// ─── POST /api/candidates/search-coresignal ──────────────────

coresignalSearchRouter.post('/search-coresignal', async (req: Request, res: Response) => {
  try {
    const body = CoresignalSearchSchema.parse(req.body)

    console.log('[Coresignal Search] Request:', JSON.stringify(body))

    const result = await searchCoresignalUsers(body)

    console.log(`[Coresignal Search] Found ${result.total} candidates, returning ${result.users.length}`)

    // Upsert each user into the candidates table
    const saved: string[] = []
    for (const user of result.users) {
      try {
        const coresignalIdStr = String(user.id)

        // ─── Build candidate data ───────────────────────
        const skillsJson = JSON.stringify(user.skills.map(s => ({ name: s })))
        const headline = [user.currentTitle, user.currentCompany].filter(Boolean).join(' at ') || user.fullName
        const experienceYears = user.experience.length > 0
          ? Math.max(...user.experience.map(e => e.isCurrent ? 5 : 2))
          : 0

        // ─── Atomic upsert: check coresignal_id first, then linkedin_url ──
        // 1. Try to find existing by coresignal_id
        let existing = await db.selectFrom('candidates')
          .select(['id'])
          .where('coresignal_id', '=', coresignalIdStr)
          .executeTakeFirst()

        // 2. If not found, check by linkedin_url (catches PDL duplicates)
        if (!existing && user.profileUrl) {
          existing = await db.selectFrom('candidates')
            .select(['id'])
            .where('linkedin_url', '=', user.profileUrl)
            .executeTakeFirst()
        }

        if (existing) {
          // UPDATE existing — atomic: re-check coresignal_id hasn't been set by a concurrent request
          const reassigned = await db.selectFrom('candidates')
            .select(['id', 'coresignal_id'])
            .where('id', '=', existing.id)
            .executeTakeFirst()

          if (reassigned?.coresignal_id && reassigned.coresignal_id !== coresignalIdStr) {
            // Another request already set a different coresignal_id — skip update
            console.log(`[Coresignal Search] Skipping ${user.fullName}: existing record ${existing.id} already has coresignal_id=${reassigned.coresignal_id}`)
            continue
          }

          await db.updateTable('candidates')
            .set({
              name: user.fullName || undefined,
              headline: headline || user.fullName || undefined,
              location: user.location || undefined,
              skills: skillsJson,
              linkedin_url: user.profileUrl || undefined,
              portfolio_url: user.profileUrl || undefined,
              source: 'coresignal',
              coresignal_id: coresignalIdStr,
              updated_at: new Date(),
            })
            .where('id', '=', existing.id)
            .execute()

          saved.push(existing.id)
        } else {
          // INSERT new — ON CONFLICT handles race condition
          const now = new Date()
          const newId = randomUUID()

          // Use raw SQL for atomic ON CONFLICT to prevent race conditions
          const insertResult = await pool.query(
            `INSERT INTO candidates (id, name, headline, location, skills, linkedin_url, portfolio_url, source, coresignal_id, parse_status, stage, experience_years, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'completed', 'new', $10, $11, $11)
             ON CONFLICT (coresignal_id) DO UPDATE SET
               name = EXCLUDED.name,
               headline = EXCLUDED.headline,
               location = EXCLUDED.location,
               skills = EXCLUDED.skills,
               linkedin_url = EXCLUDED.linkedin_url,
               portfolio_url = EXCLUDED.portfolio_url,
               source = EXCLUDED.source,
               updated_at = EXCLUDED.updated_at
             RETURNING id`,
            [newId, user.fullName || 'Unknown', headline || user.fullName || 'Unknown', user.location, skillsJson, user.profileUrl, user.profileUrl, 'coresignal', coresignalIdStr, experienceYears, now],
          )

          saved.push(insertResult.rows[0].id)
        }
      } catch (err: any) {
        console.error(`[Coresignal Search] Failed to upsert user ${user.fullName}:`, err.message)
      }
    }

    // Index saved candidates into embeddings + Qdrant (async, non-blocking)
    if (saved.length > 0) {
      indexCoresignalCandidates(saved).catch(err => {
        console.error('[Coresignal Search] Indexing failed:', err.message)
      })
    }

    res.json({
      candidates: result.users,
      total: result.total,
      saved: saved.length,
    })

    // Auto-save to search history
    try {
      const parts: string[] = []
      if (body.jobTitle) parts.push(body.jobTitle)
      if (body.skills?.length) parts.push(body.skills.join(', '))
      if (body.location) parts.push(body.location)
      if (body.company) parts.push(body.company)
      const queryLabel = parts.join(' · ') || body.query || 'Coresignal search'

      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'coresignal', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), queryLabel, JSON.stringify(body), result.total, saved.length, saved],
      )
    } catch (err) {
      console.error('[Coresignal Search] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    if (error instanceof CoresignalError) {
      return res.status(error.statusCode).json({ error: error.message })
    }

    console.error('[Coresignal Search] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Index Coresignal Candidates (Embed + Qdrant only, NO scoring) ──

async function indexCoresignalCandidates(candidateIds: string[]) {
  for (const id of candidateIds) {
    try {
      const candidate = await db.selectFrom('candidates')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!candidate) continue

      console.log(`[Coresignal Index] Indexing candidate: ${candidate.name} (${id})`)

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
        console.log(`[Coresignal Index] Embeddings generated for ${candidate.name}`)
      } catch (err) {
        await failStage('candidate', id, 'embedding', err)
        console.error(`[Coresignal Index] Embedding failed for ${candidate.name}:`, err)
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

          const profile = {
            candidateId: id,
            personal: {
              name: { value: candidate.name || 'Unknown', confidence: 1, source: 'coresignal' as const },
              headline: { value: candidate.headline || null, confidence: 0.9, source: 'coresignal' as const },
              location: { value: candidate.location || null, confidence: 0.9, source: 'coresignal' as const },
              summary: candidate.summary || null,
            },
            contact: {
              email: { value: null, confidence: 0, source: 'coresignal' as const },
              phone: { value: null, confidence: 0, source: 'coresignal' as const },
              linkedin: { value: candidate.linkedin_url || null, confidence: 0.9, source: 'coresignal' as const },
              github: { value: null, confidence: 0, source: 'coresignal' as const },
            },
            skills: skillsArr.map((s: any) => ({
              raw: s.name || s,
              canonical: s.name || s,
              category: 'technology',
              confidence: 0.85,
              source: 'coresignal' as const,
            })),
            experience: [],
            education: [],
            projects: [],
            certifications: [],
            languages: [],
            metadata: {
              overallConfidence: 0.85,
              dataQualityScore: 0.8,
              completenessScore: 0.7,
              processingTimestamp: new Date().toISOString(),
              extractionMethod: 'coresignal' as const,
            },
          }

          await svc.indexCandidateProfileSync(profile as any)
          console.log(`[Coresignal Index] Qdrant indexed ${candidate.name}`)
        }
        await completeStage('candidate', id, 'indexing')
      } catch (err) {
        console.error(`[Coresignal Index] Qdrant indexing failed (non-critical) for ${candidate.name}:`, err)
        await completeStage('candidate', id, 'indexing')
      }

      console.log(`[Coresignal Index] Completed indexing for ${candidate.name} (embedded + indexed, not scored)`)
    } catch (err: any) {
      console.error(`[Coresignal Index] Failed for candidate ${id}:`, err.message)
    }
  }
}
