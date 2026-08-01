import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db, pool } from '../db/index.js'
import { randomUUID } from 'crypto'
import { searchGithubUsers } from '../services/github-search.js'

export const githubSearchRouter = Router()

// ─── Zod Validation ──────────────────────────────────────────

const GithubSearchSchema = z.object({
  query: z.string().min(1).max(200),
  language: z.string().max(50).optional(),
  location: z.string().max(100).optional(),
  minFollowers: z.number().int().min(0).optional(),
  minRepos: z.number().int().min(0).optional(),
  size: z.number().int().min(1).max(100).optional(),
})

// ─── POST /api/candidates/search-github ──────────────────────

githubSearchRouter.post('/search-github', async (req: Request, res: Response) => {
  try {
    const body = GithubSearchSchema.parse(req.body)

    console.log('[GitHub Search] Request:', JSON.stringify(body))

    const { users, total } = await searchGithubUsers(body)

    console.log(`[GitHub Search] Found ${total} users, fetched ${users.length} profiles`)

    const saved = []
    for (const user of users) {
      try {
        const existing = await db.selectFrom('candidates')
          .select(['id'])
          .where('github_url', '=', user.htmlUrl)
          .executeTakeFirst()

        const skillsJson = JSON.stringify(user.languages.map(l => ({ name: l })))
        const companiesJson = user.company ? JSON.stringify([{ name: user.company }]) : '[]'

        if (existing) {
          await db.updateTable('candidates')
            .set({
              name: user.name || user.login,
              email: user.email || null,
              location: user.location || null,
              headline: user.bio ? user.bio.slice(0, 200) : null,
              github_url: user.htmlUrl,
              skills: skillsJson,
              companies: companiesJson,
              source: 'github',
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
              name: user.name || user.login,
              email: user.email || null,
              location: user.location || null,
              headline: user.bio ? user.bio.slice(0, 200) : null,
              github_url: user.htmlUrl,
              skills: skillsJson,
              companies: companiesJson,
              source: 'github',
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
        console.error(`[GitHub Search] Failed to upsert user ${user.login}:`, err.message)
      }
    }

    res.json({
      users,
      total,
      saved: saved.length,
    })

    // Auto-save to search history
    try {
      await pool.query(
        `INSERT INTO search_history (id, source, query, filters, result_count, saved_count, candidate_ids, created_at)
         VALUES ($1, 'github', $2, $3, $4, $5, $6, NOW())`,
        [randomUUID(), body.query, JSON.stringify(body), total, saved.length, saved],
      )
    } catch (err) {
      console.error('[GitHub Search] Failed to save search history:', err)
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      })
    }

    console.error('[GitHub Search] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
