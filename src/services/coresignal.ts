// ─── Coresignal Multi-source Employee API Client ─────────────
// API docs: https://docs.coresignal.com
// Search endpoint (FREE) returns IDs only
// Collect endpoint (20 credits each) returns full 300+ field profile

// ─── Constants ──────────────────────────────────────────────

import { getApiKey } from './api-key-store.js'

const CORESIGNAL_API_URL = 'https://api.coresignal.com/cdapi/v2'
const CORESIGNAL_TIMEOUT_MS = 20_000
const COLLECT_CONCURRENCY = 5

function sanitizeEsInput(s: string): string {
  return s.replace(/[+\-=!<>{}[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim()
}

// ─── Types ──────────────────────────────────────────────────

export interface CoresignalSearchFilters {
  query?: string
  jobTitle?: string
  skills?: string[]
  location?: string
  company?: string
  size?: number
}

export interface CoresignalCollectRecord {
  id: number
  full_name: string | null
  first_name: string | null
  last_name: string | null
  headline: string | null
  summary: string | null
  picture_url: string | null
  professional_network_url: string | null
  professional_network_shorthand_names: string[] | null
  location_country: string | null
  location_country_iso2: string | null
  location_full: string | null
  location_regions: string | null
  interests: string | string[] | null
  inferred_skills: string | string[] | null
  historical_skills: string | string[] | null
  connections_count: number | null
  followers_count: number | null
  is_working: number | null
  is_decision_maker: number | null
  primary_professional_email: string | null
  primary_professional_email_status: string | null
  active_experience_title: string | null
  active_experience_company_name: string | null
  active_experience_company_shorthand_name: string | null
  active_experience_company_website: string | null
  active_experience_department: string | null
  active_experience_management_level: string | null
  active_experience_company_id: number | null
  experience: Array<{
    active_experience: number
    position_title: string | null
    department: string | null
    management_level: string | null
    location: string | null
    description: string | null
    date_from: string | null
    date_to: string | null
    duration_months: number | null
    company_id: number | null
    company_name: string | null
    company_type: string | null
    company_website: string | null
    company_industry: string | null
    company_employees_count: number | null
    company_size_range: string | null
    company_hq_country: string | null
    order_in_profile: number
  }> | null
  education: Array<{
    degree: string | null
    institution_name: string | null
    institution_country_iso2: string | null
    date_from_year: number | null
    date_to_year: number | null
    order_in_profile: number
  }> | null
  certifications: Array<{
    name: string | null
    authority: string | null
    started_date: string | null
    expired_date: string | null
  }> | null
  awards: Array<{
    title: string | null
    description: string | null
    date: string | null
  }> | null
  publications: Array<{
    title: string | null
    description: string | null
    date: string | null
  }> | null
  patents: Array<{
    title: string | null
    description: string | null
    date: string | null
  }> | null
  languages: Array<{
    name: string | null
    proficiency: string | null
  }> | null
}

export interface CoresignalUser {
  id: number
  fullName: string | null
  firstName: string | null
  lastName: string | null
  headline: string | null
  summary: string | null
  pictureUrl: string | null
  profileUrl: string | null
  location: string | null
  locationCountry: string | null
  locationCountryIso2: string | null
  skills: string[]
  interests: string | null
  currentTitle: string | null
  currentCompany: string | null
  currentCompanyWebsite: string | null
  currentDepartment: string | null
  currentManagementLevel: string | null
  email: string | null
  emailStatus: string | null
  isDecisionMaker: boolean
  experience: Array<{
    title: string
    company: string
    companyWebsite: string | null
    companyIndustry: string | null
    companySize: string | null
    department: string | null
    managementLevel: string | null
    location: string | null
    description: string | null
    startDate: string | null
    endDate: string | null
    durationMonths: number | null
    isCurrent: boolean
  }>
  education: Array<{
    degree: string
    institution: string
    country: string | null
    startYear: number | null
    endYear: number | null
  }>
  certifications: Array<{
    name: string
    authority: string | null
    startDate: string | null
    endDate: string | null
  }>
  awards: Array<{
    title: string
    description: string | null
    date: string | null
  }>
  languages: Array<{
    name: string
    proficiency: string | null
  }>
  connectionsCount: number | null
  followersCount: number | null
}

export interface CoresignalSearchResult {
  users: CoresignalUser[]
  total: number
}

// ─── Custom Error ───────────────────────────────────────────

export class CoresignalError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'CoresignalError'
    this.statusCode = statusCode
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function getHeaders(): Promise<Record<string, string>> {
  const apiKey = await getApiKey('coresignal')
  if (!apiKey) throw new CoresignalError('CORESIGNAL_API_KEY not set', 500)
  return {
    'apikey': apiKey,
    'accept': 'application/json',
    'content-type': 'application/json',
  }
}

function buildSearchQuery(filters: CoresignalSearchFilters): Record<string, unknown> {
  const must: unknown[] = []
  const should: unknown[] = []
  const mustNot: unknown[] = []

  const filter = [{ term: { is_deleted: 0 } }]

  const searchText = sanitizeEsInput(filters.query || filters.jobTitle || '')
  if (searchText) {
    must.push({
      multi_match: {
        query: searchText,
        fields: ['headline^2', 'full_name', 'inferred_skills', 'active_experience_title'],
        type: 'best_fields',
        operator: 'or',
      },
    })
  }

  const jobTitle = sanitizeEsInput(filters.jobTitle || '')
  if (jobTitle && searchText) {
    must.push({
      match: {
        active_experience_title: {
          query: jobTitle,
          operator: 'and',
        },
      },
    })
  }

  const skills = (filters.skills || []).map(s => sanitizeEsInput(s)).filter(Boolean)
  if (skills.length > 0) {
    should.push({
      match: {
        inferred_skills: {
          query: skills.join(' '),
          operator: 'or',
        },
      },
    })
  }

  const location = sanitizeEsInput(filters.location || '')
  if (location) {
    should.push({
      match: {
        location_full: {
          query: location,
          operator: 'or',
        },
      },
    })
    should.push({
      match: {
        location_country: {
          query: location,
          operator: 'and',
        },
      },
    })
  }

  const company = sanitizeEsInput(filters.company || '')
  if (company) {
    must.push({
      nested: {
        path: 'experience',
        query: {
          match: {
            'experience.company_name': {
              query: company,
              operator: 'and',
            },
          },
        },
      },
    })
  }

  return {
    query: {
      bool: {
        ...(must.length > 0 ? { must } : {}),
        ...(should.length > 0 ? { should, minimum_should_match: 1 } : {}),
        ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
        filter,
      },
    },
    sort: ['_score'],
  }
}

async function executeSearch(query: Record<string, unknown>, size: number): Promise<number[]> {
  const url = `${CORESIGNAL_API_URL}/employee_multi_source/search/es_dsl?items_per_page=${Math.min(size, 1000)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CORESIGNAL_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify(query),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new CoresignalError(
        `Coresignal search API: ${res.status} ${res.statusText} - ${body}`,
        res.status,
      )
    }

    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new CoresignalError('Coresignal search timed out', 408)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function executeCollectOne(id: number): Promise<CoresignalCollectRecord | null> {
  const url = `${CORESIGNAL_API_URL}/employee_multi_source/collect/${id}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CORESIGNAL_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: await getHeaders(),
      signal: controller.signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // 404 = profile not found, skip silently
      if (res.status === 404) return null
      // 402 = insufficient credits, throw so batch can stop
      if (res.status === 402) {
        throw new CoresignalError('Insufficient credits', 402)
      }
      throw new CoresignalError(
        `Coresignal collect API: ${res.status} ${res.statusText} - ${body}`,
        res.status,
      )
    }

    const data = await res.json()
    if (Array.isArray(data)) return (data[0] as CoresignalCollectRecord) || null
    if (data && typeof data === 'object' && 'id' in data) return data as unknown as CoresignalCollectRecord
    return null
  } catch (err) {
    if (err instanceof CoresignalError && err.statusCode === 404) return null
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new CoresignalError(`Coresignal collect timed out for ID ${id}`, 408)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

async function executeCollectBatch(ids: number[]): Promise<CoresignalCollectRecord[]> {
  if (ids.length === 0) return []

  const results: CoresignalCollectRecord[] = []
  let quotaExhausted = false

  for (let i = 0; i < ids.length; i += COLLECT_CONCURRENCY) {
    if (quotaExhausted) break

    const batch = ids.slice(i, i + COLLECT_CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map(id => executeCollectOne(id))
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value)
      } else if (result.status === 'rejected') {
        const msg = result.reason?.message || String(result.reason)
        if (msg.includes('Insufficient credits')) {
          console.warn(`[Coresignal] Credits exhausted after ${results.length} collects. Stopping.`)
          quotaExhausted = true
          break
        }
        console.error(`[Coresignal] Collect failed for ID ${batch[j]}:`, msg)
      }
    }

    if (i + COLLECT_CONCURRENCY < ids.length && !quotaExhausted) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return results
}

function parseSkillField(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean)
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function normalizeRecord(record: CoresignalCollectRecord): CoresignalUser {
  // Parse skills — may come as string, array, or null
  const inferredSkills = parseSkillField(record.inferred_skills)
  const historicalSkills = parseSkillField(record.historical_skills)
  const skills = [...new Set([...inferredSkills, ...historicalSkills])]

  // Normalize experience
  const experience = (record.experience || []).map(exp => ({
    title: exp.position_title || 'Unknown',
    company: exp.company_name || 'Unknown',
    companyWebsite: exp.company_website || null,
    companyIndustry: exp.company_industry || null,
    companySize: exp.company_size_range || null,
    department: exp.department || null,
    managementLevel: exp.management_level || null,
    location: exp.location || null,
    description: exp.description || null,
    startDate: exp.date_from || null,
    endDate: exp.date_to || null,
    durationMonths: exp.duration_months ?? null,
    isCurrent: exp.active_experience === 1,
  }))

  // Normalize education
  const education = (record.education || []).map(edu => ({
    degree: edu.degree || 'Unknown',
    institution: edu.institution_name || 'Unknown',
    country: edu.institution_country_iso2 || null,
    startYear: edu.date_from_year || null,
    endYear: edu.date_to_year || null,
  }))

  // Normalize certifications
  const certifications = (record.certifications || []).map(cert => ({
    name: cert.name || 'Unknown',
    authority: cert.authority || null,
    startDate: cert.started_date || null,
    endDate: cert.expired_date || null,
  }))

  // Normalize awards
  const awards = (record.awards || []).map(award => ({
    title: award.title || 'Unknown',
    description: award.description || null,
    date: award.date || null,
  }))

  // Normalize languages
  const languages = (record.languages || []).map(lang => ({
    name: lang.name || 'Unknown',
    proficiency: lang.proficiency || null,
  }))

  return {
    id: record.id,
    fullName: record.full_name,
    firstName: record.first_name,
    lastName: record.last_name,
    headline: record.headline,
    summary: record.summary,
    pictureUrl: record.picture_url,
    profileUrl: record.professional_network_url,
    location: record.location_full || record.location_country,
    locationCountry: record.location_country,
    locationCountryIso2: record.location_country_iso2,
    skills,
    interests: typeof record.interests === 'string' ? record.interests : Array.isArray(record.interests) ? record.interests.join(', ') : null,
    currentTitle: record.active_experience_title,
    currentCompany: record.active_experience_company_shorthand_name || record.active_experience_company_name,
    currentCompanyWebsite: record.active_experience_company_website || null,
    currentDepartment: record.active_experience_department || null,
    currentManagementLevel: record.active_experience_management_level || null,
    email: record.primary_professional_email || null,
    emailStatus: record.primary_professional_email_status || null,
    isDecisionMaker: record.is_decision_maker === 1,
    experience,
    education,
    certifications,
    awards,
    languages,
    connectionsCount: record.connections_count,
    followersCount: record.followers_count,
  }
}

// ─── Main Search Function ───────────────────────────────────

export async function searchCoresignalUsers(
  filters: CoresignalSearchFilters,
): Promise<CoresignalSearchResult> {
  const apiKey = await getApiKey('coresignal')
  if (!apiKey) {
    throw new CoresignalError('CORESIGNAL_API_KEY not configured', 500)
  }

  const size = Math.max(Math.min(filters.size || 1000, 1000), 1)

  // Step 1: Build query
  const query = buildSearchQuery(filters)

  // Step 2: Execute search (returns IDs only, FREE)
  const ids = await executeSearch(query, size)

  if (ids.length === 0) {
    return { users: [], total: 0 }
  }

  console.log(`[Coresignal] Found ${ids.length} employee IDs, collecting full profiles (20 credits each)...`)

  // Step 3: Execute collect for each ID (returns full 300+ field profile, 20 credits each)
  const collectRecords = await executeCollectBatch(ids)

  // Step 4: Normalize records
  const users = collectRecords.map(normalizeRecord)

  console.log(`[Coresignal] Collected and normalized ${users.length} candidates (${collectRecords.length * 20} credits used)`)

  return {
    users,
    total: ids.length,
  }
}
