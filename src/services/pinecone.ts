import { PineconeClient } from 'pinecone-client'

// ─── Pinecone Client ──────────────────────────────────────────

type PineconeMeta = Record<string, string | number | boolean | string[]>

let pinecone: PineconeClient<PineconeMeta> | null = null

async function getPinecone(): Promise<PineconeClient<PineconeMeta>> {
  if (!pinecone) {
    if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_BASE_URL) {
      throw new Error('PINECONE_API_KEY and PINECONE_BASE_URL must be set')
    }

    pinecone = new PineconeClient<PineconeMeta>({
      apiKey: process.env.PINECONE_API_KEY,
      baseUrl: process.env.PINECONE_BASE_URL,
    })
  }

  return pinecone
}

// ─── Upsert Vectors ───────────────────────────────────────────

export async function upsertVectors(
  vectors: Array<{ id: string; values: number[]; metadata?: Record<string, any> }>
): Promise<void> {
  try {
    const client = await getPinecone()
    await client.upsert({
      vectors: vectors.map(v => ({
        id: v.id,
        values: v.values,
        metadata: (v.metadata || {}) as PineconeMeta,
      })),
    })
  } catch (error) {
    console.error('[Pinecone] Upsert failed:', error)
  }
}

// ─── Query Vectors ────────────────────────────────────────────

export async function queryVectors(
  vector: number[],
  topK: number = 100,
  filter?: Record<string, any>
): Promise<Array<{ id: string; score: number; metadata?: Record<string, any> }>> {
  try {
    const client = await getPinecone()
    const response = await client.query({
      vector,
      topK,
      includeMetadata: true,
      filter: filter as PineconeMeta | undefined,
    })

    return (response.matches || []).map((match: any) => ({
      id: match.id || '',
      score: match.score || 0,
      metadata: match.metadata as Record<string, any> | undefined,
    }))
  } catch (error) {
    console.error('[Pinecone] Query failed:', error)
    return []
  }
}

// ─── Delete Vectors ───────────────────────────────────────────

export async function deleteVectors(ids: string[]): Promise<void> {
  try {
    const client = await getPinecone()
    await client.delete({ ids })
  } catch (error) {
    console.error('[Pinecone] Delete failed:', error)
  }
}
