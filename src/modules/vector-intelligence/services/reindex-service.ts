import { pool } from '../../../db/index.js';
import type { EmbeddingProvider } from '../providers/index.js';
import type { QdrantManager } from '../qdrant/qdrant-manager.js';
import type { QdrantIndexer } from '../qdrant/qdrant-indexer.js';
import type { EmbeddingMetadata, QdrantPayload } from '../types/index.js';
import { buildCandidateQdrantPayload } from '../builders/candidate-embedding-builder.js';
import { buildJobQdrantPayload } from '../builders/job-embedding-builder.js';
import { VECTOR_CONSTANTS, CANDIDATE_COLLECTION_CONFIG, JOB_COLLECTION_CONFIG } from '../constants/index.js';

interface CandidateRow {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  experience_years: number | null;
  skills: string[];
  summary: string | null;
  raw_text: string | null;
}

interface JobRow {
  id: string;
  role: string;
  company: string | null;
  location: string | null;
  required_skills: string[];
  nice_to_have_skills: string[];
  description: string | null;
  raw_text: string | null;
}

export class ReindexService {
  private provider: EmbeddingProvider;
  private indexer: QdrantIndexer;
  private manager: QdrantManager;

  constructor(
    provider: EmbeddingProvider,
    indexer: QdrantIndexer,
    manager: QdrantManager,
  ) {
    this.provider = provider;
    this.indexer = indexer;
    this.manager = manager;
  }

  private getEmbeddingMetadata(): EmbeddingMetadata {
    return {
      embeddingVersion: VECTOR_CONSTANTS.EMBEDDING_VERSION,
      profileVersion: VECTOR_CONSTANTS.PROFILE_VERSION,
      provider: this.provider.name,
      model: this.provider.model,
      dimensions: this.provider.dimensions,
      indexedAt: new Date().toISOString(),
    };
  }

  async reindexAllCandidates(): Promise<{ indexed: number; errors: number }> {
    const rows = await pool.query<CandidateRow>(
      `SELECT id, name, headline, location, experience_years, skills, summary, raw_text
       FROM candidates
       WHERE parse_status = 'completed' AND name != 'Unknown Candidate'`,
    ).then(r => r.rows);

    if (rows.length === 0) return { indexed: 0, errors: 0 };

    let indexed = 0;
    let errors = 0;
    const metadata = this.getEmbeddingMetadata();

    for (const row of rows) {
      try {
        const semanticText = this.buildCandidateText(row);
        const [vector] = await this.provider.generateEmbeddings([semanticText]);

        const payload: QdrantPayload = {
          entityId: row.id,
          entityType: 'candidate',
          ...metadata,
          name: row.name,
          headline: row.headline || undefined,
          skills: row.skills || [],
          location: row.location || undefined,
          experienceYears: row.experience_years || undefined,
        };

        await this.indexer.upsertCandidate(row.id, vector, payload);
        indexed++;
      } catch (error) {
        console.error(`[ReindexService] Failed to reindex candidate ${row.id}:`, error);
        errors++;
      }
    }

    return { indexed, errors };
  }

  async reindexAllJobs(): Promise<{ indexed: number; errors: number }> {
    const rows = await pool.query<JobRow>(
      `SELECT id, role, company, location, required_skills, nice_to_have_skills, description, raw_text
       FROM jobs
       WHERE status = 'active'`,
    ).then(r => r.rows);

    if (rows.length === 0) return { indexed: 0, errors: 0 };

    let indexed = 0;
    let errors = 0;
    const metadata = this.getEmbeddingMetadata();

    for (const row of rows) {
      try {
        const semanticText = this.buildJobText(row);
        const [vector] = await this.provider.generateEmbeddings([semanticText]);

        const payload: QdrantPayload = {
          entityId: row.id,
          entityType: 'job',
          ...metadata,
          name: row.role,
          headline: row.company || undefined,
          skills: [...(row.required_skills || []), ...(row.nice_to_have_skills || [])],
          location: row.location || undefined,
        };

        await this.indexer.upsertJob(row.id, vector, payload);
        indexed++;
      } catch (error) {
        console.error(`[ReindexService] Failed to reindex job ${row.id}:`, error);
        errors++;
      }
    }

    return { indexed, errors };
  }

  async reindexAll(): Promise<{
    candidates: { indexed: number; errors: number };
    jobs: { indexed: number; errors: number };
  }> {
    const [candidates, jobs] = await Promise.all([
      this.reindexAllCandidates(),
      this.reindexAllJobs(),
    ]);

    return { candidates, jobs };
  }

  private buildCandidateText(row: CandidateRow): string {
    const parts = [
      row.name && `Name: ${row.name}`,
      row.headline && `Role: ${row.headline}`,
      row.skills?.length && `Skills: ${row.skills.join(', ')}`,
      row.summary && `Summary: ${row.summary}`,
      row.location && `Location: ${row.location}`,
      row.raw_text && `Resume: ${row.raw_text.substring(0, 500)}`,
    ].filter(Boolean);

    return parts.join('. ');
  }

  private buildJobText(row: JobRow): string {
    const parts = [
      row.role && `Title: ${row.role}`,
      row.company && `Company: ${row.company}`,
      row.required_skills?.length && `Required Skills: ${row.required_skills.join(', ')}`,
      row.nice_to_have_skills?.length && `Nice to Have: ${row.nice_to_have_skills.join(', ')}`,
      row.description && `Description: ${row.description.substring(0, 500)}`,
      row.location && `Location: ${row.location}`,
    ].filter(Boolean);

    return parts.join('. ');
  }

  async getStats(): Promise<{
    candidatesInDb: number;
    jobsInDb: number;
    qdrantCollections: { candidates: number; jobs: number };
  }> {
    const candidateCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM candidates WHERE parse_status = 'completed'`,
    ).then(r => parseInt(r.rows[0].count, 10));

    const jobCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM jobs WHERE status = 'active'`,
    ).then(r => parseInt(r.rows[0].count, 10));

    let qdrantCandidates = 0;
    let qdrantJobs = 0;

    try {
      const candInfo = await this.manager.getCollectionInfo(VECTOR_CONSTANTS.COLLECTIONS.CANDIDATES);
      qdrantCandidates = candInfo.points_count;
    } catch { /* collection may not exist */ }

    try {
      const jobInfo = await this.manager.getCollectionInfo(VECTOR_CONSTANTS.COLLECTIONS.JOBS);
      qdrantJobs = jobInfo.points_count;
    } catch { /* collection may not exist */ }

    return {
      candidatesInDb: candidateCount,
      jobsInDb: jobCount,
      qdrantCollections: {
        candidates: qdrantCandidates,
        jobs: qdrantJobs,
      },
    };
  }
}
