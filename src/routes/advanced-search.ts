import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { db } from '../db/index.js'
import { sql } from 'kysely'
import { getEmbeddingService, isVectorIntelligenceReady } from '../modules/vector-intelligence/factory.js'

export const advancedSearchRouter = Router()

// ─── Zod Schema for Advanced Filters ─────────────────────────

const AdvancedSearchSchema = z.object({
  keyword: z.string().max(500).optional(),
  location: z.array(z.string().max(200)).max(10).optional(),
  region: z.array(z.string().max(100)).max(5).optional(),
  experienceMin: z.number().min(0).max(50).optional(),
  experienceMax: z.number().min(0).max(50).optional(),
  skills: z.array(z.string().max(100)).max(20).optional(),
  skillsOperator: z.enum(['and', 'or']).optional(),
  excludeSkills: z.array(z.string().max(100)).max(10).optional(),
  currentCompany: z.array(z.string().max(200)).max(10).optional(),
  pastCompany: z.array(z.string().max(200)).max(10).optional(),
  industry: z.array(z.string().max(200)).max(10).optional(),
  school: z.array(z.string().max(200)).max(10).optional(),
  degree: z.array(z.string().max(200)).max(10).optional(),
  fieldOfStudy: z.array(z.string().max(200)).max(10).optional(),
  jobTitle: z.array(z.string().max(200)).max(10).optional(),
  seniority: z.enum(['entry', 'senior', 'manager', 'director', 'vp', 'c_level', 'intern']).optional(),
  source: z.array(z.enum(['resume', 'pdl', 'github', 'stackoverflow', 'kaggle'])).max(5).optional(),
  stage: z.array(z.enum(['new', 'contacted', 'screening', 'interviewing', 'offered', 'placed', 'rejected', 'withdrawn'])).max(8).optional(),
  dataQualityMin: z.number().min(0).max(100).optional(),
  dataQualityMax: z.number().min(0).max(100).optional(),
  hasLinkedin: z.boolean().optional(),
  hasGithub: z.boolean().optional(),
  hasPortfolio: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  hasPhone: z.boolean().optional(),
  hasResume: z.boolean().optional(),
  addedAfter: z.string().optional(),
  addedBefore: z.string().optional(),
  languages: z.array(z.string().max(50)).max(10).optional(),
  filterModes: z.record(z.enum(['must', 'may', 'must_not'])).optional(),
  sortBy: z.enum(['name', 'created_at', 'updated_at', 'experience_years', 'data_quality_score', 'stage_updated_at']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
})

type Filters = z.infer<typeof AdvancedSearchSchema>

// ─── Semantic Query Builder ─────────────────────────────────
// Builds a natural language query from filter values for Qdrant vector search

function buildSemanticQuery(filters: Filters): string | null {
  const parts: string[] = []

  if (filters.keyword?.trim()) {
    parts.push(filters.keyword.trim())
  }
  if (filters.skills?.length) {
    parts.push(`Skills: ${filters.skills.join(', ')}`)
  }
  if (filters.jobTitle?.length) {
    parts.push(`Role: ${filters.jobTitle.join(', ')}`)
  }
  if (filters.industry?.length) {
    parts.push(`Industry: ${filters.industry.join(', ')}`)
  }
  if (filters.currentCompany?.length) {
    parts.push(`Company: ${filters.currentCompany.join(', ')}`)
  }
  if (filters.school?.length) {
    parts.push(`Education: ${filters.school.join(', ')}`)
  }
  if (filters.degree?.length) {
    parts.push(`Degree: ${filters.degree.join(', ')}`)
  }

  const query = parts.join('. ')
  return query.length >= 3 ? query : null
}

const CANDIDATE_COLUMNS = [
  'candidates.id', 'candidates.name', 'candidates.email', 'candidates.phone',
  'candidates.linkedin_url', 'candidates.github_url', 'candidates.portfolio_url',
  'candidates.headline', 'candidates.location', 'candidates.summary',
  'candidates.experience_years', 'candidates.parse_status',
  'candidates.data_quality_score', 'candidates.missing_fields',
  'candidates.stage', 'candidates.stage_updated_at', 'candidates.industry',
  'candidates.region', 'candidates.source', 'candidates.created_at',
] as const

const LOCATION_ALIASES: Record<string, string[]> = {
  'united states': ['usa', 'us', 'u.s.', 'u.s.a.'],
  'usa': ['united states', 'us', 'u.s.'],
  'us': ['united states', 'usa', 'u.s.'],
  'united kingdom': ['uk', 'u.k.', 'england', 'great britain'],
  'uk': ['united kingdom', 'england', 'u.k.'],
  'india': ['bangalore', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai', 'banglore', 'bengaluru', 'gurgaon', 'noida'],
  'germany': ['berlin', 'munich', 'münchen', 'hamburg', 'frankfurt'],
  'canada': ['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'waterloo'],
  'australia': ['sydney', 'melbourne', 'brisbane'],
}

function applyFilters(filters: Filters) {
  return (eb: any) => {
    const c: any[] = []

    // Only completed candidates
    c.push(eb('candidates.parse_status', '=', 'completed'))

    if (filters.keyword?.trim()) {
      const kw = `%${filters.keyword.trim()}%`
      const kwCondition = eb.or([
        eb('candidates.name', 'ilike', kw),
        eb('candidates.headline', 'ilike', kw),
        eb('candidates.summary', 'ilike', kw),
        eb('candidates.location', 'ilike', kw),
        eb('candidates.region', 'ilike', kw),
        eb('candidates.industry', 'ilike', kw),
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.skills) AS s WHERE LOWER(COALESCE(s->>'name', s::text)) LIKE ${kw.toLowerCase()}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.companies) AS x WHERE x->>'name' ILIKE ${kw}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.work_history) AS w WHERE w->>'title' ILIKE ${kw} OR w->>'company' ILIKE ${kw}) `,
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.education) AS e WHERE e->>'school' ILIKE ${kw} OR e->>'degree' ILIKE ${kw}) `,
      ])
      const kwMode = filters.filterModes?.keyword || 'must'
      if (kwMode === 'must_not') {
        c.push(sql`NOT (${kwCondition})`)
      } else {
        c.push(kwCondition)
      }
    }

    if (filters.location?.length) {
      const locOrs = filters.location.map(loc => {
        const trimmed = loc.trim()
        const kw = `%${trimmed}%`
        const aliases = LOCATION_ALIASES[trimmed.toLowerCase()] || []
        if (aliases.length > 0) {
          const allTerms = [trimmed, ...aliases]
          const conditions = allTerms.flatMap(term => [
            sql`candidates.location ILIKE ${'%' + term + '%'}`,
            sql`candidates.region ILIKE ${'%' + term + '%'}`,
          ])
          return sql<boolean>` (${sql.join(conditions, sql` OR `)}) `
        }
        return sql<boolean>` (
          candidates.location ILIKE ${kw}
          OR candidates.region ILIKE ${kw}
        ) `
      })
      const locMode = filters.filterModes?.location || 'must'
      if (locMode === 'must_not') {
        c.push(sql`NOT (${sql.join(locOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(locOrs))
      }
    }

    if (filters.region?.length) {
      const regionOrs = filters.region.map(r =>
        eb('candidates.region', 'ilike', `%${r.trim()}%`)
      )
      const regionMode = filters.filterModes?.region || 'must'
      if (regionMode === 'must_not') {
        c.push(sql`NOT (${sql.join(regionOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(regionOrs))
      }
    }

    if (filters.experienceMin !== undefined) {
      c.push(eb('candidates.experience_years', '>=', filters.experienceMin))
    }
    if (filters.experienceMax !== undefined) {
      c.push(eb('candidates.experience_years', '<=', filters.experienceMax))
    }

    if (filters.skills?.length) {
      const skillOrs = filters.skills.map(skill =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.skills) AS s WHERE LOWER(COALESCE(s->>'name', s::text)) LIKE ${`%${skill.toLowerCase()}%`}) `
      )
      const skillMode = filters.filterModes?.skills || 'must'
      if (skillMode === 'must_not') {
        c.push(sql`NOT (${sql.join(skillOrs, sql` OR `)})`)
      } else if (filters.skillsOperator === 'and') {
        c.push(eb.and(skillOrs))
      } else {
        c.push(eb.or(skillOrs))
      }
    }

    if (filters.excludeSkills?.length) {
      const exclOrs = filters.excludeSkills.map(skill =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.skills) AS s WHERE LOWER(COALESCE(s->>'name', s::text)) LIKE ${`%${skill.toLowerCase()}%`}) `
      )
      c.push(sql`NOT (${sql.join(exclOrs, sql` OR `)})`)
    }

    if (filters.currentCompany?.length) {
      const compOrs = filters.currentCompany.map(comp =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.companies) AS x WHERE x->>'name' ILIKE ${`%${comp.trim()}%`}) `
      )
      const compMode = filters.filterModes?.currentCompany || 'must'
      if (compMode === 'must_not') {
        c.push(sql`NOT (${sql.join(compOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(compOrs))
      }
    }

    if (filters.pastCompany?.length) {
      const pastCompOrs = filters.pastCompany.map(comp =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.work_history) AS w WHERE w->>'company' ILIKE ${`%${comp.trim()}%`}) `
      )
      const pastCompMode = filters.filterModes?.pastCompany || 'must'
      if (pastCompMode === 'must_not') {
        c.push(sql`NOT (${sql.join(pastCompOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(pastCompOrs))
      }
    }

    if (filters.industry?.length) {
      const indOrs = filters.industry.map(ind =>
        eb('candidates.industry', 'ilike', `%${ind.trim()}%`)
      )
      const indMode = filters.filterModes?.industry || 'must'
      if (indMode === 'must_not') {
        c.push(sql`NOT (${sql.join(indOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(indOrs))
      }
    }

    if (filters.school?.length) {
      const schoolOrs = filters.school.map(s =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.education) AS e WHERE e->>'school' ILIKE ${`%${s.trim()}%`}) `
      )
      const schoolMode = filters.filterModes?.school || 'must'
      if (schoolMode === 'must_not') {
        c.push(sql`NOT (${sql.join(schoolOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(schoolOrs))
      }
    }

    if (filters.degree?.length) {
      const degreeOrs = filters.degree.map(d =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.education) AS e WHERE e->>'degree' ILIKE ${`%${d.trim()}%`}) `
      )
      const degreeMode = filters.filterModes?.degree || 'must'
      if (degreeMode === 'must_not') {
        c.push(sql`NOT (${sql.join(degreeOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(degreeOrs))
      }
    }

    if (filters.fieldOfStudy?.length) {
      const fosOrs = filters.fieldOfStudy.map(f =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.education) AS e WHERE e->>'field' ILIKE ${`%${f.trim()}%`}) `
      )
      const fosMode = filters.filterModes?.fieldOfStudy || 'must'
      if (fosMode === 'must_not') {
        c.push(sql`NOT (${sql.join(fosOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(fosOrs))
      }
    }

    if (filters.jobTitle?.length) {
      const titleOrs = filters.jobTitle.map(title => {
        const kw = `%${title.trim()}%`
        return sql<boolean>` (
          EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.work_history) AS w WHERE w->>'title' ILIKE ${kw})
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.companies) AS co WHERE co->>'title' ILIKE ${kw})
          OR candidates.headline ILIKE ${kw}
        ) `
      })
      const titleMode = filters.filterModes?.jobTitle || 'must'
      if (titleMode === 'must_not') {
        c.push(sql`NOT (${sql.join(titleOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(titleOrs))
      }
    }

    if (filters.seniority) {
      const patterns: Record<string, string[]> = {
        entry: ['junior', 'associate', 'entry', 'trainee', 'graduate'],
        senior: ['senior', 'sr.', 'sr ', 'lead', 'principal'],
        manager: ['manager', 'mgr', 'team lead', 'head of'],
        director: ['director', 'dir.', 'dir '],
        vp: ['vice president', 'vp', 'svp', 'evp'],
        c_level: ['ceo', 'cto', 'cfo', 'coo', 'cmo', 'cio', 'founder', 'co-founder'],
        intern: ['intern', 'internship', 'student'],
      }
      const keywords = patterns[filters.seniority] || []
      if (keywords.length > 0) {
        c.push(eb.or(
          keywords.map(kw => eb(sql<string>`LOWER(candidates.headline)`, 'like', `%${kw}%`))
        ))
      }
    }

    if (filters.source?.length) {
      c.push(eb('candidates.source', 'in', filters.source))
    }

    if (filters.stage?.length) {
      c.push(eb('candidates.stage', 'in', filters.stage))
    }

    if (filters.dataQualityMin !== undefined) {
      c.push(eb('candidates.data_quality_score', '>=', filters.dataQualityMin))
    }
    if (filters.dataQualityMax !== undefined) {
      c.push(eb('candidates.data_quality_score', '<=', filters.dataQualityMax))
    }

    const presenceFilters: [string, boolean | undefined][] = [
      ['linkedin_url', filters.hasLinkedin],
      ['github_url', filters.hasGithub],
      ['portfolio_url', filters.hasPortfolio],
      ['email', filters.hasEmail],
      ['phone', filters.hasPhone],
      ['resume_url', filters.hasResume],
    ]
    for (const [col, val] of presenceFilters) {
      if (val === true) {
        c.push(eb(`candidates.${col}`, 'is not', null))
        c.push(eb(`candidates.${col}`, '!=', ''))
      } else if (val === false) {
        c.push(eb.or([
          eb(`candidates.${col}`, 'is', null),
          eb(`candidates.${col}`, '=', ''),
        ]))
      }
    }

    if (filters.addedAfter) {
      c.push(eb('candidates.created_at', '>=', new Date(filters.addedAfter)))
    }
    if (filters.addedBefore) {
      c.push(eb('candidates.created_at', '<=', new Date(filters.addedBefore)))
    }

    if (filters.languages?.length) {
      const langOrs = filters.languages.map(lang =>
        sql<boolean>` EXISTS (SELECT 1 FROM jsonb_array_elements(candidates.languages) AS l WHERE LOWER(COALESCE(l->>'name', l::text)) LIKE ${`%${lang.toLowerCase()}%`}) `
      )
      const langMode = filters.filterModes?.languages || 'must'
      if (langMode === 'must_not') {
        c.push(sql`NOT (${sql.join(langOrs, sql` OR `)})`)
      } else {
        c.push(eb.or(langOrs))
      }
    }

    if (c.length === 0) return sql`1=1`
    return eb.and(c)
  }
}

advancedSearchRouter.post('/search/advanced', async (req: Request, res: Response) => {
  try {
    const filters = AdvancedSearchSchema.parse(req.body)
    const limit = filters.limit || 50
    const offset = filters.offset || 0
    const sortBy = filters.sortBy || 'data_quality_score'
    const sortDirection = filters.sortDirection || 'desc'

    console.log('[AdvancedSearch] Filters:', JSON.stringify({
      ...filters,
      keyword: filters.keyword?.substring(0, 50),
    }))

    const whereClause = applyFilters(filters)

    // ─── Step 1: SQL — get ALL candidate IDs matching filters (full DB) ──
    const semanticQuery = buildSemanticQuery(filters)
    const qdrantReady = isVectorIntelligenceReady()
    const embeddingService = getEmbeddingService()
    const useSemantic = semanticQuery && qdrantReady && embeddingService

    // For semantic ranking, first get all matching IDs via SQL (no limit)
    const needsSqlFirst = useSemantic
    let sqlFilteredIds: string[] = []

    if (needsSqlFirst) {
      // Get matching candidate IDs from full DB (just IDs, fast) — cap at 5000 for memory
      const idRows = await db.selectFrom('candidates')
        .select('candidates.id')
        .where(whereClause)
        .limit(5000)
        .execute()
      sqlFilteredIds = idRows.map(r => r.id)
      console.log(`[AdvancedSearch] SQL filtered ${sqlFilteredIds.length} candidates from full DB`)
    }

    let countResult: { count: number } | undefined
    let results: any[] = []
    let useHybrid = false

    // ─── Step 2: Qdrant — rank SQL-filtered candidates semantically ──
    if (useSemantic && sqlFilteredIds.length > 0) {
      try {
        console.log(`[AdvancedSearch] Semantic ranking — query: "${semanticQuery!.substring(0, 100)}", candidates: ${sqlFilteredIds.length}`)
        // Use has_id filter to restrict Qdrant to only SQL-matched candidates
        const pageEnd = Math.min(offset + limit, 500)
        const vectorResults = await embeddingService.searchCandidates(
          semanticQuery!,
          Math.min(sqlFilteredIds.length, pageEnd),
          { must: [{ has_id: sqlFilteredIds }] as any }
        )
        useHybrid = vectorResults.length > 0
        console.log(`[AdvancedSearch] Qdrant ranked ${vectorResults.length} candidates (top score: ${vectorResults[0]?.score?.toFixed(3) || 'N/A'})`)

        if (useHybrid) {
          // Build score map and order IDs by semantic score
          const scoreMap = new Map(vectorResults.map(r => [r.entityId, r.score]))
          const rankedIds = vectorResults.map(r => r.entityId)

          // Count total (same as SQL filtered count)
          countResult = { count: sqlFilteredIds.length }

          // Fetch full candidate data ordered by semantic score
          // Process in chunks to handle large ID lists
          const chunkSize = 100
          const pageIds = rankedIds.slice(offset, offset + limit)
          const allResults: any[] = []
          for (let i = 0; i < pageIds.length; i += chunkSize) {
            const chunk = pageIds.slice(i, i + chunkSize)
            const chunkResults = await db.selectFrom('candidates')
              .select(CANDIDATE_COLUMNS)
              .where('candidates.id', 'in', chunk)
              .execute()
            // Preserve semantic order
            const chunkMap = new Map(chunkResults.map(r => [r.id, r]))
            for (const id of chunk) {
              const candidate = chunkMap.get(id)
              if (candidate) {
                allResults.push({ ...candidate, _semanticScore: scoreMap.get(id) })
              }
            }
          }
          results = allResults
        }
      } catch (err) {
        console.warn('[AdvancedSearch] Semantic ranking failed, falling back to SQL ordering:', err)
      }
    }

    // ─── Step 3: SQL-only fallback ──────────────────────────────
    if (!useHybrid) {
      const [countRes, queryResults] = await Promise.all([
        db.selectFrom('candidates')
          .select(sql<number>`COUNT(*)::int`.as('count'))
          .where(whereClause)
          .executeTakeFirst(),
        db.selectFrom('candidates')
          .select(CANDIDATE_COLUMNS)
          .where(whereClause)
          .orderBy(sql`COALESCE(candidates.data_quality_score, 0)`, 'desc')
          .orderBy(`candidates.${sortBy}` as any, sortDirection)
          .limit(limit)
          .offset(offset)
          .execute(),
      ])
      countResult = countRes
      results = queryResults
    }

    const total = countResult?.count || 0

    console.log(`[AdvancedSearch] Found ${total} candidates, returning ${results.length} (mode: ${useHybrid ? 'hybrid' : 'sql-only'})`)

    res.json({
      candidates: results,
      total,
      limit,
      offset,
      hasMore: offset + results.length < total,
      searchMode: useHybrid ? 'hybrid' : 'sql-only',
    })
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors.map((e: any) => ({ path: e.path.join('.'), message: e.message })),
      })
    }
    console.error('[AdvancedSearch] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── GET /api/search/advanced/facets ─────────────────────────

advancedSearchRouter.get('/search/advanced/facets', async (_req: Request, res: Response) => {
  try {
    const [sources, stages, industries, regions] = await Promise.all([
      db.selectFrom('candidates')
        .select(['candidates.source as value', sql<number>`COUNT(*)::int`.as('count')])
        .groupBy('candidates.source').orderBy('count', 'desc').execute(),
      db.selectFrom('candidates')
        .select(['candidates.stage as value', sql<number>`COUNT(*)::int`.as('count')])
        .groupBy('candidates.stage').orderBy('count', 'desc').execute(),
      db.selectFrom('candidates')
        .select(['candidates.industry as value', sql<number>`COUNT(*)::int`.as('count')])
        .where('candidates.industry', 'is not', null).where('candidates.industry', '!=', '')
        .groupBy('candidates.industry').orderBy('count', 'desc').limit(30).execute(),
      db.selectFrom('candidates')
        .select(['candidates.region as value', sql<number>`COUNT(*)::int`.as('count')])
        .where('candidates.region', 'is not', null).where('candidates.region', '!=', '')
        .groupBy('candidates.region').orderBy('count', 'desc').limit(30).execute(),
    ])

    type FacetRow = { value: string; count: number }
    const [topSkills, topCompanies, topJobTitles, topSchools, topDegrees, topLanguages] = await Promise.all([
      sql<FacetRow>`
        SELECT LOWER(TRIM(item->>'name')) AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.skills) AS item
        WHERE item->>'name' IS NOT NULL AND LENGTH(TRIM(item->>'name')) > 0
        GROUP BY LOWER(TRIM(item->>'name')) ORDER BY count DESC LIMIT 50
      `.execute(db).then(result => result.rows),
      sql<FacetRow>`
        SELECT TRIM(item->>'name') AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.companies) AS item
        WHERE item->>'name' IS NOT NULL AND LENGTH(TRIM(item->>'name')) >= 2
        GROUP BY TRIM(item->>'name') ORDER BY count DESC LIMIT 30
      `.execute(db).then(result => result.rows),
      sql<FacetRow>`
        SELECT TRIM(item->>'title') AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.work_history) AS item
        WHERE item->>'title' IS NOT NULL AND LENGTH(TRIM(item->>'title')) BETWEEN 3 AND 80
        GROUP BY TRIM(item->>'title') ORDER BY count DESC LIMIT 30
      `.execute(db).then(result => result.rows),
      sql<FacetRow>`
        SELECT TRIM(item->>'school') AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.education) AS item
        WHERE item->>'school' IS NOT NULL AND LENGTH(TRIM(item->>'school')) >= 3
        GROUP BY TRIM(item->>'school') ORDER BY count DESC LIMIT 30
      `.execute(db).then(result => result.rows),
      sql<FacetRow>`
        SELECT TRIM(item->>'degree') AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.education) AS item
        WHERE item->>'degree' IS NOT NULL AND LENGTH(TRIM(item->>'degree')) >= 2
        GROUP BY TRIM(item->>'degree') ORDER BY count DESC LIMIT 20
      `.execute(db).then(result => result.rows),
      sql<FacetRow>`
        SELECT TRIM(item->>'name') AS value, COUNT(*)::int AS count
        FROM candidates, jsonb_array_elements(candidates.languages) AS item
        WHERE item->>'name' IS NOT NULL AND LENGTH(TRIM(item->>'name')) >= 2
        GROUP BY TRIM(item->>'name') ORDER BY count DESC LIMIT 20
      `.execute(db).then(result => result.rows),
    ])

    const total = await db.selectFrom('candidates')
      .select(sql<number>`COUNT(*)::int`.as('count'))
      .executeTakeFirst()

    res.json({
      total: total?.count || 0,
      sources, stages, industries, regions,
      topSkills, topCompanies, topJobTitles, topSchools, topDegrees, topLanguages,
    })
  } catch (error) {
    console.error('[AdvancedSearch] Facets error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})
