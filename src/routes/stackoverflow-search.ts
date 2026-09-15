import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchStackoverflowUsers, searchTags } from '../services/stackoverflow-search.js'
import { generateEmbeddings } from '../services/openai.js'

export const stackoverflowSearchRouter = Router()

// ─── Zod Validation ──────────────────────────────────────────

const StackoverflowSearchSchema = z.object({
  tags: z.string().min(1).max(200),
  minReputation: z.number().int().min(0).optional(),
  location: z.string().max(100).optional(),
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

// ─── POST /api/candidates/search-stackoverflow ────────────────

stackoverflowSearchRouter.post('/search-stackoverflow', async (req: Request, res: Response) => {
  try {
    const body = StackoverflowSearchSchema.parse(req.body)

    console.log('[SO Search] Request:', JSON.stringify(body))

    const result = await searchStackoverflowUsers(body)

    console.log(`[SO Search] Found ${result.total} unique answerers, returning ${result.users.length}`)

    // Upsert each user into the candidates table
    const saved = []
    for (const user of result.users) {
      try {
        const soIdStr = String(user.userId)
        const existing = await db.selectFrom('candidates')
          .select(['id'])
          .where('so_id', '=', soIdStr)
          .executeTakeFirst()

        // Use searchedTags (the tags recruiter searched for) as skills — always populated
        const skillsSource = user.searchedTags || user.topTags || ''
        const skillsJson = skillsSource
          ? JSON.stringify(skillsSource.split(',').map((t: string) => ({ name: t.trim() })).filter((s: any) => s.name))
          : '[]'

        const headline = [
          `SO Rep: ${user.reputation.toLocaleString()}`,
          user.answerCount > 0 ? `${user.answerCount} answers` : '',
        ].filter(Boolean).join(' · ')

        if (existing) {
          await db.updateTable('candidates')
            .set({
              name: user.displayName,
              location: user.location || null,
              headline,
              skills: skillsJson,
              source: 'stackoverflow',
              updated_at: new Date(),
            })
            .where('id', '=', existing.id)
            .execute()

          saved.push(existing.id)
        } else {
          const now = new Date()
          const newId = randomUUID()
          await db.insertInto('candidates')
            .values({
              id: newId,
              name: user.displayName,
              location: user.location || null,
              headline,
              skills: skillsJson,
              so_id: soIdStr,
              source: 'stackoverflow',
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
        console.error(`[SO Search] Failed to upsert user ${user.displayName}:`, err.message)
      }
    }

    // Index saved candidates into embeddings + Qdrant (async, non-blocking)
    if (saved.length > 0) {
      indexSoCandidates(saved).catch(err => {
        console.error('[SO Search] Indexing failed:', err.message)
      })
    }

    res.json({
      users: result.users,
      total: result.total,
      saved: saved.length,
      invalidTags: result.invalidTags,
      suggestedTags: result.suggestedTags,
    })

    // Auto-save to search history
    try {
      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'stackoverflow', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), body.tags, JSON.stringify(body), result.total, saved.length, saved],
      )
    } catch (err) {
      console.error('[SO Search] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    console.error('[SO Search] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Index SO Candidates (Embed + Qdrant only, NO scoring) ──

async function indexSoCandidates(candidateIds: string[]) {
  for (const id of candidateIds) {
    try {
      const candidate = await db.selectFrom('candidates')
        .select(['id', 'name', 'email', 'phone', 'linkedin_url', 'github_url', 'portfolio_url', 'headline', 'location', 'summary', 'experience_years', 'skills', 'companies', 'work_history', 'education', 'projects', 'certifications', 'languages', 'resume_url', 'source_file', 'parse_status', 'data_quality_score', 'missing_fields', 'stage', 'industry', 'region', 'source', 'pdl_id', 'created_at', 'updated_at'])
        .where('id', '=', id)
        .executeTakeFirst() as any

      if (!candidate) continue

      console.log(`[SO Index] Indexing candidate: ${candidate.name} (${id})`)

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
        console.log(`[SO Index] Embeddings generated for ${candidate.name}`)
      } catch (err) {
        await failStage('candidate', id, 'embedding', err)
        console.error(`[SO Index] Embedding failed for ${candidate.name}:`, err)
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
              name: { value: candidate.name || 'Unknown', confidence: 1, source: 'stackoverflow' as const },
              headline: { value: candidate.headline || null, confidence: 0.9, source: 'stackoverflow' as const },
              location: { value: candidate.location || null, confidence: 0.9, source: 'stackoverflow' as const },
              summary: candidate.summary || null,
            },
            contact: {
              email: { value: null, confidence: 0, source: 'stackoverflow' as const },
              phone: { value: null, confidence: 0, source: 'stackoverflow' as const },
              linkedin: { value: null, confidence: 0, source: 'stackoverflow' as const },
              github: { value: null, confidence: 0, source: 'stackoverflow' as const },
            },
            skills: skillsArr.map((s: any) => ({
              raw: s.name || s,
              canonical: s.name || s,
              category: 'technology',
              confidence: 0.85,
              source: 'stackoverflow' as const,
            })),
            experience: [],
            education: [],
            projects: [],
            certifications: [],
            languages: [],
            metadata: {
              overallConfidence: 0.8,
              dataQualityScore: 0.75,
              completenessScore: 0.6,
              processingTimestamp: new Date().toISOString(),
              extractionMethod: 'stackoverflow' as const,
            },
          }

          await svc.indexCandidateProfileSync(profile as any)
          console.log(`[SO Index] Qdrant indexed ${candidate.name}`)
        }
        await completeStage('candidate', id, 'indexing')
      } catch (err) {
        console.error(`[SO Index] Qdrant indexing failed (non-critical) for ${candidate.name}:`, err)
        await completeStage('candidate', id, 'indexing')
      }

      console.log(`[SO Index] Completed indexing for ${candidate.name} (embedded + indexed, not scored)`)
    } catch (err: any) {
      console.error(`[SO Index] Failed for candidate ${id}:`, err.message)
    }
  }
}

// ─── GET /api/candidates/so-tags?q=python ─────────────────────

stackoverflowSearchRouter.get('/so-tags', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim()
    if (!q || q.length < 2) {
      return res.json({ tags: [] })
    }

    const tags = await searchTags(q, 10)
    res.json({ tags })
  } catch (error) {
    console.error('[SO Tags] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
