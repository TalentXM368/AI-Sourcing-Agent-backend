const GITHUB_API = 'https://api.github.com'

export interface GithubSearchFilters {
  query: string
  language?: string
  location?: string
  minFollowers?: number
  minRepos?: number
  size?: number
}

export interface GithubUser {
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
  createdAt: string
  languages: string[]
}

const CONCURRENCY = 10
const FETCH_TIMEOUT_MS = 15_000

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

function buildSearchQuery(filters: GithubSearchFilters): string {
  // GitHub Search API natively supports OR, AND, and - (NOT)
  // Pass the user's query through as-is to preserve boolean operators
  const parts: string[] = [filters.query]
  if (filters.language) parts.push(`language:${filters.language}`)
  if (filters.location) parts.push(`location:${filters.location}`)
  if (filters.minFollowers) parts.push(`followers:>${filters.minFollowers}`)
  if (filters.minRepos) parts.push(`repos:>${filters.minRepos}`)
  parts.push('type:user')
  return parts.join(' ')
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const res = await fetch(url, { headers: getHeaders(), signal: controller.signal })
  clearTimeout(timeout)

  if (res.status === 403) {
    const reset = res.headers.get('x-ratelimit-reset')
    if (reset) {
      const waitMs = Math.max(0, Number(reset) * 1000 - Date.now()) + 1000
      if (waitMs < 15000) {
        await new Promise(r => setTimeout(r, waitMs))
        const controller2 = new AbortController()
        const timeout2 = setTimeout(() => controller2.abort(), FETCH_TIMEOUT_MS)
        const retry = await fetch(url, { headers: getHeaders(), signal: controller2.signal })
        clearTimeout(timeout2)
        if (!retry.ok) throw new Error(`GitHub API: ${retry.status}`)
        return retry.json()
      }
    }
  }

  if (!res.ok) throw new Error(`GitHub API: ${res.status} ${res.statusText}`)
  return res.json()
}

async function runParallel<T>(items: T[], fn: (item: T) => Promise<any>, concurrency: number): Promise<any[]> {
  const results: any[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn))
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    }
  }
  return results
}

export async function searchGithubUsers(filters: GithubSearchFilters): Promise<{ users: GithubUser[]; total: number }> {
  const searchQuery = buildSearchQuery(filters)
  const size = Math.min(filters.size || 25, 100)

  console.log(`[GitHub] Searching: "${searchQuery}" (size: ${size})`)

  const searchData = await fetchJson(
    `${GITHUB_API}/search/users?q=${encodeURIComponent(searchQuery)}&per_page=${size}`
  )

  const total = searchData.total_count || 0
  const items: any[] = searchData.items || []

  console.log(`[GitHub] Found ${total} total, fetching ${items.length} profiles in parallel`)

  // Fetch all profiles in parallel batches
  const profiles = await runParallel(
    items,
    (item) => fetchJson(`${GITHUB_API}/users/${item.login}`),
    CONCURRENCY
  )

  // Fetch languages for all profiles in parallel batches
  const profileMap = new Map<string, any>()
  for (const p of profiles) profileMap.set(p.login, p)

  const languageResults = await runParallel(
    items,
    async (item) => {
      try {
        const repos: any[] = await fetchJson(`${GITHUB_API}/users/${item.login}/repos?per_page=30&sort=updated`)
        const langs = new Set<string>()
        for (const repo of repos) {
          if (repo.language) langs.add(repo.language)
        }
        return { login: item.login, languages: Array.from(langs).slice(0, 10) }
      } catch {
        return { login: item.login, languages: [] as string[] }
      }
    },
    CONCURRENCY
  )

  const langMap = new Map<string, string[]>()
  for (const l of languageResults) langMap.set(l.login, l.languages)

  // Build results in search order
  const users: GithubUser[] = []
  for (const item of items) {
    const profile = profileMap.get(item.login)
    if (!profile) continue

    users.push({
      login: profile.login,
      name: profile.name,
      bio: profile.bio,
      location: profile.location,
      email: profile.email,
      company: profile.company,
      blog: profile.blog,
      avatarUrl: profile.avatar_url,
      htmlUrl: profile.html_url,
      publicRepos: profile.public_repos || 0,
      followers: profile.followers || 0,
      hireable: profile.hireable,
      createdAt: profile.created_at,
      languages: langMap.get(item.login) || [],
    })
  }

  console.log(`[GitHub] Done: ${users.length} profiles in parallel`)
  return { users, total }
}
