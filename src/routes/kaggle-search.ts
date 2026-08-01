import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchKaggleUsers } from '../services/kaggle-search.js'
import { generateEmbeddings } from '../services/openai.js'

export const kaggleSearchRouter = Router()

// ─── Zod Validation ──────────────────────────────────────────

const KaggleSearchSchema = z.object({
  query: z.string().min(1).max(200),
  sortBy: z.enum(['votes', 'hotness', 'dateCreated', 'viewCount']).optional(),
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

// ─── POST /api/candidates/search-kaggle ──────────────────────

kaggleSearchRouter.post('/search-kaggle', async (req: Request, res: Response) => {
  try {
    const body = KaggleSearchSchema.parse(req.body)

    console.log('[Kaggle Search] Request:', JSON.stringify(body))

    const result = await searchKaggleUsers(body)

    console.log(`[Kaggle Search] Found ${result.total} unique authors, returning ${result.users.length}`)

    // Upsert each user into the candidates table
    const saved = []
    for (const user of result.users) {
      try {
        const profileUrl = user.profileUrl
        const existing = await db.selectFrom('candidates')
          .select(['id'])
          .where('portfolio_url', '=', profileUrl)
          .executeTakeFirst()

        // Build skills from searched topics + top dataset/kernel titles
        const topics = user.searchedTopics.split(',').map(t => t.trim()).filter(Boolean)
        const datasetTopics = user.topDatasets.map(d => d.title).slice(0, 3)
        const kernelTopics = user.topKernels.map(k => k.title).slice(0, 3)
        const allTopics = [...new Set([...topics, ...datasetTopics, ...kernelTopics])].slice(0, 10)
        const skillsJson = JSON.stringify(allTopics.map(t => ({ name: t })))

        const headline = [
          `${user.datasetCount} datasets`,
          `${user.kernelCount} kernels`,
          `${user.totalVotes.toLocaleString()} votes`,
        ].join(' · ')

        if (existing) {
          await db.updateTable('candidates')
            .set({
              name: user.displayName || user.username,
              headline,
              skills: skillsJson,
              portfolio_url: profileUrl,
              source: 'kaggle',
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
              name: user.displayName || user.username,
              headline,
              skills: skillsJson,
              portfolio_url: profileUrl,
              source: 'kaggle',
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
        console.error(`[Kaggle Search] Failed to upsert user ${user.username}:`, err.message)
      }
    }

    // Index saved candidates into embeddings + Qdrant (async, non-blocking)
    if (saved.length > 0) {
      indexKaggleCandidates(saved).catch(err => {
        console.error('[Kaggle Search] Indexing failed:', err.message)
      })
    }

    res.json({
      users: result.users,
      total: result.total,
      saved: saved.length,
    })

    // Auto-save to search history
    try {
      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'kaggle', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), body.query, JSON.stringify(body), result.total, saved.length, saved],
      )
    } catch (err) {
      console.error('[Kaggle Search] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    console.error('[Kaggle Search] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Index Kaggle Candidates (Embed + Qdrant only, NO scoring) ──

async function indexKaggleCandidates(candidateIds: string[]) {
  for (const id of candidateIds) {
    try {
      const candidate = await db.selectFrom('candidates')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!candidate) continue

      console.log(`[Kaggle Index] Indexing candidate: ${candidate.name} (${id})`)

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
        console.log(`[Kaggle Index] Embeddings generated for ${candidate.name}`)
      } catch (err) {
        await failStage('candidate', id, 'embedding', err)
        console.error(`[Kaggle Index] Embedding failed for ${candidate.name}:`, err)
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
              name: { value: candidate.name || 'Unknown', confidence: 1, source: 'kaggle' as const },
              headline: { value: candidate.headline || null, confidence: 0.9, source: 'kaggle' as const },
              location: { value: candidate.location || null, confidence: 0.9, source: 'kaggle' as const },
              summary: candidate.summary || null,
            },
            contact: {
              email: { value: null, confidence: 0, source: 'kaggle' as const },
              phone: { value: null, confidence: 0, source: 'kaggle' as const },
              linkedin: { value: null, confidence: 0, source: 'kaggle' as const },
              github: { value: null, confidence: 0, source: 'kaggle' as const },
            },
            skills: skillsArr.map((s: any) => ({
              raw: s.name || s,
              canonical: s.name || s,
              category: 'technology',
              confidence: 0.85,
              source: 'kaggle' as const,
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
              extractionMethod: 'kaggle' as const,
            },
          }

          await svc.indexCandidateProfileSync(profile as any)
          console.log(`[Kaggle Index] Qdrant indexed ${candidate.name}`)
        }
        await completeStage('candidate', id, 'indexing')
      } catch (err) {
        console.error(`[Kaggle Index] Qdrant indexing failed (non-critical) for ${candidate.name}:`, err)
        await completeStage('candidate', id, 'indexing')
      }

      console.log(`[Kaggle Index] Completed indexing for ${candidate.name} (embedded + indexed, not scored)`)
    } catch (err: any) {
      console.error(`[Kaggle Index] Failed for candidate ${id}:`, err.message)
    }
  }
}
