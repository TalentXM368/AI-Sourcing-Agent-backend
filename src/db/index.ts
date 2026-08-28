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
    organization_id: string | null
    created_by_id: string | null
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
    so_id: string | null
    coresignal_id: string | null
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
    organization_id: string | null
    created_by_id: string | null
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
    organization_id: string | null
    created_by_id: string | null
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
  ai_evaluations: {
    id: string
    job_id: string
    candidate_id: string
    match_score: number
    display_score: number
    confidence: unknown
    card_summary: string | null
    detail_summary: string | null
    reasoning: unknown
    reranker_score: number | null
    provider: string | null
    version: number
    created_at: Date
  }
  pipeline_runs: {
    id: string
    type: string
    entity_id: string | null
    status: string
    progress: number
    result: unknown
    error: string | null
    started_at: Date | null
    completed_at: Date | null
    created_at: Date
  }
  processing_status: {
    id: string
    entity_type: string
    entity_id: string
    stage: string
    status: string
    progress: number
    message: string | null
    created_at: Date
    updated_at: Date
  }
  search_history: {
    id: string
    organization_id: string | null
    created_by_id: string | null
    source: string
    query: string
    filters: Record<string, unknown>
    result_count: number
    saved_count: number
    candidate_ids: string[]
    created_at: Date
  }
  users: {
    id: string
    first_name: string
    last_name: string
    email: string
    password_hash: string
    onboarding_role: string | null
    status: 'ACTIVE' | 'DISABLED'
    created_at: Date
    updated_at: Date
    last_login_at: Date | null
  }
  organizations: {
    id: string
    name: string
    website: string | null
    industry: string | null
    company_size: string | null
    country: string | null
    logo_url: string | null
    onboarding_completed: boolean
    created_at: Date
    updated_at: Date
  }
  organization_members: {
    id: string
    organization_id: string
    user_id: string
    role: 'OWNER' | 'ADMIN' | 'RECRUITER' | 'HIRING_MANAGER' | 'MEMBER'
    status: 'ACTIVE' | 'INVITED' | 'REMOVED'
    joined_at: Date | null
    created_at: Date
    updated_at: Date
  }
  sessions: {
    id: string
    user_id: string
    token_hash: string
    expires_at: Date
    created_at: Date
    last_used_at: Date | null
  }
  password_reset_tokens: {
    id: string
    user_id: string
    token_hash: string
    expires_at: Date
    used_at: Date | null
    created_at: Date
  }
  organization_invitations: {
    id: string
    organization_id: string
    email: string
    role: 'OWNER' | 'ADMIN' | 'RECRUITER' | 'HIRING_MANAGER' | 'MEMBER'
    token_hash: string
    expires_at: Date
    accepted_at: Date | null
    created_by_id: string
    created_at: Date
  }
}

// ─── Kysely Instance ─────────────────────────────────────────

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 60000,
  connectionTimeoutMillis: 30000,
  statement_timeout: 60000,
  allowExitOnIdle: false,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
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
