import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchAllProviders } from '../services/search-orchestrator.js'
import { generateEmbeddings } from '../services/openai.js'

export const searchAllRouter = Router()

const SearchAllSchema = z.object({
  providers: z.array(z.enum(['pdl', 'github', 'stackoverflow', 'kaggle'])).min(1),
  jobTitle: z.string().max(200).optional(),
  skills: z.array(z.string().max(100)).max(50).optional(),
  country: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  experience: z.string().max(20).optional(),
  keywords: z.string().max(200).optional(),
  ghQuery: z.string().max(200).optional(),
  language: z.string().max(50).optional(),
  location: z.string().max(100).optional(),
  minFollowers: z.number().int().min(0).optional(),
  minRepos: z.number().int().min(0).optional(),
  soTag: z.string().max(200).optional(),
  minReputation: z.number().int().min(0).optional(),
  kaggleQuery: z.string().max(200).optional(),
  kaggleSortBy: z.enum(['votes', 'hotness', 'dateCreated', 'viewCount']).optional(),
  size: z.number().int().min(1).max(100).optional(),
})

searchAllRouter.post('/search-all', async (req: Request, res: Response) => {
  try {
    const body = SearchAllSchema.parse(req.body)

    console.log('[SearchAll] Request:', JSON.stringify({ providers: body.providers, size: body.size }))

    const result = await searchAllProviders(body)

    console.log(`[SearchAll] Returned ${result.candidates.length} unified candidates`)

    const saved: string[] = []

    for (const candidate of result.candidates) {
      try {
        const primarySource = candidate.sources[0]
        let existing = null

        if (candidate.githubUrl) {
          existing = await db.selectFrom('candidates')
            .select(['id'])
            .where('github_url', '=', candidate.githubUrl)
            .executeTakeFirst()
        }
        if (!existing && candidate.linkedinUrl) {
          existing = await db.selectFrom('candidates')
            .select(['id'])
            .where('linkedin_url', '=', candidate.linkedinUrl)
            .executeTakeFirst()
        }
        if (!existing && candidate.raw.pdl?.pdlId) {
          existing = await db.selectFrom('candidates')
            .select(['id'])
            .where('pdl_id', '=', candidate.raw.pdl.pdlId)
            .executeTakeFirst()
        }

        const skillsJson = JSON.stringify(candidate.skills.map(s => ({ name: s })))
        const headline = [candidate.title, candidate.company].filter(Boolean).join(' at ')
        const sourcesStr = candidate.sources.join(',')

        if (existing) {
          await db.updateTable('candidates')
            .set({
              name: candidate.name,
              headline: headline || candidate.name,
              location: candidate.location,
              skills: skillsJson,
              github_url: candidate.githubUrl,
              linkedin_url: candidate.linkedinUrl,
              source: sourcesStr,
              updated_at: new Date(),
            })
            .where('id', '=', existing.id)
            .execute()
          saved.push(existing.id)

          // Generate embeddings asynchronously (non-blocking)
          const candidateId = existing.id
          const fullText = `${candidate.name} ${headline || ''} ${candidate.location || ''} ${candidate.skills.join(' ')}`
          generateEmbeddings([fullText, candidate.skills.join(' '), headline || candidate.name])
            .then(([fullVec, skillsVec, roleVec]) => {
              return Promise.all([
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'full_text', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), candidateId, fullVec]
                ),
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'skills', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), candidateId, skillsVec]
                ),
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'role', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), candidateId, roleVec]
                ),
              ])
            })
            .catch(err => console.error(`[SearchAll] Embedding failed for ${candidate.name}:`, err.message))
        } else {
          const now = new Date()
          const newId = randomUUID()
          await db.insertInto('candidates')
            .values({
              id: newId,
              name: candidate.name,
              location: candidate.location,
              headline: headline || candidate.name,
              github_url: candidate.githubUrl,
              linkedin_url: candidate.linkedinUrl,
              skills: skillsJson,
              source: sourcesStr,
              parse_status: 'completed',
              stage: 'new',
              experience_years: candidate.experience || 0,
              pdl_id: candidate.raw.pdl?.pdlId || null,
              created_at: now,
              updated_at: now,
            })
            .execute()
          saved.push(newId)

          // Generate embeddings asynchronously (non-blocking)
          const fullText = `${candidate.name} ${headline || ''} ${candidate.location || ''} ${candidate.skills.join(' ')}`
          generateEmbeddings([fullText, candidate.skills.join(' '), headline || candidate.name])
            .then(([fullVec, skillsVec, roleVec]) => {
              return Promise.all([
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'full_text', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), newId, fullVec]
                ),
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'skills', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), newId, skillsVec]
                ),
                pool.query(
                  `INSERT INTO embeddings (id, entity_type, entity_id, purpose, vector, model, created_at)
                   VALUES ($1, 'candidate', $2, 'role', $3, 'text-embedding-3-small', NOW())
                   ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $3, model = 'text-embedding-3-small'`,
                  [randomUUID(), newId, roleVec]
                ),
              ])
            })
            .catch(err => console.error(`[SearchAll] Embedding failed for ${candidate.name}:`, err.message))
        }
      } catch (err: any) {
        console.error(`[SearchAll] Failed to upsert candidate ${candidate.name}:`, err.message)
      }
    }

    res.json({
      candidates: result.candidates,
      totals: result.totals,
      saved: saved.length,
    })

    // Auto-save to search history
    try {
      const parts: string[] = []
      if (body.jobTitle) parts.push(body.jobTitle)
      if (body.skills?.length) parts.push(body.skills.join(', '))
      if (body.ghQuery) parts.push(`GH: ${body.ghQuery}`)
      if (body.soTag) parts.push(`SO: ${body.soTag}`)
      if (body.kaggleQuery) parts.push(`Kaggle: ${body.kaggleQuery}`)
      if (body.country) parts.push(body.country)
      const queryLabel = parts.join(' · ') || 'Multi-provider search'
      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'all', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), queryLabel, JSON.stringify(body), result.candidates.length, saved.length, saved],
      )
    } catch (err) {
      console.error('[SearchAll] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }
    console.error('[SearchAll] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
