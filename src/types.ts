// ─── Shared Types ──────────────────────────────────────────────

export interface Skill {
  name: string
  category?: 'language' | 'framework' | 'tool' | 'platform' | 'concept' | 'other'
  proficiency?: string
  weight?: number
}

export interface WorkHistoryEntry {
  title: string
  company: string
  from?: string
  to?: string
  description?: string
  achievements?: string[]
  is_current?: boolean
}

export interface Company {
  name: string
  title?: string
  from?: string
  to?: string
}

export interface Education {
  school: string
  degree?: string
  field?: string
  year?: string
  gpa?: string
}

export interface Project {
  name: string
  description?: string
  tech?: string[]
  url?: string
}

export interface Certification {
  name: string
  issuer?: string
  year?: string
}

export interface Language {
  name: string
  proficiency?: string
}

// ─── Parsed Data ──────────────────────────────────────────────

export interface ParsedCandidate {
  name: string
  email?: string
  phone?: string
  linkedin_url?: string
  github_url?: string
  portfolio_url?: string
  headline?: string
  location?: string
  summary?: string
  experience_years?: number
  skills: Skill[]
  companies: Company[]
  work_history: WorkHistoryEntry[]
  education: Education[]
  projects: Project[]
  certifications: Certification[]
  languages: Language[]
  resume_url?: string
  confidence?: {
    overall: number
    name: number
    contact: number
    skills: number
    experience: number
    education: number
  }
  warnings?: string[]
  parse_source?: 'ai' | 'ai+regex' | 'regex'
}

export interface ParsedJob {
  role: string
  company?: string
  location?: string
  required_skills: string[]
  nice_to_have_skills: string[]
  avoid_skills: string[]
  experience_min?: number
  experience_max?: number
  seniority?: string
  industry?: string
  description?: string
  raw_text: string
}

// ─── Client Context ───────────────────────────────────────────

export interface HiringPreferences {
  seniority?: string
  must_have: string[]
  nice_to_have: string[]
  avoid: string[]
}

export interface Culture {
  values: string[]
  work_style: string
}

export interface RoleContext {
  team_size: number
  reports_to: string
  tech_stack: string[]
}

export interface HistoricalPatterns {
  avg_tenure_years: number
  accepted_profiles: string
  rejected_reasons: string[]
}

export interface ClientContext {
  account_name: string
  industry?: string
  location?: string
  hiring_preferences: HiringPreferences
  culture: Culture
  role_context: RoleContext
  historical_patterns: HistoricalPatterns
}

// ─── Scoring ──────────────────────────────────────────────────

export interface ScoreBreakdown {
  semantic: number
  skill: number
  experience: number
  education: number
  client_fit: number | null
  total: number
}

export interface SkillMatchResult {
  score: number
  exact: string[]
  semantic: string[]
  missing: string[]
}

export interface ClientFitResult {
  score: number
  matchedMust: string[]
  missingMust: string[]
  avoidHits: string[]
}

// ─── API Request/Response ─────────────────────────────────────

export interface WebhookPayload {
  type: 'resume' | 'jd' | 'client'
  url?: string
  data?: ClientContext
  zoho_id?: string
  client_id?: string
}

export interface RankedCandidateResponse {
  id: string
  name: string
  email?: string
  phone?: string
  headline?: string
  location?: string
  summary?: string
  experience_years?: number
  skills: Skill[]
  companies: Company[]
  work_history: WorkHistoryEntry[]
  education: Education[]
  projects: Project[]
  certifications: Certification[]
  languages: Language[]
  decision: string
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
  explanation?: string
}
