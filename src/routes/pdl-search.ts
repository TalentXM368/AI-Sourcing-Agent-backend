import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchPersons, PdlError } from '../services/people-data-labs.js'
import { generateEmbeddings } from '../services/openai.js'
import { matchCandidateToAllJobs } from '../scoring/index.js'

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

    // Generate embeddings for saved candidates (async, non-blocking)
    if (saved.length > 0) {
      generatePdlEmbeddings(saved).catch(err => {
        console.error('[PDL Search] Embedding generation failed:', err.message)
      })
    }

    res.json({
      candidates: result.candidates,
      total: result.total,
      scroll_token: result.scrollToken,
      saved: saved.length,
    })
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

// ─── Helper: Generate Embeddings for PDL Candidates ──────────

async function generatePdlEmbeddings(candidateIds: string[]) {
  for (const id of candidateIds) {
    try {
      const candidate = await db.selectFrom('candidates')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!candidate) continue

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
           VALUES ($1, 'candidate', $2, $3, $4, 'text-embedding-3-small', NOW())
           ON CONFLICT (entity_type, entity_id, purpose) DO UPDATE SET vector = $4, model = 'text-embedding-3-small'`,
          [randomUUID(), id, purpose, vector]
        )
      }

      // Score this candidate against all open jobs
      try {
        await matchCandidateToAllJobs(id)
        console.log(`[PDL Search] Scored candidate ${candidate.name} against all jobs`)
      } catch (scoreErr: any) {
        console.error(`[PDL Search] Scoring failed for candidate ${id}:`, scoreErr.message)
      }
    } catch (err: any) {
      console.error(`[PDL Search] Embedding failed for candidate ${id}:`, err.message)
    }
  }
}
