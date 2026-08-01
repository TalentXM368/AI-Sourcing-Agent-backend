import { pool } from '../src/db/index.js'
import { VECTOR_CONSTANTS } from '../src/modules/vector-intelligence/constants/index.js'

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333'

async function qdrantRequest(path: string, body: any) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Qdrant ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function qdrantUpsert(collection: string, points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>) {
  if (points.length === 0) return
  await qdrantRequest(`/collections/${collection}/points`, { wait: true, points })
}

async function ensureCollection(name: string, dimensions: number) {
  try {
    await qdrantRequest(`/collections/${name}`, {
      vectors: { size: dimensions, distance: 'Cosine' },
    })
  } catch (e: any) {
    if (!e.message.includes('already exists')) throw e
  }
}

async function main() {
  const dimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '384', 10)
  console.log(`=== Re-indexing Qdrant (dimensions=${dimensions}) ===\n`)

  // Ensure collections exist
  await ensureCollection(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, dimensions)
  await ensureCollection(VECTOR_CONSTANTS.COLLECTIONS.JOBS, dimensions)

  // Index candidates
  console.log('--- Candidates ---')
  const candResult = await pool.query(`
    SELECT c.id, c.name, c.headline, c.location, c.experience_years, c.skills, c.industry, c.region,
           e.vector, e.purpose
    FROM candidates c
    LEFT JOIN embeddings e ON e.entity_id = c.id AND e.purpose = 'full_text'
    WHERE c.parse_status = 'completed' AND e.vector IS NOT NULL
  `)
  console.log(`Found ${candResult.rows.length} candidates with embeddings`)

  let candIndexed = 0
  let candErrors = 0
  const candBatch: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = []

  for (const row of candResult.rows) {
    try {
      const skills = Array.isArray(row.skills) ? row.skills.map((s: any) => s.name || s) : []
      const payload = {
        entityId: row.id,
        entityType: 'candidate',
        name: row.name,
        headline: row.headline || undefined,
        skills,
        location: row.location || undefined,
        experienceYears: row.experience_years || 0,
        industry: row.industry || undefined,
      }

      candBatch.push({
        id: row.id,
        vector: row.vector,
        payload,
      })

      // Upsert in batches of 100
      if (candBatch.length >= 100) {
        await qdrantUpsert(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, candBatch)
        candIndexed += candBatch.length
        console.log(`  Indexed ${candIndexed}/${candResult.rows.length} candidates`)
        candBatch.length = 0
      }
    } catch (e) {
      console.error(`  Failed candidate ${row.id}: ${e}`)
      candErrors++
    }
  }

  // Flush remaining
  if (candBatch.length > 0) {
    await qdrantUpsert(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES, candBatch)
    candIndexed += candBatch.length
  }
  console.log(`Candidates: ${candIndexed} indexed, ${candErrors} errors\n`)

  // Index jobs
  console.log('--- Jobs ---')
  const jobResult = await pool.query(`
    SELECT j.id, j.role, j.company, j.location, j.required_skills, j.nice_to_have_skills,
           j.experience_min, j.experience_max, j.industry, j.region,
           e.vector, e.purpose
    FROM jobs j
    LEFT JOIN embeddings e ON e.entity_id = j.id AND e.purpose = 'full_text'
    WHERE e.vector IS NOT NULL
  `)
  console.log(`Found ${jobResult.rows.length} jobs with embeddings`)

  let jobIndexed = 0
  let jobErrors = 0
  const jobBatch: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = []

  for (const row of jobResult.rows) {
    try {
      const skills = [...(row.required_skills || []), ...(row.nice_to_have_skills || [])]
      const payload = {
        entityId: row.id,
        entityType: 'job',
        name: row.role,
        headline: row.company || undefined,
        skills,
        location: row.location || undefined,
        experienceYears: row.experience_max || undefined,
        industry: row.industry || undefined,
      }

      jobBatch.push({
        id: row.id,
        vector: row.vector,
        payload,
      })

      if (jobBatch.length >= 100) {
        await qdrantUpsert(VECTOR_CONSTANTS.COLLECTIONS.JOBS, jobBatch)
        jobIndexed += jobBatch.length
        console.log(`  Indexed ${jobIndexed}/${jobResult.rows.length} jobs`)
        jobBatch.length = 0
      }
    } catch (e) {
      console.error(`  Failed job ${row.id}: ${e}`)
      jobErrors++
    }
  }

  if (jobBatch.length > 0) {
    await qdrantUpsert(VECTOR_CONSTANTS.COLLECTIONS.JOBS, jobBatch)
    jobIndexed += jobBatch.length
  }
  console.log(`Jobs: ${jobIndexed} indexed, ${jobErrors} errors\n`)

  // Verify counts
  const candCount = await fetch(`${QDRANT_URL}/collections/${VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES}/points/count`).then(r => r.json())
  const jobCount = await fetch(`${QDRANT_URL}/collections/${VECTOR_CONSTANTS.COLLECTIONS.JOBS}/points/count`).then(r => r.json())
  console.log(`=== Verification ===`)
  console.log(`Qdrant candidates: ${candCount.result?.count || 'unknown'}`)
  console.log(`Qdrant jobs: ${jobCount.result?.count || 'unknown'}`)

  await pool.end()
  console.log('\nDone!')
}

main().catch(console.error)
