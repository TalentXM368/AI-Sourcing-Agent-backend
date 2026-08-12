import { searchPersons, type NormalizedCandidate as PdlCandidate, isPdlQuotaExhausted } from './people-data-labs.js'
import { searchGithubUsers, type GithubUser } from './github-search.js'
import { searchStackoverflowUsers, type StackoverflowUser } from './stackoverflow-search.js'
import { searchKaggleUsers, type KaggleUser } from './kaggle-search.js'
import { searchCoresignalUsers, type CoresignalUser } from './coresignal.js'

// ─── Types ──────────────────────────────────────────────────

export interface UnifiedCandidate {
  id: string
  name: string
  title: string | null
  company: string | null
  location: string | null
  skills: string[]
  experience: number | null
  sources: string[]
  githubUrl: string | null
  linkedinUrl: string | null
  profileUrl: string | null
  avatarUrl: string | null
  overallScore: number
  sourceScores: Record<string, number>
  raw: {
    pdl?: PdlCandidate
    github?: GithubCandidateRaw
    so?: StackoverflowUser
    kaggle?: KaggleUser
    coresignal?: CoresignalUser
  }
}

export interface GithubCandidateRaw {
  login: string
  name: string | null
  bio: string | null
  location: string | null
  email: string | null
  company: string | null
  blog: string | null
  avatarUrl: string
  htmlUrl: string
  publicRepos: number
  followers: number
  hireable: boolean | null
  languages: string[]
}

export interface AllSearchFilters {
  providers: string[]
  jobTitle?: string
  skills?: string[]
  country?: string
  industry?: string
  experience?: string
  keywords?: string
  ghQuery?: string
  language?: string
  location?: string
  minFollowers?: number
  minRepos?: number
  soTag?: string
  minReputation?: number
  kaggleQuery?: string
  kaggleSortBy?: string
  coresignalQuery?: string
  coresignalJobTitle?: string
  coresignalLocation?: string
  coresignalCompany?: string
  size?: number
}

export interface AllSearchResult {
  candidates: UnifiedCandidate[]
  totals: Record<string, number>
  saved: number
}

// ─── Similarity Helpers ─────────────────────────────────────

function normalizeStr(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeStr(a)
  const nb = normalizeStr(b)
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85

  const aParts = na.split(/\s+/).filter(Boolean)
  const bParts = nb.split(/\s+/).filter(Boolean)
  if (aParts.length >= 2 && bParts.length >= 2) {
    const firstNameMatch = aParts[0] === bParts[0]
    const lastNameMatch = aParts[aParts.length - 1] === bParts[bParts.length - 1]
    if (firstNameMatch && lastNameMatch) return 1
    if (firstNameMatch || lastNameMatch) return 0.7
  }

  return 0
}

function locationMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const na = normalizeStr(a)
  const nb = normalizeStr(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

// ─── Candidate Extraction ───────────────────────────────────

interface ExtractedCandidate {
  name: string
  title: string | null
  company: string | null
  location: string | null
  skills: string[]
  experience: number | null
  githubUrl: string | null
  linkedinUrl: string | null
  profileUrl: string | null
  avatarUrl: string | null
  source: string
  sourceId: string
  raw: any
}

function extractPdl(c: PdlCandidate): ExtractedCandidate {
  return {
    name: c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown',
    title: c.jobTitle,
    company: c.companyName,
    location: c.location,
    skills: c.skills || [],
    experience: null,
    githubUrl: c.githubUrl,
    linkedinUrl: c.linkedinUrl,
    profileUrl: c.linkedinUrl,
    avatarUrl: null,
    source: 'pdl',
    sourceId: c.pdlId,
    raw: c,
  }
}

function extractGithub(u: GithubUser): ExtractedCandidate {
  return {
    name: u.name || u.login,
    title: null,
    company: u.company,
    location: u.location,
    skills: u.languages || [],
    experience: null,
    githubUrl: u.htmlUrl,
    linkedinUrl: null,
    profileUrl: u.htmlUrl,
    avatarUrl: u.avatarUrl,
    source: 'github',
    sourceId: u.login,
    raw: u,
  }
}

function extractSo(u: StackoverflowUser): ExtractedCandidate {
  const tags = (u.topTags || '').split(',').map(t => t.trim()).filter(Boolean)
  return {
    name: u.displayName,
    title: null,
    company: null,
    location: u.location,
    skills: tags,
    experience: null,
    githubUrl: null,
    linkedinUrl: null,
    profileUrl: u.link,
    avatarUrl: u.profileImage,
    source: 'stackoverflow',
    sourceId: String(u.userId),
    raw: u,
  }
}

function extractKaggle(u: KaggleUser): ExtractedCandidate {
  const topics = (u.searchedTopics || '').split(',').map(t => t.trim()).filter(Boolean)
  const dsTopics = (u.topDatasets || []).map(d => d.title).slice(0, 3)
  const kTopics = (u.topKernels || []).map(k => k.title).slice(0, 3)
  const allSkills = [...new Set([...topics, ...dsTopics, ...kTopics])].slice(0, 10)

  return {
    name: u.displayName || u.username,
    title: null,
    company: null,
    location: null,
    skills: allSkills,
    experience: null,
    githubUrl: null,
    linkedinUrl: null,
    profileUrl: u.profileUrl,
    avatarUrl: u.imageUrl,
    source: 'kaggle',
    sourceId: u.username,
    raw: u,
  }
}

function extractCoresignal(u: CoresignalUser): ExtractedCandidate {
  return {
    name: u.fullName || 'Unknown',
    title: u.currentTitle,
    company: u.currentCompany,
    location: u.location,
    skills: u.skills || [],
    experience: null,
    githubUrl: null,
    linkedinUrl: u.profileUrl,
    profileUrl: u.profileUrl,
    avatarUrl: u.pictureUrl,
    source: 'coresignal',
    sourceId: String(u.id),
    raw: u,
  }
}

// ─── Deduplication ──────────────────────────────────────────

function buildDedupKey(c: ExtractedCandidate): string {
  if (c.githubUrl) return `gh:${normalizeStr(c.githubUrl)}`
  if (c.linkedinUrl) return `li:${normalizeStr(c.linkedinUrl)}`
  return `name:${normalizeStr(c.name)}:${normalizeStr(c.location || '')}`
}

function deduplicate(candidates: ExtractedCandidate[]): ExtractedCandidate[] {
  const byId = new Map<string, ExtractedCandidate>()
  const byGithub = new Map<string, string>()
  const byLinkedin = new Map<string, string>()
  const byName = new Map<string, string>()

  const idToGroup = new Map<string, string>()

  function getGroup(id: string): string {
    let current = id
    while (idToGroup.has(current)) current = idToGroup.get(current)!
    return current
  }

  function mergeGroups(a: string, b: string) {
    const ga = getGroup(a)
    const gb = getGroup(b)
    if (ga !== gb) idToGroup.set(ga, gb)
  }

  for (const c of candidates) {
    const id = `${c.source}:${c.sourceId}`
    byId.set(id, c)

    if (c.githubUrl) {
      const key = normalizeStr(c.githubUrl)
      if (byGithub.has(key)) mergeGroups(id, byGithub.get(key)!)
      else byGithub.set(key, id)
    }
    if (c.linkedinUrl) {
      const key = normalizeStr(c.linkedinUrl)
      if (byLinkedin.has(key)) mergeGroups(id, byLinkedin.get(key)!)
      else byLinkedin.set(key, id)
    }

    const nameKey = normalizeStr(c.name)
    if (nameKey.length >= 3) {
      if (byName.has(nameKey)) {
        const existingId = byName.get(nameKey)!
        const existing = byId.get(existingId)
        if (existing && locationMatch(existing.location, c.location)) {
          mergeGroups(id, existingId)
        }
      } else {
        byName.set(nameKey, id)
      }
    }
  }

  const groups = new Map<string, ExtractedCandidate[]>()
  for (const [id, c] of byId) {
    const group = getGroup(id)
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(c)
  }

  return Array.from(groups.values()).map(members => {
    if (members.length === 1) return members[0]

    const primary = members.find(m => m.source === 'pdl') || members[0]
    const allSkills = [...new Set(members.flatMap(m => m.skills))]
    const sources = members.map(m => m.source)

    return {
      ...primary,
      skills: allSkills,
      githubUrl: primary.githubUrl || members.find(m => m.githubUrl)?.githubUrl || null,
      linkedinUrl: primary.linkedinUrl || members.find(m => m.linkedinUrl)?.linkedinUrl || null,
      avatarUrl: primary.avatarUrl || members.find(m => m.avatarUrl)?.avatarUrl || null,
      company: primary.company || members.find(m => m.company)?.company || null,
      location: primary.location || members.find(m => m.location)?.location || null,
      source: sources.join(','),
    }
  })
}

// ─── Scoring ────────────────────────────────────────────────

function scoreCandidate(c: ExtractedCandidate, filters: AllSearchFilters): { overallScore: number; sourceScores: Record<string, number> } {
  const sourceScores: Record<string, number> = {}
  const sources = c.source.split(',')

  const requiredSkills = filters.skills?.map(s => s.toLowerCase()) || []
  const skillsLower = c.skills.map(s => s.toLowerCase())

  for (const source of sources) {
    let score = 50

    if (source === 'pdl') {
      score = 60
      if (c.linkedinUrl) score += 10
      if (c.title) score += 5
      if (c.company) score += 5
      if (filters.jobTitle) {
        const titleMatch = c.title?.toLowerCase().includes(filters.jobTitle.toLowerCase())
        if (titleMatch) score += 15
      }
      if (requiredSkills.length > 0) {
        const matches = skillsLower.filter(s => requiredSkills.some(rs => s.includes(rs) || rs.includes(s)))
        score += Math.min(matches.length * 5, 15)
      }
    }

    if (source === 'github') {
      score = 60
      const raw = c.raw as GithubUser
      if (raw) {
        if (raw.followers > 100) score += 15
        else if (raw.followers > 20) score += 10
        else if (raw.followers > 5) score += 5
        if (raw.publicRepos > 10) score += 10
        else if (raw.publicRepos > 3) score += 5
        if (raw.hireable) score += 5
        if (raw.bio) score += 5
        if (raw.location) score += 5
      }
      if (requiredSkills.length > 0) {
        const matches = skillsLower.filter(s => requiredSkills.some(rs => s.includes(rs) || rs.includes(s)))
        score += Math.min(matches.length * 5, 15)
      }
    }

    if (source === 'stackoverflow') {
      score = 55
      const raw = c.raw as StackoverflowUser
      if (raw) {
        if (raw.reputation > 10000) score += 20
        else if (raw.reputation > 1000) score += 15
        else if (raw.reputation > 100) score += 10
        if (raw.answerCount > 100) score += 10
        else if (raw.answerCount > 20) score += 5
        score += Math.min(raw.badgeGold * 3, 9)
      }
      if (requiredSkills.length > 0) {
        const matches = skillsLower.filter(s => requiredSkills.some(rs => s.includes(rs) || rs.includes(s)))
        score += Math.min(matches.length * 5, 15)
      }
    }

    if (source === 'kaggle') {
      score = 55
      const raw = c.raw as KaggleUser
      if (raw) {
        if (raw.totalVotes > 100) score += 20
        else if (raw.totalVotes > 20) score += 15
        else if (raw.totalVotes > 5) score += 10
        if (raw.datasetCount > 5) score += 10
        else if (raw.datasetCount > 1) score += 5
        if (raw.kernelCount > 5) score += 10
        else if (raw.kernelCount > 1) score += 5
      }
      if (requiredSkills.length > 0) {
        const matches = skillsLower.filter(s => requiredSkills.some(rs => s.includes(rs) || rs.includes(s)))
        score += Math.min(matches.length * 5, 15)
      }
    }

    if (source === 'coresignal') {
      score = 65
      const raw = c.raw as CoresignalUser
      if (raw) {
        if (raw.connectionsCount && raw.connectionsCount > 500) score += 10
        else if (raw.connectionsCount && raw.connectionsCount > 100) score += 5
        if (raw.followersCount && raw.followersCount > 1000) score += 10
        else if (raw.followersCount && raw.followersCount > 100) score += 5
        if (raw.currentTitle) score += 5
        if (raw.currentCompany) score += 5
        if (raw.skills && raw.skills.length > 3) score += 5
      }
      if (requiredSkills.length > 0) {
        const matches = skillsLower.filter(s => requiredSkills.some(rs => s.includes(rs) || rs.includes(s)))
        score += Math.min(matches.length * 5, 15)
      }
    }

    sourceScores[source] = Math.min(score, 100)
  }

  const sourceCount = sources.length
  const multiSourceBonus = Math.min((sourceCount - 1) * 8, 20)

  const avgSourceScore = Object.values(sourceScores).reduce((a, b) => a + b, 0) / sourceCount
  const completenessBonus = [
    c.linkedinUrl ? 5 : 0,
    c.githubUrl ? 5 : 0,
    c.location ? 3 : 0,
    c.company ? 3 : 0,
    c.title ? 4 : 0,
  ].reduce((a, b) => a + b, 0)

  const overallScore = Math.min(Math.round(avgSourceScore + multiSourceBonus + completenessBonus), 100)

  return { overallScore, sourceScores }
}

// ─── Orchestrator ───────────────────────────────────────────

export async function searchAllProviders(filters: AllSearchFilters): Promise<AllSearchResult> {
  const providers = filters.providers || ['pdl', 'github', 'stackoverflow', 'kaggle']
  const size = Math.min(Math.max(filters.size || 25, 1), 100)

  const searchPromises: Promise<{ source: string; result: any }>[] = []
  const totals: Record<string, number> = {}

  if (providers.includes('pdl')) {
    // Skip PDL entirely if quota is known to be exhausted — don't waste API calls
    if (isPdlQuotaExhausted()) {
      console.log('[SearchAll] PDL quota exhausted — skipping PDL provider')
      totals.pdl = 0
    } else {
      // Cap PDL size to 25 to avoid hitting monthly quota with large requests
      // The service auto-retries with smaller sizes on 402, but starting smaller is safer
      const pdlSize = Math.min(size, 25)
      searchPromises.push(
        searchPersons({
          jobTitle: filters.jobTitle,
          skills: filters.skills,
          country: filters.country,
          industry: filters.industry,
          experience: filters.experience,
          keywords: filters.keywords,
          size: pdlSize,
        }).then(r => ({ source: 'pdl', result: r })).catch(e => {
          console.error('[SearchAll] PDL failed:', e.message)
          return { source: 'pdl', result: { candidates: [], total: 0, scrollToken: null } }
        })
      )
    }
  }

  // Derive provider-specific queries from generic fields when not explicitly set
  const ghQuery = filters.ghQuery || [filters.jobTitle, ...(filters.skills || []), filters.keywords].filter(Boolean).join(' ')
  const soTag = filters.soTag || filters.skills?.join(';') || filters.jobTitle || ''
  const kaggleQuery = filters.kaggleQuery || [filters.jobTitle, ...(filters.skills || []), filters.keywords].filter(Boolean).join(' ')

  if (providers.includes('github') && ghQuery) {
    searchPromises.push(
      searchGithubUsers({
        query: ghQuery,
        language: filters.language,
        location: filters.location,
        minFollowers: filters.minFollowers,
        minRepos: filters.minRepos,
        size,
      }).then(r => ({ source: 'github', result: r })).catch(e => {
        console.error('[SearchAll] GitHub failed:', e.message)
        return { source: 'github', result: { users: [], total: 0 } }
      })
    )
  }

  if (providers.includes('stackoverflow') && soTag) {
    searchPromises.push(
      searchStackoverflowUsers({
        tags: soTag,
        minReputation: filters.minReputation,
        location: filters.location,
        size,
      }).then(r => ({ source: 'stackoverflow', result: r })).catch(e => {
        console.error('[SearchAll] SO failed:', e.message)
        return { source: 'stackoverflow', result: { users: [], total: 0, invalidTags: [], suggestedTags: [] } }
      })
    )
  }

  if (providers.includes('kaggle') && kaggleQuery) {
    searchPromises.push(
      searchKaggleUsers({
        query: kaggleQuery,
        sortBy: filters.kaggleSortBy as any,
        size,
      }).then(r => ({ source: 'kaggle', result: r })).catch(e => {
        console.error('[SearchAll] Kaggle failed:', e.message)
        return { source: 'kaggle', result: { users: [], total: 0 } }
      })
    )
  }

  const coresignalQuery = filters.coresignalQuery || [filters.coresignalJobTitle || filters.jobTitle, ...(filters.skills || []), filters.keywords].filter(Boolean).join(' ')

  if (providers.includes('coresignal') && coresignalQuery) {
    searchPromises.push(
      searchCoresignalUsers({
        query: coresignalQuery,
        jobTitle: filters.coresignalJobTitle || filters.jobTitle,
        skills: filters.skills,
        location: filters.coresignalLocation || filters.location,
        company: filters.coresignalCompany,
        size,
      }).then(r => ({ source: 'coresignal', result: r })).catch(e => {
        console.error('[SearchAll] Coresignal failed:', e.message)
        return { source: 'coresignal', result: { users: [], total: 0 } }
      })
    )
  }

  const settled = await Promise.all(searchPromises)

  let allExtracted: ExtractedCandidate[] = []

  for (const { source, result } of settled) {
    if (source === 'pdl') {
      totals.pdl = result.total || 0
      allExtracted.push(...result.candidates.map(extractPdl))
    } else if (source === 'github') {
      totals.github = result.total || 0
      allExtracted.push(...(result.users || []).map(extractGithub))
    } else if (source === 'stackoverflow') {
      totals.stackoverflow = result.total || 0
      allExtracted.push(...(result.users || []).map(extractSo))
    } else if (source === 'kaggle') {
      totals.kaggle = result.total || 0
      allExtracted.push(...(result.users || []).map(extractKaggle))
    } else if (source === 'coresignal') {
      totals.coresignal = result.total || 0
      allExtracted.push(...(result.users || []).map(extractCoresignal))
    }
  }

  console.log(`[SearchAll] Extracted ${allExtracted.length} candidates from ${settled.length} providers`)

  const deduped = deduplicate(allExtracted)
  console.log(`[SearchAll] After dedup: ${deduped.length} unique candidates`)

  const scored = deduped.map(c => {
    const { overallScore, sourceScores } = scoreCandidate(c, filters)
    return { ...c, overallScore, sourceScores }
  })

  scored.sort((a, b) => b.overallScore - a.overallScore)

  const topCandidates = scored.slice(0, size)

  const unified: UnifiedCandidate[] = topCandidates.map(c => ({
    id: `${c.source.split(',')[0]}:${c.sourceId}`,
    name: c.name,
    title: c.title,
    company: c.company,
    location: c.location,
    skills: c.skills,
    experience: c.experience,
    sources: c.source.split(','),
    githubUrl: c.githubUrl,
    linkedinUrl: c.linkedinUrl,
    profileUrl: c.profileUrl,
    avatarUrl: c.avatarUrl,
    overallScore: c.overallScore,
    sourceScores: c.sourceScores,
    raw: buildRawPayload(c),
  }))

  return { candidates: unified, totals, saved: 0 }
}

function buildRawPayload(c: ExtractedCandidate): UnifiedCandidate['raw'] {
  const sources = c.source.split(',')
  const primarySource = sources[0]

  if (primarySource === 'pdl') return { pdl: c.raw }
  if (primarySource === 'github') return { github: c.raw }
  if (primarySource === 'stackoverflow') return { so: c.raw }
  if (primarySource === 'kaggle') return { kaggle: c.raw }
  if (primarySource === 'coresignal') return { coresignal: c.raw }
  return {}
}
