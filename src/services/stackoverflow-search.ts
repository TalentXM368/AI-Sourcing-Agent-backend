import { parseBooleanQuery, hasBooleanOperators } from '../utils/boolean-parser.js'

const SO_API = 'https://api.stackexchange.com/2.3'
const FETCH_TIMEOUT_MS = 15_000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)
    return res
  } catch (error: any) {
    clearTimeout(timeout)
    if (error.name === 'AbortError') throw new Error('StackOverflow API timed out')
    throw error
  }
}

export interface StackoverflowSearchFilters {
  tags: string
  minReputation?: number
  location?: string
  size?: number
}

export interface StackoverflowUser {
  userId: number
  displayName: string
  link: string
  profileImage: string
  reputation: number
  topTags: string
  searchedTags: string
  badgeGold: number
  badgeSilver: number
  badgeBronze: number
  answerCount: number
  location: string | null
}

// ─── Validate tags exist on SO ─────────────────────────────

async function validateTags(tags: string[]): Promise<{ valid: string[]; invalid: string[] }> {
  if (tags.length === 0) return { valid: [], invalid: [] }

  const tagList = tags.join(';')
  const url = `${SO_API}/tags/${encodeURIComponent(tagList)}/info?site=stackoverflow`

  try {
    const res = await fetchWithTimeout(url)
    if (!res.ok) return { valid: [], invalid: tags }

    const data = await res.json() as { items?: Array<{ name: string }> }
    const validNames = new Set((data.items || []).map(t => t.name.toLowerCase()))
    const valid = tags.filter(t => validNames.has(t))
    const invalid = tags.filter(t => !validNames.has(t))
    return { valid, invalid }
  } catch {
    return { valid: [], invalid: tags }
  }
}

// ─── Role-to-tags mapping for common non-technical roles ─────

const ROLE_TAG_MAP: Record<string, string[]> = {
  'marketing': ['google-analytics', 'google-tag-manager', 'google-data-studio', 'tableau', 'powerbi', 'facebook-marketing-api', 'salesforce-marketing-cloud', 'seo', 'sem', 'google-ads', 'facebook-ads'],
  'data analyst': ['sql', 'python', 'pandas', 'tableau', 'powerbi', 'excel', 'google-data-studio', 'r', 'statistics', 'machine-learning', 'numpy', 'matplotlib'],
  'frontend': ['javascript', 'typescript', 'react', 'vue', 'angular', 'css', 'html', 'next.js', 'tailwind-css', 'svelte'],
  'backend': ['python', 'java', 'node.js', 'go', 'rust', 'postgresql', 'mysql', 'redis', 'docker', 'kubernetes'],
  'devops': ['docker', 'kubernetes', 'terraform', 'aws', 'ansible', 'jenkins', 'ci-cd', 'linux', 'bash', 'prometheus', 'grafana'],
  'mobile': ['swift', 'kotlin', 'react-native', 'flutter', 'android', 'ios', 'xamarin'],
  'machine learning': ['python', 'tensorflow', 'pytorch', 'scikit-learn', 'machine-learning', 'deep-learning', 'neural-network', 'nlp', 'computer-vision'],
  'product manager': ['agile', 'scrum', 'jira', 'sql', 'python', 'figma', 'product-management', 'user-research'],
  'qa': ['selenium', 'cypress', 'jest', 'pytest', 'automation-testing', 'junit', 'testng', 'postman', 'api-testing'],
  'security': ['python', 'penetration-testing', 'owasp', 'kali-linux', 'siem', 'cryptography', 'network-security'],
  'cloud': ['aws', 'azure', 'gcp', 'terraform', 'docker', 'kubernetes', 'serverless', 'cloudformation'],
}

function suggestTagsForRole(query: string): string[] {
  const q = query.toLowerCase()
  for (const [role, tags] of Object.entries(ROLE_TAG_MAP)) {
    if (q.includes(role)) return tags
  }
  return []
}

// ─── Search for tags by name (for autocomplete) ──────────────

export async function searchTags(query: string, size = 10): Promise<Array<{ name: string; count: number }>> {
  if (!query.trim()) return []

  // Check role mapping first
  const roleSuggestions = suggestTagsForRole(query)
  if (roleSuggestions.length > 0) {
    // Validate that these tags exist on SO
    const validated = await validateTags(roleSuggestions)
    if (validated.valid.length > 0) {
      // Fetch counts for valid tags
      const tagList = validated.valid.join(';')
      const url = `${SO_API}/tags/${encodeURIComponent(tagList)}/info?site=stackoverflow`
      try {
        const res = await fetchWithTimeout(url)
        if (res.ok) {
          const data = await res.json() as { items?: Array<{ name: string; count: number }> }
          const items = (data.items || []).sort((a, b) => b.count - a.count).slice(0, size)
          if (items.length > 0) return items
        }
      } catch {}
    }
  }

  // Fall back to SO tag search — try each word separately for multi-word queries
  const words = query.split(/\s+/).filter(w => w.length >= 2)
  const allResults = new Map<string, { name: string; count: number }>()

  for (const word of words) {
    const url = `${SO_API}/tags?order=desc&sort=popular&inname=${encodeURIComponent(word)}&site=stackoverflow&pagesize=${size}`
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) continue
      const data = await res.json() as { items?: Array<{ name: string; count: number }> }
      for (const tag of data.items || []) {
        if (!allResults.has(tag.name)) {
          allResults.set(tag.name, tag)
        }
      }
    } catch {}
  }

  // If no results from word search, try the full query as-is
  if (allResults.size === 0) {
    const url = `${SO_API}/tags?order=desc&sort=popular&inname=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${size}`
    try {
      const res = await fetchWithTimeout(url)
      if (res.ok) {
        const data = await res.json() as { items?: Array<{ name: string; count: number }> }
        for (const tag of data.items || []) {
          allResults.set(tag.name, tag)
        }
      }
    } catch {}
  }

  return Array.from(allResults.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, size)
}

// ─── Fetch top answerers for a tag ────────────────────────────

async function getTopAnswerersByTag(tag: string): Promise<Array<{ user_id: number; display_name: string; reputation: number; link: string }>> {
  const url = `${SO_API}/tags/${encodeURIComponent(tag)}/top-answerers/all_time?site=stackoverflow&pagesize=100`
  const res = await fetchWithTimeout(url)

  if (!res.ok) {
    console.error(`[SO] Failed to fetch top answerers for tag "${tag}": ${res.status}`)
    return []
  }

  const data = await res.json() as { items?: Array<{ user: { user_id: number; display_name: string; reputation: number; link: string } }> }
  return (data.items || []).map((item) => ({
    user_id: item.user.user_id,
    display_name: item.user.display_name,
    reputation: item.user.reputation,
    link: item.user.link,
  }))
}

// ─── Fetch user profiles in batches of 100 ────────────────────

async function fetchUserProfiles(userIds: number[]): Promise<Map<number, any>> {
  const profileMap = new Map<number, any>()

  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100)
    const ids = batch.join(';')
    const url = `${SO_API}/users/${ids}?site=stackoverflow`

    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        console.error(`[SO] Failed to fetch user profiles: ${res.status}`)
        continue
      }

      const data = await res.json() as { items?: Array<{ user_id: number; display_name: string; location?: string; reputation: number; profile_image?: string; badge_counts?: { gold: number; silver: number; bronze: number }; top_tags?: string[]; answer_count?: number }> }
      for (const user of data.items || []) {
        profileMap.set(user.user_id, user)
      }
    } catch (err: any) {
      console.error(`[SO] Error fetching user profiles batch:`, err.message)
    }
  }

  return profileMap
}

// ─── Main search function ─────────────────────────────────────

export async function searchStackoverflowUsers(
  filters: StackoverflowSearchFilters
): Promise<{ users: StackoverflowUser[]; total: number; invalidTags: string[]; suggestedTags: string[] }> {
  // Parse boolean operators in tags: "python OR javascript" → two tags, "python AND react" → both required
  let tagList: string[]
  let booleanMode: 'or' | 'and' = 'or'

  if (hasBooleanOperators(filters.tags)) {
    const bq = parseBooleanQuery(filters.tags)
    tagList = bq.terms.map(t => t.trim().toLowerCase()).filter(Boolean)
    booleanMode = bq.operator
  } else {
    tagList = filters.tags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  }

  tagList = tagList.slice(0, 5)

  const size = Math.min(filters.size || 25, 100)

  console.log(`[SO] Searching tags: ${tagList.join(', ')} (size: ${size}, mode: ${booleanMode})`)

  // Validate tags exist on SO
  const { valid, invalid } = await validateTags(tagList)

  // If some tags invalid but we have valid ones, continue with valid only
  // If ALL tags invalid, auto-resolve using role mapping or SO tag search
  let resolvedTags = valid
  let autoResolved = false

  if (valid.length === 0) {
    const combinedQuery = invalid.join(' ')
    const roleSuggestions = suggestTagsForRole(combinedQuery)

    if (roleSuggestions.length > 0) {
      const validated = await validateTags(roleSuggestions)
      resolvedTags = validated.valid.slice(0, 3)
    }

    if (resolvedTags.length === 0) {
      const soTags = await searchTags(combinedQuery, 3)
      resolvedTags = soTags.map(s => s.name)
    }

    if (resolvedTags.length > 0) {
      autoResolved = true
      console.log(`[SO] All tags invalid: ${invalid.join(', ')}. Auto-resolved to: ${resolvedTags.join(', ')}`)
    }
  }

  if (resolvedTags.length === 0) {
    console.log(`[SO] No valid tags found for: ${tagList.join(', ')}`)
    return {
      users: [],
      total: 0,
      invalidTags: invalid,
      suggestedTags: [],
    }
  }

  console.log(`[SO] Searching tags: ${resolvedTags.join(', ')}${autoResolved ? ' (auto-resolved from: ' + invalid.join(', ') + ')' : ''}`)

  // Collect all top answerers across all tags
  const allAnswerers = new Map<number, { user_id: number; display_name: string; reputation: number; link: string }>()

  for (const tag of resolvedTags) {
    const answerers = await getTopAnswerersByTag(tag)
    for (const a of answerers) {
      if (!allAnswerers.has(a.user_id)) {
        allAnswerers.set(a.user_id, a)
      }
    }
  }

  console.log(`[SO] Found ${allAnswerers.size} unique answerers across ${resolvedTags.length} tags`)

  // Apply reputation filter
  let filteredIds = Array.from(allAnswerers.values())
  if (filters.minReputation) {
    filteredIds = filteredIds.filter(a => a.reputation >= filters.minReputation!)
  }

  // Sort by reputation descending
  filteredIds.sort((a, b) => b.reputation - a.reputation)

  // Take top N
  const topIds = filteredIds.slice(0, size).map(a => a.user_id)

  if (topIds.length === 0) {
    // Suggest popular related tags
    const suggested = invalid[0] ? await searchTags(invalid[0], 5) : []
    return {
      users: [],
      total: allAnswerers.size,
      invalidTags: invalid,
      suggestedTags: suggested.map(s => s.name),
    }
  }

  // Fetch full profiles
  const profileMap = await fetchUserProfiles(topIds)

  // Build results
  const users: StackoverflowUser[] = []
  for (const id of topIds) {
    const answerer = allAnswerers.get(id)!
    const profile = profileMap.get(id)

    const location = profile?.location || null

    // Apply location filter
    if (filters.location && location) {
      const locLower = location.toLowerCase()
      const filterLower = filters.location.toLowerCase()
      if (!locLower.includes(filterLower)) continue
    } else if (filters.location && !location) {
      continue
    }

    const profileTopTags = (profile?.top_tags || []).slice(0, 10).join(', ')
    // Combine searched tags + profile top tags, deduplicate
    const allTags = [...new Set([...resolvedTags, ...profileTopTags.split(',').map((t: string) => t.trim())])].filter(Boolean)
    const topTags = allTags.slice(0, 10).join(', ')

    users.push({
      userId: id,
      displayName: answerer.display_name,
      link: answerer.link,
      profileImage: profile?.profile_image || '',
      reputation: answerer.reputation,
      topTags,
      searchedTags: resolvedTags.join(', '),
      badgeGold: profile?.badge_counts?.gold || 0,
      badgeSilver: profile?.badge_counts?.silver || 0,
      badgeBronze: profile?.badge_counts?.bronze || 0,
      answerCount: profile?.answer_count || 0,
      location,
    })
  }

  console.log(`[SO] Returning ${users.length} users (total unique answerers: ${allAnswerers.size})`)
  return { users, total: allAnswerers.size, invalidTags: invalid, suggestedTags: [] }
}
