// ─── People Data Labs Service ────────────────────────────────
// Person Search API: POST https://api.peopledatalabs.com/v5/person/search
// Docs: https://docs.peopledatalabs.com/docs/person-search-api

import { parseBooleanQuery, hasBooleanOperators } from '../utils/boolean-parser.js'
import { getApiKey } from './api-key-store.js'

const PDL_API_URL = 'https://api.peopledatalabs.com/v5/person/search'
const PDL_TIMEOUT_MS = 15000

// ─── Quota Exhaustion Tracker ────────────────────────────────
// Tracks when PDL quota is exhausted to avoid wasted API calls
// Resets after 24 hours (monthly quota typically resets on calendar month)

let quotaExhaustedAt: number | null = null
const QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

export function isPdlQuotaExhausted(): boolean {
  if (!quotaExhaustedAt) return false
  if (Date.now() - quotaExhaustedAt > QUOTA_COOLDOWN_MS) {
    quotaExhaustedAt = null // Auto-reset after 24h
    return false
  }
  return true
}

export function markPdlQuotaExhausted(): void {
  quotaExhaustedAt = Date.now()
  console.log('[PDL] Quota marked as exhausted — skipping PDL for 24 hours')
}

export function resetPdlQuota(): void {
  quotaExhaustedAt = null
  console.log('[PDL] Quota exhaustion manually cleared')
}

export function getPdlQuotaStatus(): { exhausted: boolean; since: string | null; resetsAt: string | null } {
  if (!quotaExhaustedAt) return { exhausted: false, since: null, resetsAt: null }
  const since = new Date(quotaExhaustedAt).toISOString()
  const resetsAt = new Date(quotaExhaustedAt + QUOTA_COOLDOWN_MS).toISOString()
  return { exhausted: true, since, resetsAt }
}

// ─── Types ───────────────────────────────────────────────────

export interface PdlSearchFilters {
  jobTitle?: string
  skills?: string[]
  country?: string
  industry?: string
  experience?: string
  keywords?: string
  size?: number
}

export interface PdlPersonRecord {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  job_title: string | null
  job_company_name: string | null
  job_company_industry: string | null
  location_country: string | null
  location_locality: string | null
  job_skills: string[] | null
  profiles: Array<{ network: string; url: string; id?: string }> | null
  emails: Array<{ address: string; type: string }> | null
  phone_numbers: string[] | null
  education: Array<{
    school: string
    degrees: string[]
    majors: string[]
    end_date?: string
  }> | null
  languages: Array<{ name: string; proficiency: number }> | null
  job_title_levels: string[] | null
  job_summary: string | null
  headline: string | null
  linkedin_id: string | null
  linkedin_url: string | null
  github_url: string | null
}

export interface NormalizedCandidate {
  pdlId: string
  fullName: string | null
  firstName: string | null
  lastName: string | null
  jobTitle: string | null
  companyName: string | null
  linkedinUrl: string | null
  githubUrl: string | null
  industry: string | null
  location: string | null
  headline: string | null
  skills: string[]
  emails: string[]
  phoneNumbers: string[]
}

export interface PdlSearchResult {
  candidates: NormalizedCandidate[]
  total: number
  scrollToken: string | null
}

// ─── Query Builder ───────────────────────────────────────────

const EXPERIENCE_LEVEL_MAP: Record<string, string[]> = {
  '0-2': ['entry', 'training'],
  '3-5': ['senior', 'manager'],
  '5-8': ['senior', 'manager', 'director'],
  '8-12': ['director', 'vp', 'cxo'],
  '12+': ['vp', 'cxo', 'owner'],
}

// Max skills to pass to PDL — more than 3 kills results
const MAX_PDL_SKILLS = 3

export function buildSearchQuery(filters: PdlSearchFilters): Record<string, unknown> {
  const must: unknown[] = []
  const should: unknown[] = []
  const mustNot: unknown[] = []

  if (filters.jobTitle?.trim()) {
    if (hasBooleanOperators(filters.jobTitle)) {
      const bq = parseBooleanQuery(filters.jobTitle)
      if (bq.terms.length > 1 && bq.operator === 'or') {
        should.push(...bq.terms.map(t => ({ match: { job_title: t.trim().toLowerCase() } })))
      } else {
        for (const term of bq.terms) {
          must.push({ match: { job_title: term.trim().toLowerCase() } })
        }
      }
      for (const ex of bq.excluded) {
        mustNot.push({ match: { job_title: ex.trim().toLowerCase() } })
      }
    } else {
      must.push({ match: { job_title: filters.jobTitle.trim().toLowerCase() } })
    }
  }

  if (filters.skills?.length) {
    const topSkills = filters.skills.slice(0, MAX_PDL_SKILLS)
    const included: string[] = []
    const excluded: string[] = []
    for (const s of topSkills) {
      if (s.toUpperCase().startsWith('NOT ')) {
        excluded.push(s.slice(4).trim().toLowerCase())
      } else {
        included.push(s.trim().toLowerCase())
      }
    }
    if (included.length > 0) {
      must.push({ terms: { skills: included } })
    }
    for (const ex of excluded) {
      mustNot.push({ terms: { skills: [ex] } })
    }
  }

  if (filters.country?.trim()) {
    must.push({ term: { location_country: filters.country.trim().toLowerCase() } })
  }

  if (filters.experience?.trim()) {
    const levels = EXPERIENCE_LEVEL_MAP[filters.experience.trim()]
    if (levels) {
      must.push({ terms: { job_title_levels: levels } })
    }
  }

  if (filters.keywords?.trim()) {
    if (hasBooleanOperators(filters.keywords)) {
      const bq = parseBooleanQuery(filters.keywords)
      if (bq.terms.length > 1 && bq.operator === 'or') {
        should.push(...bq.terms.map(t => ({ match: { job_summary: t.trim().toLowerCase() } })))
      } else {
        for (const term of bq.terms) {
          must.push({ match: { job_summary: term.trim().toLowerCase() } })
        }
      }
      for (const ex of bq.excluded) {
        mustNot.push({ match: { job_summary: ex.trim().toLowerCase() } })
      }
    } else {
      must.push({ match: { job_summary: filters.keywords.trim().toLowerCase() } })
    }
  }

  if (must.length === 0 && should.length === 0) {
    must.push({ match_all: {} })
  }

  const boolClause: Record<string, unknown> = {}
  if (must.length > 0) boolClause.must = must
  if (should.length > 0) boolClause.should = should
  if (mustNot.length > 0) boolClause.must_not = mustNot
  if (should.length > 0 && must.length === 0) boolClause.minimum_should_match = 1

  return {
    query: {
      bool: boolClause,
    },
  }
}

// Build progressively relaxed versions of the query for fallback
function buildFallbackQueries(filters: PdlSearchFilters): Record<string, unknown>[] {
  const fallbacks: Record<string, unknown>[] = []

  // Fallback 1: drop keywords
  if (filters.keywords?.trim()) {
    fallbacks.push(buildSearchQuery({ ...filters, keywords: undefined }))
  }

  // Fallback 2: drop skills
  if (filters.skills?.length) {
    fallbacks.push(buildSearchQuery({ ...filters, skills: undefined, keywords: undefined }))
  }

  // Fallback 3: drop country
  if (filters.country?.trim()) {
    fallbacks.push(buildSearchQuery({ ...filters, country: undefined, skills: undefined, keywords: undefined }))
  }

  // Fallback 4: title only
  if (filters.jobTitle?.trim()) {
    fallbacks.push(buildSearchQuery({ jobTitle: filters.jobTitle }))
  }

  return fallbacks
}

// ─── API Client ──────────────────────────────────────────────

async function executePdlQuery(
  query: Record<string, unknown>,
  size: number,
  apiKey: string,
): Promise<{ data: any[]; total: number; scrollToken: string | null }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PDL_TIMEOUT_MS)

  try {
    const response = await fetch(PDL_API_URL, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...query,
        size,
        dataset: 'all',
        titlecase: true,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.status === 401) {
      throw new PdlError('Invalid PDL API key', 401)
    }

    if (response.status === 404) {
      return { data: [], total: 0, scrollToken: null }
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new PdlError(`PDL API error ${response.status}: ${body}`, response.status)
    }

    const json: any = await response.json()

    if (!json || !Array.isArray(json.data)) {
      return { data: [], total: 0, scrollToken: null }
    }

    return {
      data: json.data,
      total: json.total || 0,
      scrollToken: json.scroll_token || null,
    }
  } catch (error: any) {
    clearTimeout(timeout)

    if (error.name === 'AbortError') {
      throw new PdlError('PDL API request timed out', 504)
    }

    if (error instanceof PdlError) {
      throw error
    }

    throw new PdlError(`Failed to reach PDL API: ${error.message}`, 502)
  }
}

export async function searchPersons(
  filters: PdlSearchFilters,
): Promise<PdlSearchResult> {
  const apiKey = await getApiKey('pdl')
  if (!apiKey) {
    throw new PdlError('PDL API key not configured', 500)
  }

  // Skip PDL entirely if quota is known to be exhausted
  if (isPdlQuotaExhausted()) {
    throw new PdlError('PDL API monthly quota exhausted. Using other providers. Quota resets next month or try again in 24h.', 402)
  }

  const requestedSize = Math.min(Math.max(filters.size || 25, 1), 100)
  const query = buildSearchQuery(filters)

  // Try the full query first, with automatic size reduction on 402
  let result: { data: any[]; total: number; scrollToken: string | null } | null = null
  // Always build a full fallback chain so ANY size gets retried with smaller sizes on 402
  const sizesToTry = requestedSize >= 100 ? [100, 50, 25, 10]
    : requestedSize >= 50 ? [50, 25, 10]
    : requestedSize >= 25 ? [25, 10]
    : [requestedSize]

  for (const size of sizesToTry) {
    try {
      result = await executePdlQuery(query, size, apiKey)
      break
    } catch (err: any) {
      if (err instanceof PdlError && err.statusCode === 402 && size > 10) {
        console.log(`[PDL] Quota hit at size=${size}, retrying with smaller size...`)
        continue
      }
      // Mark quota exhausted on any 402 so future calls skip entirely
      if (err instanceof PdlError && err.statusCode === 402) {
        markPdlQuotaExhausted()
      }
      throw err
    }
  }

  if (!result) {
    markPdlQuotaExhausted()
    throw new PdlError('PDL API monthly quota exceeded. Your plan\'s monthly search limit has been reached. Wait for your quota to reset or upgrade your PDL plan at peopledatalabs.com.', 402)
  }

  // If 0 results, try progressively relaxed queries
  if (result.total === 0) {
    const fallbacks = buildFallbackQueries(filters)
    for (const fallbackQuery of fallbacks) {
      result = await executePdlQuery(fallbackQuery, sizesToTry[0], apiKey)
      if (result.total > 0) break
    }
  }

  const candidates = result.data.map(normalizeRecord)

  return {
    candidates,
    total: result.total,
    scrollToken: result.scrollToken,
  }
}

// ─── Normalizer ──────────────────────────────────────────────

export function normalizeRecord(raw: PdlPersonRecord): NormalizedCandidate {
  const profiles = Array.isArray(raw.profiles) ? raw.profiles : []
  const linkedinProfile = profiles.find(p => p.network === 'linkedin')
  const githubProfile = profiles.find(p => p.network === 'github')

  const rawLinkedin = raw.linkedin_url || linkedinProfile?.url
    || (raw.linkedin_id ? `linkedin.com/in/${raw.linkedin_id}` : null)
  const linkedinUrl = rawLinkedin && !rawLinkedin.startsWith('http') ? `https://${rawLinkedin}` : rawLinkedin

  const rawGithub = githubProfile?.url || raw.github_url || null
  const githubUrl = rawGithub && !rawGithub.startsWith('http') ? `https://${rawGithub}` : rawGithub

  const locality = typeof raw.location_locality === 'string' ? raw.location_locality : null
  const country = typeof raw.location_country === 'string' ? raw.location_country : null
  const location = [locality, country].filter(Boolean).join(', ') || null

  return {
    pdlId: raw.id,
    fullName: raw.full_name || [raw.first_name, raw.last_name].filter(Boolean).join(' ') || null,
    firstName: raw.first_name || null,
    lastName: raw.last_name || null,
    jobTitle: raw.job_title || null,
    companyName: raw.job_company_name || null,
    linkedinUrl,
    githubUrl,
    industry: raw.job_company_industry || null,
    location,
    headline: raw.headline || raw.job_summary || null,
    skills: (raw as any).skills || raw.job_skills || [],
    emails: Array.isArray(raw.emails) ? raw.emails.map(e => e.address).filter(Boolean) : [],
    phoneNumbers: Array.isArray(raw.phone_numbers) ? raw.phone_numbers : [],
  }
}

// ─── Error Class ─────────────────────────────────────────────

export class PdlError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message)
    this.name = 'PdlError'
  }
}
