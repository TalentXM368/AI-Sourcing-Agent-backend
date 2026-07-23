import { Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env in local dev (on Vercel, env vars come from the dashboard)
try { config({ path: resolve(__dirname, '../../.env') }) } catch {}

// ─── Database Types (mirrors Prisma schema) ──────────────────

export interface Database {
  candidates: {
    id: string
    name: string
    email: string | null
    phone: string | null
    linkedin_url: string | null
    github_url: string | null
    portfolio_url: string | null
    headline: string | null
    location: string | null
    summary: string | null
    experience_years: number | null
    skills: unknown
    companies: unknown
    work_history: unknown
    education: unknown
    projects: unknown
    certifications: unknown
    languages: unknown
    resume_url: string | null
    raw_text: string | null
    source_file: string | null
    parse_status: string
    parse_error: string | null
    data_quality_score: number | null
    missing_fields: string[] | undefined
    stage: string | undefined
    industry: string | null
    region: string | null
    pdl_id: string | null
    source: string | undefined
    stage_updated_at: Date | null
    created_at: Date
    updated_at: Date
  }
  jobs: {
    id: string
    client_id: string | null
    role: string
    company: string | null
    location: string | null
    required_skills: string[]
    nice_to_have_skills: string[]
    avoid_skills: string[]
    experience_min: number | null
    experience_max: number | null
    description: string | null
    raw_text: string | null
    industry: string | null
    region: string | null
    status: string
    created_at: Date
    updated_at: Date
  }
  clients: {
    id: string
    zoho_account_id: string | null
    account_name: string
    industry: string | null
    location: string | null
    status: string
    urgency: string
    open_roles: number
    placements_ytd: number
    hiring_preferences: unknown
    culture: unknown
    role_context: unknown
    historical_patterns: unknown
    created_at: Date
    updated_at: Date
  }
  embeddings: {
    id: string
    entity_type: string
    entity_id: string
    purpose: string
    vector: number[]
    model: string
    created_at: Date
  }
  ranked_candidates: {
    id: string
    job_id: string
    candidate_id: string
    semantic_score: number
    skill_score: number
    experience_score: number
    education_score: number
    client_fit_score: number
    total_score: number
    exact_matches: string[]
    semantic_matches: string[]
    missing_skills: string[]
    avoid_signals: string[]
    explanation: string | null
    llm_score: number
    llm_verdict: string | null
    llm_reasoning: string | null
    ats_score: number | null
    decision: string
    created_at: Date
  }
}

// ─── Kysely Instance ─────────────────────────────────────────

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  allowExitOnIdle: false,
})

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
})

// ─── Health Check ─────────────────────────────────────────────

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await db.selectFrom('candidates').limit(1).execute()
    return true
  } catch (error) {
    console.error('Database connection failed:', error)
    return false
  }
}
