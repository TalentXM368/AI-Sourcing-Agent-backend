import { parseBooleanQuery, hasBooleanOperators } from '../utils/boolean-parser.js'

const KAGGLE_API = 'https://www.kaggle.com/api/v1'

export interface KaggleSearchFilters {
  query: string
  sortBy?: 'votes' | 'hotness' | 'dateCreated' | 'viewCount'
  size?: number
}

export interface KaggleUser {
  username: string
  displayName: string | null
  profileUrl: string
  imageUrl: string | null
  datasetCount: number
  kernelCount: number
  totalVotes: number
  totalViews: number
  topDatasets: Array<{ title: string; slug: string; votes: number; url: string }>
  topKernels: Array<{ title: string; slug: string; votes: number; url: string }>
  searchedTopics: string
}

// ─── Auth ────────────────────────────────────────────────────

function getAuth(): { username: string; key: string } {
  const username = process.env.KAGGLE_USERNAME
  const key = process.env.KAGGLE_KEY
  if (!username || !key) {
    throw new Error('Kaggle API credentials not configured. Set KAGGLE_USERNAME and KAGGLE_KEY in .env')
  }
  return { username, key }
}

function getHeaders(): Record<string, string> {
  const { username, key } = getAuth()
  const token = Buffer.from(`${username}:${key}`).toString('base64')
  return {
    'Authorization': `Basic ${token}`,
    'Accept': 'application/json',
  }
}

// ─── Rate Limiting ───────────────────────────────────────────

let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 200 // 200ms between requests = ~5 req/sec

async function throttledFetch(url: string): Promise<any> {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed))
  }
  lastRequestTime = Date.now()

  const res = await fetch(url, { headers: getHeaders() })

  if (res.status === 429) {
    console.log('[Kaggle] Rate limited, waiting 10s...')
    await new Promise(r => setTimeout(r, 10000))
    return throttledFetch(url)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kaggle API: ${res.status} ${res.statusText} ${body}`)
  }

  return res.json()
}

// ─── Search Datasets ─────────────────────────────────────────

interface KaggleDataset {
  ref: string
  title: string
  ownerRef: string
  ownerName: string
  totalBytes: number
  downloadCount: number
  voteCount: number
  viewCount: number
  lastUpdated: string
  tags: Array<{ name: string; description: string }>
  kernelCount: number
}

async function searchDatasets(
  query: string,
  sortBy: string,
  page = 1,
  pageSize = 30
): Promise<{ datasets: KaggleDataset[]; total: number }> {
  const sortMap: Record<string, string> = {
    votes: 'votes',
    hotness: 'hottest',
    dateCreated: 'dateCreated',
    viewCount: 'viewCount',
  }
  const sort = sortMap[sortBy] || 'votes'

  const url = `${KAGGLE_API}/datasets/list?search=${encodeURIComponent(query)}&sort_by=${sort}&page=${page}&page_size=${pageSize}`
  console.log(`[Kaggle] Searching datasets: "${query}" (sort: ${sort}, page: ${page})`)

  const data = await throttledFetch(url)
  return {
    datasets: Array.isArray(data) ? data : [],
    total: Array.isArray(data) ? data.length : 0,
  }
}

// ─── Search Kernels ──────────────────────────────────────────

interface KaggleKernel {
  ref: string
  title: string
  author: string
  totalBytes: number
  downloadCount: number
  totalVotes: number
  viewCount: number
  commentCount: number
  lastRunTime: string
  language: string
  kernelType: string
}

async function searchKernels(
  query: string,
  sortBy: string,
  page = 1,
  pageSize = 30
): Promise<{ kernels: KaggleKernel[]; total: number }> {
  const sortMap: Record<string, string> = {
    votes: 'voteCount',
    hotness: 'hotness',
    dateCreated: 'dateCreated',
    viewCount: 'viewCount',
  }
  const sort = sortMap[sortBy] || 'voteCount'

  const url = `${KAGGLE_API}/kernels/list?search=${encodeURIComponent(query)}&sort_by=${sort}&page=${page}&page_size=${pageSize}`
  console.log(`[Kaggle] Searching kernels: "${query}" (sort: ${sort}, page: ${page})`)

  const data = await throttledFetch(url)
  return {
    kernels: Array.isArray(data) ? data : [],
    total: Array.isArray(data) ? data.length : 0,
  }
}

// ─── Extract owner username from ownerRef ────────────────────

function extractOwnerUsername(ownerRef: string): string {
  // ownerRef can be "timoboz" or "organizations/mlg-ulb"
  if (ownerRef.startsWith('organizations/')) {
    return ownerRef.replace('organizations/', '')
  }
  return ownerRef
}

// ─── Fetch User Datasets ─────────────────────────────────────

async function fetchUserDatasets(username: string, limit = 20): Promise<Array<{ title: string; slug: string; votes: number; url: string }>> {
  try {
    const url = `${KAGGLE_API}/datasets/list?user=${encodeURIComponent(username)}&sort_by=votes&page_size=${limit}`
    const data = await throttledFetch(url)
    const items: KaggleDataset[] = Array.isArray(data) ? data : []
    return items.map(d => ({
      title: d.title,
      slug: d.ref.split('/').pop() || d.title,
      votes: d.voteCount || 0,
      url: `https://www.kaggle.com/datasets/${d.ref}`,
    }))
  } catch (err: any) {
    console.error(`[Kaggle] Failed to fetch datasets for ${username}:`, err.message)
    return []
  }
}

// ─── Fetch User Kernels ──────────────────────────────────────

async function fetchUserKernels(username: string, limit = 20): Promise<Array<{ title: string; slug: string; votes: number; url: string }>> {
  try {
    const url = `${KAGGLE_API}/kernels/list?user=${encodeURIComponent(username)}&sort_by=voteCount&page_size=${limit}`
    const data = await throttledFetch(url)
    const items: KaggleKernel[] = Array.isArray(data) ? data : []
    return items.map(k => ({
      title: k.title,
      slug: k.ref.split('/').pop() || k.title,
      votes: k.totalVotes || 0,
      url: `https://www.kaggle.com/code/${k.ref}`,
    }))
  } catch (err: any) {
    console.error(`[Kaggle] Failed to fetch kernels for ${username}:`, err.message)
    return []
  }
}

// ─── Main Search Function ────────────────────────────────────

export async function searchKaggleUsers(
  filters: KaggleSearchFilters
): Promise<{ users: KaggleUser[]; total: number }> {
  const size = Math.min(filters.size || 25, 100)
  const sortBy = filters.sortBy || 'votes'

  // Parse boolean operators in query
  let searchQueries: string[]
  let excludedTerms: string[] = []

  if (hasBooleanOperators(filters.query)) {
    const bq = parseBooleanQuery(filters.query)
    searchQueries = bq.terms
    excludedTerms = bq.excluded
  } else {
    searchQueries = [filters.query]
  }

  console.log(`[Kaggle] Searching: "${filters.query}" (queries: ${searchQueries.join(', ')}, sort: ${sortBy})`)

  // Search both datasets and kernels for each query term
  const allDatasetResults = await Promise.all(searchQueries.map(q => searchDatasets(q, sortBy, 1, 50)))
  const allKernelResults = await Promise.all(searchQueries.map(q => searchKernels(q, sortBy, 1, 50)))

  // Deduplicate datasets/kernels across query terms
  const seenDatasets = new Set<string>()
  const seenKernels = new Set<string>()
  const datasets: any[] = []
  const kernels: any[] = []

  for (const result of allDatasetResults) {
    for (const ds of result.datasets) {
      if (!seenDatasets.has(ds.ref)) {
        seenDatasets.add(ds.ref)
        datasets.push(ds)
      }
    }
  }
  for (const result of allKernelResults) {
    for (const k of result.kernels) {
      if (!seenKernels.has(k.ref)) {
        seenKernels.add(k.ref)
        kernels.push(k)
      }
    }
  }

  console.log(`[Kaggle] Found ${datasets.length} datasets, ${kernels.length} kernels`)

  // Extract unique authors from datasets
  const authorMap = new Map<string, {
    username: string
    datasetCount: number
    kernelCount: number
    totalVotes: number
    totalViews: number
    topDatasets: Array<{ title: string; slug: string; votes: number; url: string }>
    topKernels: Array<{ title: string; slug: string; votes: number; url: string }>
  }>()

  // Process dataset authors
  for (const ds of datasets) {
    const owner = ds.ownerRef ? extractOwnerUsername(ds.ownerRef) : null
    if (!owner) continue

    if (!authorMap.has(owner)) {
      authorMap.set(owner, {
        username: owner,
        datasetCount: 0,
        kernelCount: 0,
        totalVotes: 0,
        totalViews: 0,
        topDatasets: [],
        topKernels: [],
      })
    }
    const author = authorMap.get(owner)!
    author.datasetCount++
    author.totalVotes += ds.voteCount || 0
    author.totalViews += ds.viewCount || 0
    if (author.topDatasets.length < 5) {
      author.topDatasets.push({
        title: ds.title,
        slug: ds.ref.split('/').pop() || ds.title,
        votes: ds.voteCount || 0,
        url: `https://www.kaggle.com/datasets/${ds.ref}`,
      })
    }
  }

  // Process kernel authors
  for (const kernel of kernels) {
    const author = kernel.author
    if (!author) continue

    if (!authorMap.has(author)) {
      authorMap.set(author, {
        username: author,
        datasetCount: 0,
        kernelCount: 0,
        totalVotes: 0,
        totalViews: 0,
        topDatasets: [],
        topKernels: [],
      })
    }
    const a = authorMap.get(author)!
    a.kernelCount++
    a.totalVotes += kernel.totalVotes || 0
    a.totalViews += kernel.viewCount || 0
    if (a.topKernels.length < 5) {
      a.topKernels.push({
        title: kernel.title,
        slug: kernel.ref.split('/').pop() || kernel.title,
        votes: kernel.totalVotes || 0,
        url: `https://www.kaggle.com/code/${kernel.ref}`,
      })
    }
  }

  // Sort by total votes (most active first)
  let authors = Array.from(authorMap.values())
    .sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, size)

  console.log(`[Kaggle] ${authors.length} unique authors found, fetching profiles...`)

  // Fetch detailed dataset/kernel lists for top authors (batched)
  const users: KaggleUser[] = []
  const BATCH = 5

  for (let i = 0; i < authors.length; i += BATCH) {
    const batch = authors.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(async (author) => {
        const [datasets, kernels] = await Promise.all([
          fetchUserDatasets(author.username, 5),
          fetchUserKernels(author.username, 5),
        ])

        // Update counts from actual API data (more accurate than search results)
        const realDatasetCount = datasets.length > 0 ? datasets.length : author.datasetCount
        const realKernelCount = kernels.length > 0 ? kernels.length : author.kernelCount

        return {
          username: author.username,
          displayName: null as string | null,
          profileUrl: `https://www.kaggle.com/${author.username}`,
          imageUrl: null as string | null,
          datasetCount: realDatasetCount || author.datasetCount,
          kernelCount: realKernelCount || author.kernelCount,
          totalVotes: author.totalVotes,
          totalViews: author.totalViews,
          topDatasets: datasets.length > 0 ? datasets.slice(0, 5) : author.topDatasets,
          topKernels: kernels.length > 0 ? kernels.slice(0, 5) : author.topKernels,
          searchedTopics: filters.query,
        }
      })
    )

    for (const r of results) {
      if (r.status === 'fulfilled') users.push(r.value)
    }
  }

  console.log(`[Kaggle] Done: ${users.length} profiles`)
  return { users, total: authorMap.size }
}
