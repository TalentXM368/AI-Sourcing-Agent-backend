import type { ParsedCandidate, Skill, Company, Education, Project, WorkHistoryEntry, Certification, Language } from '../types.js'
import { parseResumeWithGPT } from '../services/openai.js'

// ─── Main Parser (Hybrid: AI primary, regex fallback) ─────────

export async function parseResume(text: string): Promise<ParsedCandidate> {
  try {
    const aiResult = await parseResumeWithGPT(text)
    console.log('[Parser] AI resume parsing succeeded')

    if (!isWeakResult(aiResult)) {
      aiResult.work_history = deduplicateWorkHistory(aiResult.work_history)
      aiResult.confidence = computeParseConfidence(aiResult, 'ai')
      aiResult.parse_source = 'ai'
      return aiResult
    }

    console.log('[Parser] AI result is weak, supplementing with regex')
    const regexResult = parseResumeRegex(text)
    const merged = mergeResults(regexResult, aiResult)
    merged.work_history = deduplicateWorkHistory(merged.work_history)
    merged.confidence = computeParseConfidence(merged, 'ai+regex')
    merged.parse_source = 'ai+regex'
    return merged
  } catch (error) {
    console.warn('[Parser] AI parsing failed, falling back to regex:', error)
    const regexResult = parseResumeRegex(text)
    regexResult.work_history = deduplicateWorkHistory(regexResult.work_history)
    regexResult.confidence = computeParseConfidence(regexResult, 'regex')
    regexResult.parse_source = 'regex'
    return regexResult
  }
}

// ─── Confidence Scoring ───────────────────────────────────────

function computeParseConfidence(result: ParsedCandidate, source: 'ai' | 'ai+regex' | 'regex'): NonNullable<ParsedCandidate['confidence']> {
  const name = result.name && result.name !== 'Unknown' ? 1 : 0
  const contact = [result.email, result.phone, result.linkedin_url].filter(Boolean).length / 3
  const skills = Math.min(result.skills.length / 5, 1)
  const experience = result.work_history.length > 0 ? 1 : 0
  const education = result.education.length > 0 ? 1 : 0
  const base = source === 'ai' ? 1 : source === 'ai+regex' ? 0.85 : 0.7
  const overall = ((name + contact + skills + experience + education) / 5) * base
  return { overall: Math.round(overall * 100) / 100, name, contact: Math.round(contact * 100) / 100, skills: Math.round(skills * 100) / 100, experience, education }
}

// ─── Weak Result Detection ────────────────────────────────────
// Returns true if AI output is incomplete and needs regex supplementation

function isWeakResult(r: ParsedCandidate): boolean {
  const hasName = r.name && r.name !== 'Unknown' && r.name.length >= 2
  const hasContact = !!(r.email || r.phone || r.linkedin_url)
  const hasSkills = r.skills.length >= 1
  const hasWork = r.work_history.length >= 1
  const hasEdu = r.education.length >= 1
  const score = [hasContact, hasSkills, hasWork, hasEdu].filter(Boolean).length
  // Only mark as weak if NO name AND very few signals
  return !hasName || score === 0
}

// ─── Merge AI + Regex Results ─────────────────────────────────
// AI is primary, but regex fills in where AI returned empty/null

function mergeResults(regex: ParsedCandidate, ai: ParsedCandidate): ParsedCandidate {
  const usable = (value: string | undefined) => Boolean(value && value.trim() && value.trim().toLowerCase() !== 'unknown')

  return {
    name: usable(ai.name) ? ai.name : regex.name,
    email: ai.email || regex.email,
    phone: ai.phone || regex.phone,
    linkedin_url: ai.linkedin_url || regex.linkedin_url,
    github_url: ai.github_url || regex.github_url,
    portfolio_url: ai.portfolio_url || regex.portfolio_url,
    headline: ai.headline || regex.headline,
    location: ai.location || regex.location,
    summary: ai.summary || regex.summary,
    experience_years: ai.experience_years || regex.experience_years,
    skills: ai.skills.length > 0 ? ai.skills : regex.skills,
    companies: ai.companies.length > 0 ? ai.companies : regex.companies,
    work_history: ai.work_history.length > 0 ? ai.work_history : regex.work_history,
    education: ai.education.length > 0 ? ai.education : regex.education,
    projects: ai.projects.length > 0 ? ai.projects : regex.projects,
    certifications: ai.certifications.length > 0 ? ai.certifications : regex.certifications,
    languages: ai.languages.length > 0 ? ai.languages : regex.languages,
  }
}

// ─── Deduplicate Work History ─────────────────────────────────
// Removes duplicate entries (same company+title) and garbage (Unknown company)

function deduplicateWorkHistory(entries: WorkHistoryEntry[]): WorkHistoryEntry[] {
  if (entries.length <= 1) return entries

  const clean = entries.filter(e =>
    e.company && e.company !== 'Unknown' && e.title && e.title !== 'Unknown'
  )

  const grouped = new Map<string, WorkHistoryEntry[]>()
  for (const entry of clean) {
    const key = `${entry.company.toLowerCase().trim()}|${entry.title.toLowerCase().trim()}`
    const existing = grouped.get(key)
    if (existing) {
      existing.push(entry)
    } else {
      grouped.set(key, [entry])
    }
  }

  const deduped: WorkHistoryEntry[] = []
  for (const group of grouped.values()) {
    if (group.length === 1) {
      deduped.push(group[0])
    } else {
      // Merge: keep longest description, combine unique achievements
      const best = group.reduce((a, b) =>
        (a.description?.length || 0) >= (b.description?.length || 0) ? a : b
      )
      const allAchievements = new Set<string>()
      for (const e of group) {
        for (const ach of e.achievements || []) {
          allAchievements.add(ach)
        }
      }
      deduped.push({
        ...best,
        achievements: Array.from(allAchievements),
      })
    }
  }

  return deduped
}

// ═══════════════════════════════════════════════════════════════
// REGEX-BASED RESUME PARSER
// ═══════════════════════════════════════════════════════════════

// ─── Section Headers (Alias-Based Fuzzy Matching) ────────────

const SECTION_ALIASES: Record<string, string[]> = {
  experience: ['experience', 'employment', 'work history', 'professional experience',
               'work experience', 'career history', 'work background', 'employment history',
               'professional background', 'work exp'],
  education: ['education', 'academic', 'qualification', 'educational background',
              'academics', 'educational qualifications', 'education background'],
  skills: ['skills', 'technical skills', 'competencies', 'technologies', 'tech stack',
           'core competencies', 'proficiencies', 'technical competencies', 'key skills',
           'technical proficiencies', 'skill set'],
  projects: ['projects', 'personal projects', 'key projects', 'portfolio',
             'notable projects', 'side projects', 'academic projects', 'project experience'],
  certifications: ['certifications', 'licenses', 'credentials', 'certificates',
                   'professional certifications', 'licenses & certifications',
                   'certifications & licenses', 'professional development'],
  languages: ['languages', 'linguistic', 'foreign languages', 'language skills'],
  summary: ['summary', 'profile', 'objective', 'about', 'professional summary',
            'career summary', 'career objective', 'professional profile', 'about me',
            'personal statement', 'executive summary'],
  contact: ['contact', 'contact info', 'contact details', 'reach me', 'get in touch'],
  additional: ['additional', 'additional information', 'additional info', 'other',
               'miscellaneous', 'extras', 'extra information'],
  awards: ['awards', 'honors', 'achievements', 'awards & honors', 'recognition',
           'honors & awards', 'achievements & awards'],
  references: ['references', 'recommendations', 'testimonials', 'recommendations'],
}

// ─── Date Patterns ────────────────────────────────────────────

const DATE_PATTERNS = [
  // "Jan 2020 - Present", "January 2020 - Current"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*(?:[-–—]|to)+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current|now)/i,
  // "Jul 2024 – Present", with pipe: "Machine Learning Engineer | ... July 2024 – Present"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*[-–—]\s*(present|current|now)/i,
  // "2020 - Present", "2020 - 2023"
  /(\d{4})\s*(?:[-–—]|to)+\s*(\d{4}|present|current|now)/i,
  // "01/2020 - 06/2023"
  /(\d{1,2}\/\d{4})\s*(?:[-–—]|to)+\s*(\d{1,2}\/\d{4}|present|current|now)/i,
  // "Jun/2024-May/2026" (no spaces)
  /(\w+\/\d{4})\s*[-–—]\s*(\w+\/\d{4}|present|current|now)/i,
  // "2020-Present"
  /(\d{4})\s*[-–]\s*(present|current|now|\d{4})/i,
  // "Jan 2020 to Present"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s+to\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current)/i,
  // European: "15/03/2020 - 20/12/2023"
  /(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[-–—]|to)+\s*(\d{1,2}\/\d{1,2}\/\d{4}|present|current)/i,
  // ISO 8601: "2020-03-15 - 2023-12-20"
  /(\d{4}-\d{2}-\d{2})\s*(?:[-–—]|to)+\s*(\d{4}-\d{2}-\d{2}|present|current)/i,
  // Quarter: "Q1 2022 - Q3 2023"
  /(Q[1-4]\s+\d{4})\s*(?:[-–—]|to)+\s*(Q[1-4]\s+\d{4}|present|current)/i,
  // Full month: "March 2020 - December 2023"
  /((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})\s*(?:[-–—]|to)+\s*((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}|present|current)/i,
  // Pipe-delimited with date at end: "Title | Company, July 2024 – Present"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*[-–—]\s*(present|current|now|\d{4})/i,
  // Standalone: "Jan 2020", "2021"
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})/i,
]

// ─── Common Skill Keywords ────────────────────────────────────

const SKILL_KEYWORDS: Record<string, string> = {
  // Languages
  'javascript': 'language', 'typescript': 'language', 'python': 'language', 'java': 'language',
  'c++': 'language', 'c#': 'language', 'go': 'language', 'rust': 'language', 'ruby': 'language',
  'php': 'language', 'swift': 'language', 'kotlin': 'language', 'scala': 'language',
  'r': 'language', 'matlab': 'language', 'sql': 'language', 'html': 'language', 'css': 'language',
  'sass': 'language', 'scss': 'language', 'less': 'language', 'dart': 'language', 'lua': 'language',
  'haskell': 'language', 'elixir': 'language', 'clojure': 'language', 'f#': 'language',
  'perl': 'language', 'cobol': 'language', 'fortran': 'language', 'assembly': 'language',
  'groovy': 'language', 'powershell': 'language', 'bash': 'language', 'shell': 'language',
  'objective-c': 'language', 'visual basic': 'language', 'vba': 'language',
  // Frameworks
  'react': 'framework', 'vue': 'framework', 'angular': 'framework', 'svelte': 'framework',
  'nextjs': 'framework', 'next.js': 'framework', 'nuxt': 'framework', 'remix': 'framework',
  'astro': 'framework', 'sveltekit': 'framework', 'solidjs': 'framework', 'qwik': 'framework',
  'node.js': 'framework', 'nodejs': 'framework', 'express': 'framework', 'fastify': 'framework',
  'fastapi': 'framework', 'django': 'framework', 'flask': 'framework', 'spring': 'framework',
  'spring boot': 'framework', 'rails': 'framework', 'laravel': 'framework', 'symfony': 'framework',
  'tailwind': 'framework', 'bootstrap': 'framework', 'material-ui': 'framework', 'chakra ui': 'framework',
  'ant design': 'framework', 'shadcn': 'framework', 'styled-components': 'framework',
  'tensorflow': 'framework', 'pytorch': 'framework', 'keras': 'framework', 'scikit-learn': 'framework',
  'pandas': 'framework', 'numpy': 'framework', 'matplotlib': 'framework', 'seaborn': 'framework',
  'plotly': 'framework', 'hugging face': 'framework', 'transformers': 'framework', 'langchain': 'framework',
  'llamaindex': 'framework', 'openai': 'framework', 'cohere': 'framework',
  'dotnet': 'framework', '.net': 'framework', 'asp.net': 'framework', 'blazor': 'framework',
  'xamarin': 'framework', 'maui': 'framework', 'flutter': 'framework', 'react native': 'framework',
  'ionic': 'framework', 'cordova': 'framework', 'electron': 'framework', 'tauri': 'framework',
  // Tools
  'git': 'tool', 'github': 'tool', 'gitlab': 'tool', 'bitbucket': 'tool',
  'jira': 'tool', 'confluence': 'tool', 'slack': 'tool', 'figma': 'tool',
  'notion': 'tool', 'docker': 'tool', 'kubernetes': 'tool', 'k8s': 'tool',
  'terraform': 'tool', 'ansible': 'tool', 'jenkins': 'tool', 'circleci': 'tool',
  'postman': 'tool', 'swagger': 'tool', 'webpack': 'tool', 'vite': 'tool',
  'esbuild': 'tool', 'rollup': 'tool', 'parcel': 'tool', 'bun': 'tool', 'deno': 'tool',
  'grunt': 'tool', 'gulp': 'tool', 'npm': 'tool', 'yarn': 'tool', 'pnpm': 'tool',
  'maven': 'tool', 'gradle': 'tool', 'nuget': 'tool', 'pip': 'tool', 'conda': 'tool',
  'helm': 'tool', 'kustomize': 'tool', 'packer': 'tool', 'vagrant': 'tool',
  'prometheus': 'tool', 'grafana': 'tool', 'datadog': 'tool', 'new relic': 'tool', 'splunk': 'tool',
  'asana': 'tool', 'trello': 'tool', 'monday.com': 'tool',
  'miro': 'tool', 'lucidchart': 'tool', 'draw.io': 'tool',
  'visual studio': 'tool', 'vs code': 'tool', 'intellij': 'tool', 'eclipse': 'tool',
  'vim': 'tool', 'neovim': 'tool', 'emacs': 'tool', 'sublime': 'tool',
  'chrome devtools': 'tool', 'insomnia': 'tool',
  // Platforms
  'aws': 'platform', 'gcp': 'platform', 'azure': 'platform', 'firebase': 'platform',
  'heroku': 'platform', 'vercel': 'platform', 'netlify': 'platform', 'digitalocean': 'platform',
  'linux': 'platform', 'unix': 'platform', 'windows': 'platform', 'macos': 'platform',
  'ios': 'platform', 'android': 'platform', 'chrome os': 'platform', 'wasm': 'platform',
  'cloudflare': 'platform', 'fastly': 'platform', 'akamai': 'platform',
  // Databases
  'postgresql': 'database', 'postgres': 'database', 'mysql': 'database', 'mongodb': 'database',
  'redis': 'database', 'elasticsearch': 'database', 'dynamodb': 'database', 'cassandra': 'database',
  'neo4j': 'database', 'sqlite': 'database', 'mssql': 'database', 'oracle db': 'database',
  'couchdb': 'database', 'influxdb': 'database', 'timescaledb': 'database', 'cockroachdb': 'database',
  'mariadb': 'database', 'firebase firestore': 'database', 'supabase': 'database',
  'prisma': 'database', 'typeorm': 'database', 'sequelize': 'database', 'knex': 'database',
  'graphql': 'database', 'grpc': 'database',
  // Cloud / DevOps Services
  'lambda': 'platform', 'ecs': 'platform', 'eks': 'platform', 'fargate': 'platform',
  's3': 'platform', 'rds': 'platform', 'ec2': 'platform', 'cloudfront': 'platform',
  'route53': 'platform', 'api gateway': 'platform', 'sqs': 'platform', 'sns': 'platform',
  'step functions': 'platform', 'glacier': 'platform', 'athena': 'platform', 'redshift': 'platform',
  'emr': 'platform', 'kinesis': 'platform', 'cloudwatch': 'platform', 'iam': 'platform',
  'secret manager': 'platform', 'codepipeline': 'platform', 'codebuild': 'platform',
  'cloud functions': 'platform', 'cloud run': 'platform', 'app engine': 'platform',
  'bigquery': 'platform', 'dataflow': 'platform', 'pub/sub': 'platform', 'composer': 'platform',
  'kubernetes engine': 'platform', 'container registry': 'platform',
  'azure devops': 'platform', 'azure functions': 'platform', 'azure cosmos': 'platform',
  'azure ml': 'platform', 'azure data lake': 'platform', 'power bi': 'platform',
  // Concepts
  'machine learning': 'concept', 'ml': 'concept', 'ai': 'concept', 'artificial intelligence': 'concept',
  'deep learning': 'concept', 'nlp': 'concept', 'llm': 'concept', 'data science': 'concept',
  'microservices': 'concept', 'rest': 'concept', 'rest api': 'concept',
  'ci/cd': 'concept', 'devops': 'concept', 'agile': 'concept', 'scrum': 'concept',
  'test driven development': 'concept', 'tdd': 'concept', 'oop': 'concept',
  'data structures': 'concept', 'algorithms': 'concept', 'design patterns': 'concept',
  'rag': 'concept', 'vector database': 'concept', 'embedding': 'concept', 'fine-tuning': 'concept',
  'prompt engineering': 'concept', 'agent': 'concept', 'multi-agent': 'concept',
  'infrastructure as code': 'concept', 'containerization': 'concept', 'orchestration': 'concept',
  'serverless': 'concept', 'event-driven': 'concept', 'cqrs': 'concept', 'event sourcing': 'concept',
  'domain driven design': 'concept', 'ddd': 'concept', 'micro frontends': 'concept',
  'monorepo': 'concept', 'polyrepo': 'concept', 'shift left': 'concept',
  'observability': 'concept', 'chaos engineering': 'concept', 'site reliability': 'concept', 'sre': 'concept',
  'zero trust': 'concept', 'oauth': 'concept', 'jwt': 'concept', 'sso': 'concept',
  'mlops': 'concept', 'dataops': 'concept', 'finops': 'concept', 'gitops': 'concept',
  'pair programming': 'concept', 'mob programming': 'concept',
  'lean': 'concept',
  'saas': 'concept', 'paas': 'concept', 'iaas': 'concept',
  'multi-tenancy': 'concept',
  'feature flags': 'concept', 'canary deployment': 'concept', 'blue-green deployment': 'concept',
  // Healthcare
  'hipaa': 'concept', 'ehr': 'tool', 'epic': 'tool', 'cerner': 'tool',
  'patient assessment': 'concept', 'vital signs': 'concept', 'phlebotomy': 'concept',
  'medical terminology': 'concept', 'anatomy': 'concept', 'pharmacology': 'concept',
  'clinical trials': 'concept', 'patient care': 'concept', 'medical records': 'concept',
  'icd-10': 'concept', 'cpt coding': 'concept', 'medical imaging': 'concept',
  'radiology': 'concept', 'sonography': 'concept', 'physical therapy': 'concept',
  'occupational therapy': 'concept', 'speech therapy': 'concept', 'nursing': 'concept',
  'surgery': 'concept', 'emergency medicine': 'concept', 'internal medicine': 'concept',
  'pediatrics': 'concept', 'obstetrics': 'concept', 'cardiology': 'concept',
  'oncology': 'concept', 'neurology': 'concept', 'psychiatry': 'concept',
  'dermatology': 'concept', 'ophthalmology': 'concept', 'anesthesiology': 'concept',
  'pathology': 'concept', 'public health': 'concept', 'epidemiology': 'concept',
  'biostatistics': 'concept', 'health informatics': 'concept',
  'bls': 'concept', 'acls': 'concept', 'pals': 'concept', 'cpr': 'concept',
  'rn': 'concept', 'md': 'concept', 'np': 'concept', 'pa': 'concept',
  'bsn': 'concept', 'msn': 'concept',
  // Finance
  'financial modeling': 'concept', 'valuation': 'concept', 'dcf': 'concept', 'lbo': 'concept',
  'wacc': 'concept', 'ev/ebitda': 'concept', 'risk analysis': 'concept', 'compliance': 'concept',
  'aml': 'concept', 'kyc': 'concept', 'sox': 'concept', 'audit': 'concept',
  'tax accounting': 'concept', 'forensic accounting': 'concept', 'portfolio management': 'concept',
  'asset allocation': 'concept', 'equities': 'concept', 'fixed income': 'concept',
  'derivatives': 'concept', 'options': 'concept', 'futures': 'concept', 'credit analysis': 'concept',
  'underwriting': 'concept', 'actuarial': 'concept',
  'series 7': 'concept', 'series 66': 'concept', 'cfa': 'concept', 'cpa': 'concept',
  'frm': 'concept', 'caia': 'concept',
  'bloomberg terminal': 'tool', 'capital markets': 'concept', 'investment banking': 'concept',
  'wealth management': 'concept', 'hedge fund': 'concept', 'private equity': 'concept',
  'venture capital': 'concept', 'mutual fund': 'concept', 'etf': 'concept',
  'derivatives pricing': 'concept', 'quantitative analysis': 'concept',
  // Creative / Design
  'sketch': 'tool', 'adobe xd': 'tool', 'photoshop': 'tool',
  'illustrator': 'tool', 'indesign': 'tool', 'after effects': 'tool', 'premiere pro': 'tool',
  'lightroom': 'tool', '3ds max': 'tool', 'blender': 'tool', 'cinema 4d': 'tool',
  'maya': 'tool', 'zbrush': 'tool', 'procreate': 'tool', 'canva': 'tool',
  'invision': 'tool', 'marvel': 'tool', 'zeplin': 'tool', 'balsamiq': 'tool',
  'axure': 'tool', 'principle': 'tool', 'framer': 'tool', 'origami': 'tool',
  'proto.io': 'tool', 'user research': 'concept', 'wireframing': 'concept',
  'prototyping': 'concept', 'design systems': 'concept', 'typography': 'concept',
  'color theory': 'concept', 'ui/ux': 'concept', 'motion graphics': 'concept',
  'brand identity': 'concept', 'graphic design': 'concept', 'video editing': 'concept',
  '3d modeling': 'concept', 'animation': 'concept', 'storyboarding': 'concept',
  // Engineering / Manufacturing
  'autocad': 'tool', 'solidworks': 'tool', 'catia': 'tool', 'nx': 'tool',
  'creo': 'tool', 'inventor': 'tool', 'simulink': 'tool', 'ansys': 'tool',
  'solid edge': 'tool', 'fusion 360': 'tool', 'revit': 'tool', 'archicad': 'tool',
  'six sigma': 'concept', 'lean manufacturing': 'concept',
  'iso 9001': 'concept', 'iso 14001': 'concept', 'iso 45001': 'concept',
  'gd&t': 'concept', 'cnc': 'tool', 'plc': 'tool', 'scada': 'tool', 'labview': 'tool',
  'quality assurance': 'concept', 'root cause analysis': 'concept', 'fmea': 'concept',
  'apqp': 'concept', 'ppap': 'concept', 'spc': 'concept', 'msa': 'concept',
  '8d': 'concept', 'kaizen': 'concept', '5s': 'concept', 'kanban': 'concept',
  'oee': 'concept', 'mtbf': 'concept', 'reliability engineering': 'concept',
  'value engineering': 'concept', 'tolerance stackup': 'concept', 'fatigue analysis': 'concept',
  // Sales / Marketing
  'salesforce': 'tool', 'hubspot': 'tool', 'marketo': 'tool', 'pardot': 'tool',
  'google analytics': 'tool', 'google ads': 'tool', 'facebook ads': 'tool', 'linkedin ads': 'tool',
  'seo': 'concept', 'sem': 'concept', 'ppc': 'concept', 'email marketing': 'concept',
  'content marketing': 'concept', 'social media marketing': 'concept',
  'inbound marketing': 'concept', 'outbound marketing': 'concept',
  'ab testing': 'concept', 'conversion rate optimization': 'concept',
  'lead generation': 'concept', 'pipeline management': 'concept',
  'crm': 'tool', 'account based marketing': 'concept', 'customer success': 'concept',
  'customer retention': 'concept', 'churn reduction': 'concept',
  'marketing automation': 'concept', 'copywriting': 'concept', 'growth hacking': 'concept',
  // Soft Skills / Methodology
  'stakeholder management': 'concept', 'cross-functional leadership': 'concept',
  'mentoring': 'concept', 'public speaking': 'concept', 'technical writing': 'concept',
  'requirements gathering': 'concept', 'user stories': 'concept', 'sprint planning': 'concept',
  'product roadmaps': 'concept', 'go-to-market': 'concept', 'competitive analysis': 'concept',
  'market research': 'concept', 'okr': 'concept', 'kpi': 'concept',
  'data-driven': 'concept', 'strategic planning': 'concept', 'vendor management': 'concept',
  'budget management': 'concept', 'p&l': 'concept', 'change management': 'concept',
  'risk management': 'concept', 'business analysis': 'concept', 'process improvement': 'concept',
  'project management': 'concept', 'program management': 'concept', 'product management': 'concept',
  'pmp': 'concept', 'prince2': 'concept', 'itil': 'concept', 'cobit': 'concept',
}

// ─── Education Keywords ───────────────────────────────────────

// Institution keywords (traditional + bootcamps + online platforms)
const SCHOOL_KEYWORDS = [
  'university', 'college', 'institute', 'school', 'academy', 'polytechnic',
  'iit', 'nit', 'iiit', 'bits', 'vit', 'amity', 'anna', 'mumbai', 'delhi',
  'bangalore', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad',
  'diploma', 'class x', 'class xi', 'class xii', 'cbse', 'icse',
  // Bootcamps
  'bootcamp', 'codecamp', 'code academy', 'general assembly', 'le wagon',
  'springboard', 'flatiron', 'app academy', 'hack reactor', 'devmountain',
  'thinkful', 'nucamp', 'ironhack', '42', 'epicodus', 'techtonic',
  // Online platforms
  'coursera', 'udemy', 'edx', 'udacity', 'pluralsight', 'linkedin learning',
  'codecademy', 'khan academy', 'nanodegree', 'datacamp', 'treehouse',
  'skillshare', 'brilliant', 'freecodecamp',
]

// Degree keywords that can appear in education lines (separate from school keywords)
const DEGREE_KEYWORDS = [
  'b.tech', 'm.tech', 'bachelor', 'master', 'phd', 'mba', 'bca', 'mca',
  'bsc', 'msc', 'be ', 'me ', 'b.e.', 'm.e.', 'b.s.', 'm.s.',
  'associate', 'diploma', 'certificate', 'professional certificate',
  'nanodegree', 'specialization', 'executive', 'fellowship', 'doctorate',
  'bachelor of', 'master of', 'ph.d', 'postgraduate', 'undergraduate',
]

// ─── Name Patterns ────────────────────────────────────────────

// Build section header words from aliases (for use in headline/location detection)
const SECTION_HEADER_WORDS = new Set<string>()
for (const aliases of Object.values(SECTION_ALIASES)) {
  for (const alias of aliases) {
    SECTION_HEADER_WORDS.add(alias)
  }
}

// ─── Main Regex Parser ────────────────────────────────────────

export function parseResumeRegex(text: string): ParsedCandidate {
  // Fix no-space text: insert spaces at camelCase boundaries
  const fixedText = fixNoSpaceText(text)
  const lines = fixedText.split('\n').map(l => l.trim()).filter(Boolean)
  const sections = detectSections(lines)

  // Skills: prefer explicit skills section, limit to that + contextual
  const skillsSection = sections.find(s => s.type === 'skills')
  const skillsText = skillsSection ? skillsSection.lines.join(' ') : fixedText
  const keywordSkills = extractSkills(skillsText)
  const contextualSkills = extractContextualSkills(fixedText)
  const skillMap = new Map<string, Skill>()
  for (const s of [...keywordSkills, ...contextualSkills]) {
    if (!skillMap.has(s.name)) skillMap.set(s.name, s)
  }

  return {
    name: extractName(lines),
    email: extractEmail(fixedText),
    phone: extractPhone(fixedText),
    linkedin_url: extractLinkedin(fixedText),
    github_url: extractGithub(fixedText),
    portfolio_url: extractPortfolio(fixedText),
    headline: extractHeadline(lines),
    location: extractLocation(lines),
    summary: extractSummary(sections, lines),
    experience_years: extractExperienceYears(sections, fixedText),
    skills: Array.from(skillMap.values()).slice(0, 30),
    companies: extractCompaniesFromWork(sections),
    work_history: extractWorkHistory(sections),
    education: extractEducation(sections),
    projects: extractProjects(sections),
    certifications: extractCertifications(sections),
    languages: extractLanguages(sections),
  }
}

// ─── Fix No-Space Text ────────────────────────────────────────
// pdftext sometimes produces text with no spaces: "PROFESSIONALEXPERIENCE"
// This inserts spaces at camelCase/allcaps boundaries to restore readability

function fixNoSpaceText(text: string): string {
  return text.split('\n').map(line => {
    // Clean tabs first
    let cleaned = line.replace(/\t+/g, ' ').replace(/\s{3,}/g, '  ').trim()
    // Skip lines that are already spaced (normal)
    if (/\s{2,}/.test(cleaned) || cleaned.split(' ').length > 3) return cleaned
    // Skip short lines (likely normal)
    if (cleaned.length < 15) return cleaned
    // Fix ALLCAPS concatenated words: "PROFESSIONALEXPERIENCE" → "PROFESSIONAL EXPERIENCE"
    let fixed = cleaned.replace(/([A-Z]{3,})([A-Z][a-z])/g, '$1 $2')
    // Fix camelCase: "ProfessionalExperience" → "Professional Experience"
    fixed = fixed.replace(/([a-z])([A-Z])/g, '$1 $2')
    // Fix numbers attached to letters but not inside dates: "AccentureJun/2024" → "Accenture Jun/2024"
    // Don't break slash-separated dates like Jun/2024
    fixed = fixed.replace(/([a-zA-Z])(\d{4})/g, (match, letter, year, offset) => {
      // Check if there's a slash nearby (date pattern) — don't break those
      const after = fixed.slice(offset + match.length, offset + match.length + 5)
      if (/^\//.test(after)) return match
      return letter + ' ' + year
    })
    fixed = fixed.replace(/(\d)([A-Za-z](?:\d|[A-Za-z]))/g, (match, digit, rest, offset) => {
      const before = fixed.slice(Math.max(0, offset - 5), offset)
      if (/\/$/.test(before)) return match
      return digit + ' ' + rest
    })
    return fixed
  }).join('\n')
}

// ─── Section Detection ────────────────────────────────────────

interface Section {
  type: string
  startLine: number
  endLine: number
  lines: string[]
}

function detectSections(lines: string[]): Section[] {
  const sections: Section[] = []
  let currentSection: Section | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const normalized = line.toLowerCase().replace(/[^a-z\s]/g, '').trim()

    let matchedType = matchSectionType(normalized)
    let handledInline = false

    // If no match on the full line, try splitting on double spaces
    if (!matchedType && line.length > 60) {
      const segments = line.split(/\s{2,}/)
      for (const seg of segments) {
        const segNorm = seg.toLowerCase().replace(/[^a-z\s]/g, '').trim()
        if (segNorm.length > 40) continue
        if (segNorm.length < 5) continue
        const segType = matchSectionType(segNorm)
        if (segType && matchSectionScore(segNorm) >= 0.8) {
          const headerIdx = line.indexOf(seg)
          const afterHeader = line.substring(headerIdx + seg.length).trim()
          if (currentSection && headerIdx > 0) {
            const beforeHeader = line.substring(0, headerIdx).trim()
            if (beforeHeader.length > 0) {
              currentSection.lines.push(beforeHeader)
            }
          }
          if (currentSection) {
            currentSection.endLine = i - 1
            sections.push(currentSection)
          }
          currentSection = {
            type: segType,
            startLine: i + 1,
            endLine: lines.length - 1,
            lines: afterHeader.length > 0 ? [afterHeader] : [],
          }
          handledInline = true
          break
        }
      }
    }

    if (handledInline) continue

    if (matchedType) {
      if (currentSection) {
        currentSection.endLine = i - 1
        sections.push(currentSection)
      }
      currentSection = {
        type: matchedType,
        startLine: i + 1,
        endLine: lines.length - 1,
        lines: [],
      }
    } else if (currentSection) {
      currentSection.lines.push(line)
    }
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return sections
}

function matchSectionType(normalized: string): string | null {
  // Section headers are short — skip long content lines
  if (normalized.length > 60) return null

  let bestType: string | null = null
  let bestScore = 0

  for (const [type, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      let score = 0
      if (normalized === alias) {
        score = 1.0
      } else if (normalized.includes(alias)) {
        score = 0.8
      } else {
        // Check word overlap
        const aliasWords = alias.split(/\s+/)
        const lineWords = normalized.split(/\s+/)
        const overlap = aliasWords.filter(w => lineWords.includes(w)).length
        if (overlap > 0) {
          score = (overlap / aliasWords.length) * 0.6
        }

        // Also check concatenated alias: "professional experience" → "professionalexperience"
        if (score === 0) {
          const concatAlias = alias.replace(/\s+/g, '')
          if (normalized === concatAlias) {
            score = 0.95
          } else if (normalized.length > concatAlias.length * 0.6 && normalized.includes(concatAlias.slice(0, Math.floor(concatAlias.length * 0.5)))) {
            score = 0.5
          }
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestType = type
      }
    }
  }

    return bestScore >= 0.6 ? bestType : null
}

function matchSectionScore(normalized: string): number {
  let bestScore = 0
  for (const [type, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      let score = 0
      if (normalized === alias) {
        score = 1.0
      } else if (normalized.includes(alias)) {
        score = 0.8
      } else {
        const aliasWords = alias.split(/\s+/)
        const lineWords = normalized.split(/\s+/)
        const overlap = aliasWords.filter(w => lineWords.includes(w)).length
        if (overlap > 0) {
          score = (overlap / aliasWords.length) * 0.6
        }
      }
      if (score > bestScore) bestScore = score
    }
  }
  return bestScore
}

// ─── Name Extraction ──────────────────────────────────────────

function collapseSpacedLetters(text: string): string {
  const tokens = text.split(/\s+/)
  const allSingle = tokens.length >= 3 && tokens.every(t => t.length === 1)
  if (allSingle) return tokens.join('')
  return text
}

function extractName(lines: string[]): string {
  // Skip common non-name patterns
  const skipPatterns = [
    /@/, /resume/i, /cv/i, /curriculum/i, /phone/i, /email/i, /address/i,
    /linkedin/i, /github/i, /portfolio/i, /http/i, /www\./i,
    /^\d+/, /^\(/,
    /objective/i, /summary/i, /profile/i,
    /location\s/i, /experience\s*history/i, /professional\s*summary/i, /certifications/i,
  ]

  // Build regex patterns once
  const skipRegexes = skipPatterns

  for (const rawLine of lines.slice(0, 8)) {
    if (rawLine.length < 2) continue

    // For long lines (name + phone on same line), split at tab/3+ spaces first
    const line = rawLine.length > 60 || /\t/.test(rawLine)
      ? (rawLine.split(/\t{1,}/)[0] || rawLine.split(/\s{3,}/)[0] || rawLine).trim()
      : rawLine

    if (line.length < 2 || line.length > 60) continue

    const lowerLine = line.toLowerCase().trim()

    // Check skip patterns
    if (skipRegexes.some(p => p.test(line))) continue
    if (SECTION_HEADER_WORDS.has(lowerLine.replace(/[^a-z\s]/g, '').trim())) continue

    // Skip lines that look like section headers or dates
    if (/^(experience|education|skills|projects|certifications|summary|profile|objective|work\s*history|languages|references)/i.test(lowerLine)) continue
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(line)) continue

    // Clean the name: remove non-alpha, hyphens, dots, leading underscores
    const cleaned = line.replace(/[^a-zA-Z\s\-\.]/g, '').replace(/^[\s\._-]+/, '').trim()
    if (cleaned.length < 2) continue

    // Strip file extensions that leaked through: "Shashidhar.pdf" → "Shashidhar"
    const strippedExt = cleaned.replace(/\.(?:pdf|docx?|txt)$/i, '').trim()
    if (strippedExt.length >= 2) {
      // Handle spaced-out letters
      const collapsed = collapseSpacedLetters(strippedExt)
      if (collapsed.split(/\s/).length <= 5) return collapsed
    }

    // Normal name: 2-5 words
    if (cleaned.split(/\s/).length <= 5) {
      return cleaned
    }
  }
  return 'Unknown'
}

// ─── Contact Extraction ───────────────────────────────────────

function extractEmail(text: string): string | undefined {
  const match = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  return match?.[0]
}

function extractPhone(text: string): string | undefined {
  // Match various phone formats
  const patterns = [
    /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\+?\d{10,12}/,
    /\d{3}[-.\s]\d{3}[-.\s]\d{4}/,
  ]
  for (const p of patterns) {
    const match = text.match(p)
    if (match) return match[0].trim()
  }
  return undefined
}

function extractLinkedin(text: string): string | undefined {
  // Allow dots, underscores, plus signs in usernames; optional trailing paths
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_.+]+(?:\/[a-zA-Z0-9\-_.]+)*/i)
  return match?.[0]
}

function extractGithub(text: string): string | undefined {
  // Allow dots, underscores; support /user/repo paths
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9\-_.]+(?:\/[a-zA-Z0-9\-_.]+)*/i)
  return match?.[0]
}

function extractPortfolio(text: string): string | undefined {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.(?:com|dev|io|net|org)(?:\/[^\s]*)?/i)
  if (match && !match[0].includes('linkedin') && !match[0].includes('github')) {
    return match[0]
  }
  return undefined
}

// ─── Headline Extraction ──────────────────────────────────────

function extractHeadline(lines: string[]): string | undefined {
  const titleKeywords = [
    'engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior',
    'staff', 'principal', 'director', 'analyst', 'consultant', 'specialist',
    'scientist', 'intern', 'associate', 'coordinator', 'supervisor',
    'full stack', 'frontend', 'backend', 'devops', 'software',
    'cloud', 'platform', 'systems', 'network', 'security', 'qa', 'test',
  ]

  // Words that indicate this is NOT a job title
  const notTitleWords = [
    'university', 'college', 'institute', 'school', 'academy',
    'bachelor', 'master', 'phd', 'mba', 'b.tech', 'm.tech',
    'computer science', 'engineering', 'information technology',
    'skills', 'experience', 'education', 'summary', 'projects',
    'programming', 'languages', 'frameworks', 'tools', 'platforms',
    'data', 'sql', 'python', 'java', 'javascript', 'react', 'angular',
    'dynamic', 'greedy', 'algorithms', 'linear',
  ]

  // Only look at lines before any section header
  const firstSectionIdx = lines.findIndex(l => {
    const lower = l.toLowerCase().replace(/[^a-z\s]/g, '').trim()
    return SECTION_HEADER_WORDS.has(lower)
  })
  const searchLimit = firstSectionIdx > 0 ? Math.min(firstSectionIdx, 10) : 10

  for (const line of lines.slice(1, searchLimit)) {
    if (line.length < 5 || line.length > 60) continue
    const lower = line.toLowerCase().trim()
    
    // Skip if it matches NOT title words
    if (notTitleWords.some(kw => lower.includes(kw))) continue
    
    // Skip if it's clearly a section header
    if (SECTION_HEADER_WORDS.has(lower.replace(/[^a-z\s]/g, '').trim())) continue
    
    // Skip if it looks like an email, phone, or URL
    if (lower.includes('@') || lower.includes('http') || /^\d{10}/.test(lower)) continue
    
    // Skip if it has too many commas (likely a list, not a title)
    if ((line.match(/,/g) || []).length > 1) continue
    
    // Skip if it contains common non-title patterns
    if (/\b(or|and|the|for|with|in|at|of)\b/i.test(lower) && !lower.includes(' and ')) continue
    
    if (titleKeywords.some(kw => lower.includes(kw))) {
      return line.trim()
    }
  }
  return undefined
}

// ─── Location Extraction ──────────────────────────────────────

function extractLocation(lines: string[]): string | undefined {
  // Known locations that should be recognized
  const knownLocations = new Set([
    'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'chennai', 'pune',
    'kolkata', 'ahmedabad', 'jaipur', 'lucknow', 'indore', 'nagpur', 'surat',
    'san francisco', 'new york', 'los angeles', 'chicago', 'seattle', 'boston',
    'london', 'berlin', 'toronto', 'singapore', 'dubai', 'sydney', 'melbourne',
    'remote', 'on-site', 'on site', 'hybrid',
    'california', 'texas', 'washington', 'massachusetts', 'michigan',
    'usa', 'india', 'uk', 'canada', 'germany', 'australia',
    'kerala', 'karnataka', 'tamil nadu', 'maharashtra', 'rajasthan',
    'andhra pradesh', 'telangana', 'uttar pradesh', 'madhya pradesh',
  ])

  // Only look at lines in the header section (before any section header)
  const firstSectionIdx = lines.findIndex(l => {
    const lower = l.toLowerCase().replace(/[^a-z\s]/g, '').trim()
    return SECTION_HEADER_WORDS.has(lower)
  })
  const searchLimit = firstSectionIdx > 0 ? Math.min(firstSectionIdx, 15) : 15

  // First pass: look for lines that contain known location keywords
  for (const line of lines.slice(0, searchLimit)) {
    const lower = line.toLowerCase().trim()
    
    // Check if line contains a known location
    const hasKnownLocation = Array.from(knownLocations).some(loc => lower.includes(loc))
    if (hasKnownLocation) {
      // For "Remote" or single-word locations, return as-is
      if (['remote', 'on-site', 'on site', 'hybrid'].includes(lower)) {
        return line.trim()
      }
      
      // For "City, State" patterns, extract just that part
      const cityStateMatch = line.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\b/)
      if (cityStateMatch && cityStateMatch[0].length < 50) {
        return cityStateMatch[0].trim()
      }
      
      // Return the line if it's short enough (likely just the location)
      if (line.length < 40) {
        return line.trim()
      }
    }
  }
  
  return undefined
}

// ─── Summary Extraction ───────────────────────────────────────

function extractSummary(sections: Section[], lines: string[]): string | undefined {
  // Look for summary section
  const summarySection = sections.find(s => s.type === 'summary')
  if (summarySection && summarySection.lines.length > 0) {
    return summarySection.lines.join(' ').trim()
  }

  // Fallback: look for text after "summary" header in first 20 lines
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/^(?:summary|profile|objective|about)/i.test(lines[i])) {
      const summaryLines = lines.slice(i + 1, i + 5).filter(l => l.length > 10)
      if (summaryLines.length > 0) {
        return summaryLines.join(' ').trim()
      }
    }
  }

  return undefined
}

// ─── Experience Years Extraction ──────────────────────────────

function extractExperienceYears(sections: Section[], text: string): number | undefined {
  // First try explicit mentions
  const explicitPatterns = [
    /(\d+)[\s\+]*(?:years?|yrs?)\s*(?:of)?\s*(?:experience|exp)/i,
    /experience[:\s]*(\d+[\s\-to]+\d+)\s*years?/i,
    /(\d+)[\s\-to]+(\d+)\s*years?(?:\s+of)?\s*(?:experience|exp)/i,
  ]

  for (const pattern of explicitPatterns) {
    const match = text.match(pattern)
    if (match) {
      if (match[2]) return Math.round((parseInt(match[1]) + parseInt(match[2])) / 2)
      return parseInt(match[1])
    }
  }

  // Calculate from work history dates
  const expSection = sections.find(s => s.type === 'experience')
  if (expSection) {
    const years = extractYearsFromDates(expSection.lines.join(' '))
    if (years !== null) return years
  }

  return undefined
}

function extractYearsFromDates(text: string): number | null {
  const dates: Date[] = []

  // Find all date ranges
  for (const pattern of DATE_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern.source, 'gi'))
    for (const match of matches) {
      const start = parseDate(match[1])
      const end = match[2]?.toLowerCase().includes('present') ? new Date() : parseDate(match[2])
      if (start) dates.push(start)
      if (end) dates.push(end)
    }
  }

  if (dates.length >= 2) {
    const earliest = new Date(Math.min(...dates.map(d => d.getTime())))
    const latest = new Date(Math.max(...dates.map(d => d.getTime())))
    const years = (latest.getTime() - earliest.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    return Math.round(years)
  }

  return null
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const lower = dateStr.toLowerCase()

  if (lower.includes('present') || lower.includes('current') || lower.includes('now')) {
    return new Date()
  }

  // "Jan 2020" or "January 2020"
  const monthMatch = lower.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{4})/)
  if (monthMatch) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const month = months.indexOf(monthMatch[1].slice(0, 3))
    return new Date(parseInt(monthMatch[2]), month, 1)
  }

  // ISO 8601: "2020-03-15"
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]))
  }

  // European DD/MM/YYYY or MM/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (slashMatch) {
    const a = parseInt(slashMatch[1]), b = parseInt(slashMatch[2]), year = parseInt(slashMatch[3])
    // If first part > 12, it's DD/MM/YYYY; otherwise MM/DD/YYYY
    if (a > 12) return new Date(year, b - 1, a)
    return new Date(year, a - 1, b)
  }

  // "01/2020" (MM/YYYY)
  const mmYyyyMatch = dateStr.match(/(\d{1,2})\/(\d{4})/)
  if (mmYyyyMatch) {
    const month = parseInt(mmYyyyMatch[1]) - 1
    return new Date(parseInt(mmYyyyMatch[2]), month, 1)
  }

  // "Q1 2022"
  const quarterMatch = dateStr.match(/q([1-4])\s+(\d{4})/)
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1])
    return new Date(parseInt(quarterMatch[2]), (quarter - 1) * 3, 1)
  }

  // Bare year: "2020"
  const yearMatch = dateStr.match(/(\d{4})/)
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1)
  }

  return null
}

// ─── Skills Extraction ────────────────────────────────────────

function extractSkills(text: string): Skill[] {
  const found: Map<string, string> = new Map()
  const lower = text.toLowerCase()

  for (const [skill, category] of Object.entries(SKILL_KEYWORDS)) {
    // Use word boundary matching for short skills
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = skill.length <= 3
      ? new RegExp(`\\b${escaped}\\b`, 'i')
      : new RegExp(escaped, 'i')

    if (regex.test(lower)) {
      found.set(skill, category)
    }
  }

  return Array.from(found.entries()).map(([name, category]) => ({ name, category: category as Skill['category'] }))
}

// ─── Contextual Skill Extraction ──────────────────────────────
// Extracts skills mentioned in phrases like "used Kubernetes and Terraform"

// Generic terms that should NOT be extracted from full-text context
const GENERIC_SKILLS = new Set([
  'ml', 'ai', 'rest', 'microservices', 'ci/cd', 'oop', 'agile', 'scrum',
  'devops', 'machine learning', 'deep learning', 'nlp', 'llm', 'data science',
  'data structures', 'algorithms', 'design patterns', 'test driven development',
  'tdd', 'lean', 'saas', 'paas', 'iaas', 'multi-tenancy',
])

function extractContextualSkills(text: string): Skill[] {
  const contextPatterns = [
    /(?:used|experience with|proficient in|skilled in|knowledge of|familiar with|hands-on experience with|expertise in|working with|background in)\s+([\w\s,\/+#.]+?)(?:\.|,|\n|$)/gi,
    /(?:technologies?|tools?|stack|languages?)[:\s]+([\w\s,\/+#.]+?)(?:\.|,|\n|$)/gi,
  ]
  const found: Map<string, string> = new Map()
  for (const pattern of contextPatterns) {
    for (const match of text.matchAll(pattern)) {
      const parts = match[1].split(/[,\/&]/).map(s => s.trim().toLowerCase())
      for (const part of parts) {
        // Skip generic/abstract terms
        if (GENERIC_SKILLS.has(part)) continue
        for (const [skill, category] of Object.entries(SKILL_KEYWORDS)) {
          if (part.includes(skill) && !found.has(skill) && !GENERIC_SKILLS.has(skill)) {
            found.set(skill, category)
          }
        }
      }
    }
  }
  return Array.from(found.entries()).map(([name, category]) => ({ name, category: category as Skill['category'] }))
}

// ─── Work History Extraction ──────────────────────────────────

function isLikelyTitle(text: string): boolean {
  const titleKeywords = ['engineer', 'developer', 'manager', 'lead', 'scientist', 'analyst',
    'architect', 'specialist', 'consultant', 'director', 'senior', 'junior', 'staff',
    'principal', 'coordinator', 'supervisor', 'intern', 'associate', 'researcher']
  const lower = text.toLowerCase()
  return titleKeywords.some(kw => lower.includes(kw))
}

function extractWorkHistory(sections: Section[]): WorkHistoryEntry[] {
  const expSection = sections.find(s => s.type === 'experience')
  if (!expSection) return []

  const entries: WorkHistoryEntry[] = []
  let current: Partial<WorkHistoryEntry> | null = null

  for (let i = 0; i < expSection.lines.length; i++) {
    const line = expSection.lines[i]
    let hasDateRange = false
    let from: string | undefined
    let to: string | undefined

    for (const pattern of DATE_PATTERNS) {
      const match = line.match(pattern)
      if (match) {
        hasDateRange = true
        from = match[1]
        to = match[2] || 'Present'
        break
      }
    }

    if (hasDateRange) {
      // Save previous entry
      if (current?.title && current?.company && current.company !== 'Unknown') {
        entries.push(current as WorkHistoryEntry)
      }

      const { title, company } = extractTitleCompany(line)

      // If no company on date line, peek at next lines to find company + title
      let companyFromNext = company
      let titleFromNext: string | undefined
      
      // If the extracted "title" doesn't look like a job title, it's likely a company name
      let titleIsActuallyCompany = title && !isLikelyTitle(title) && title.length > 1
      
      if (!companyFromNext || companyFromNext.length < 3) {
        // Try next 2 lines to find company and title
        for (let j = i + 1; j < Math.min(i + 3, expSection.lines.length); j++) {
          const nextLine = expSection.lines[j].trim()
          if (nextLine.length < 2 || nextLine.length > 100) continue
          const nextHasDate = DATE_PATTERNS.some(p => p.test(nextLine))
          if (nextHasDate) break
          
          // Use extractTitleCompany on the next line to check if it has both title and company
          const nextResult = extractTitleCompany(nextLine)
          if (nextResult.company && nextResult.company.length > 2 && !isLikelyTitle(nextResult.company)) {
            // Found a line with company info - use it
            companyFromNext = nextResult.company
            if (nextResult.title) titleFromNext = nextResult.title
            i = j
            break
          } else if (!companyFromNext || companyFromNext.length < 3) {
            const cleaned = cleanCompanyName(nextLine)
            if (cleaned.length > 2 && !isLikelyTitle(nextLine)) {
              companyFromNext = cleaned
              i = j
              break
            } else if (isLikelyTitle(nextLine) && !title) {
              titleFromNext = nextLine
            }
          }
        }
      } else {
        companyFromNext = cleanCompanyName(companyFromNext)
      }
      
      // If the "title" is actually a company name, swap roles
      if (titleIsActuallyCompany && (!companyFromNext || companyFromNext === 'Unknown')) {
        companyFromNext = title
        // Try to get real title from next line
        if (i + 1 < expSection.lines.length) {
          const nextLine = expSection.lines[i + 1].trim()
          if (nextLine.length > 2 && isLikelyTitle(nextLine) && !DATE_PATTERNS.some(p => p.test(nextLine))) {
            titleFromNext = nextLine
            i++
          }
        }
      }

      current = {
        title: titleFromNext || title || 'Unknown',
        company: companyFromNext || 'Unknown',
        from,
        to: to?.includes('present') || to?.includes('current') || to?.includes('now') ? 'Present' : to,
        description: '',
        achievements: [],
        is_current: to?.toLowerCase().includes('present') || to?.toLowerCase().includes('current') || to?.toLowerCase().includes('now'),
      }
    } else if (current) {
      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('▸') || line.startsWith('▪')) {
        current.achievements!.push(line.replace(/^[•\-▸▪]\s*/, ''))
      } else if (line.length > 15 && !current.description) {
        current.description = line
      } else if (line.length > 15) {
        current.description = (current.description || '') + ' ' + line
      }
    }
  }

  if (current?.title && current?.company && current.company !== 'Unknown') {
    entries.push(current as WorkHistoryEntry)
  }

  return entries.slice(0, 10)
}

function isLocation(text: string): boolean {
  const t = text.trim().toLowerCase()
  // US state abbreviations
  if (/^[A-Z]{2}$/.test(text.trim())) return true
  // Known countries
  const countries = ['usa', 'india', 'uk', 'canada', 'germany', 'australia', 'singapore', 'japan', 'china', 'dubai', 'remote']
  if (countries.includes(t)) return true
  // Known cities
  const cities = ['bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'chennai', 'pune',
    'kolkata', 'ahmedabad', 'jaipur', 'lucknow', 'san francisco', 'new york', 'los angeles',
    'chicago', 'seattle', 'boston', 'london', 'berlin', 'toronto', 'singapore', 'dubai',
    'sydney', 'melbourne', 'raleigh', 'durham', 'austin', 'dallas', 'houston', 'seattle',
    'portland', 'denver', 'miami', 'atlanta', 'nashville', 'pittsburgh', 'columbus',
    'indianapolis', 'detroit', 'minneapolis', 'baltimore', 'tampa', 'orlando', 'jacksonville',
    'cleveland', 'cincinnati', 'boise', 'reno', 'tacoma', 'phoenix', 'tucson', 'charlotte']
  if (cities.includes(t)) return true
  // "City, State" patterns
  if (/^.+,\s*[A-Z]{2}$/.test(text.trim())) return true
  return false
}

function cleanCompanyName(name: string): string {
  if (!name) return name
  let cleaned = name
    .replace(/\s+/g, ' ')
    .replace(/[\t]/g, ' ')
    .trim()
  
  // Remove pipe and everything after: "Costco Wholesale |" → "Costco Wholesale"
  cleaned = cleaned.replace(/\s*\|.*$/, '').trim()
  
  // Remove trailing location patterns: "Remote, NY" / "USA" / "India" / "San Jose, CA"
  cleaned = cleaned.replace(/\s*,?\s*(?:Remote|Remote,\s*\w+|USA|India|UK|Canada|Germany|Australia|Singapore|Japan|China|Dubai|Hyderabad|Bangalore|Noida|Gurgaon|Pune|Mumbai|Chennai|Delhi|San\s*Jose|San\s*Francisco|New\s*York|Los\s*Angeles|Seattle|Chicago|Boston|Austin|Dallas|Houston|Atlanta|Denver|Miami|Portland|Raleigh|Durham|Charlotte|Phoenix|Tucson|Detroit|Minneapolis|Pittsburgh|Columbus|Indianapolis|Nashville|Memphis|Louisville|Milwaukee|Baltimore|New\s*Orleans|Oklahoma\s*City|Kansas\s*City|Salt\s*Lake\s*City|Las\s*Vegas|Honolulu|Tampa|Orlando|Jacksonville|Cleveland|Cincinnati|St\.\s*Louis|Virginia\s*Beach|Norfolk|Boise|Reno|Spokane|Tacoma|Salem|Eugene|Anchorage|Fairbanks|Honolulu)\s*$/i, '').trim()
  
  // Remove state abbreviations at end: "PA" / "NY" / "CA" / "TX" etc.
  cleaned = cleaned.replace(/\s+[A-Z]{2}$/, '').trim()
  
  // Remove ", Country" or just country names
  cleaned = cleaned.replace(/\s*,?\s*(?:United States|U\.S\.A?\.?)\s*$/i, '').trim()
  
  // Remove " | title" patterns at end
  cleaned = cleaned.replace(/\s*\|\s*(?:AI|ML|Software|Data|Cloud|DevOps|Full.?Stack|Backend|Frontend|Senior|Junior|Lead|Principal|Staff|Director|Manager|Engineer|Developer|Architect|Scientist|Analyst|Consultant|Specialist).*$/i, '').trim()
  
  // If what's left is too short (just a location), return empty
  if (cleaned.length < 2) return name.trim()
  
  return cleaned
}

function extractTitleCompany(line: string): { title: string | null; company: string | null } {
  // Strip dates from line first
  let cleanLine = line
  for (const dp of DATE_PATTERNS) {
    cleanLine = cleanLine.replace(dp, '')
  }
  cleanLine = cleanLine.replace(/\s+/g, ' ').trim()

  // Handle pipe-delimited format first
  const pipeParts = cleanLine.split(/\s*\|\s*/)
  if (pipeParts.length >= 2) {
    const firstPart = pipeParts[0].trim()
    const secondPart = pipeParts[1].trim()
    
    const titleKeywords = ['engineer', 'developer', 'manager', 'lead', 'scientist', 'analyst', 'architect', 'specialist', 'consultant', 'director', 'senior', 'junior', 'staff', 'principal']
    const secondIsTitle = titleKeywords.some(kw => secondPart.toLowerCase().includes(kw))
    
    if (secondIsTitle) {
      return { title: secondPart, company: cleanCompanyName(firstPart) }
    }
    // First part might be company, second part might be location
    if (isLocation(secondPart)) {
      return { title: null, company: cleanCompanyName(firstPart) }
    }
    return { title: secondPart || firstPart, company: cleanCompanyName(firstPart) }
  }

  // "at" pattern: "Software Engineer at Google"
  const atMatch = cleanLine.match(/(.+?)\s+(?:at|@)\s+(.+)/i)
  if (atMatch && atMatch[1].trim().length > 2 && atMatch[2].trim().length > 1) {
    return { title: atMatch[1].trim(), company: cleanCompanyName(atMatch[2].trim()) }
  }

  // Comma pattern (BEFORE dash): "DXC Technology, PA" or "Title, Company"
  const commaMatch = cleanLine.match(/(.+?)\s*,\s*(.+)/)
  if (commaMatch && commaMatch[1].trim().length > 2 && commaMatch[2].trim().length > 0) {
    const secondPart = commaMatch[2].trim()
    if (isLocation(secondPart)) {
      // "DXC Technology, PA" → company = "DXC Technology"
      return { title: null, company: cleanCompanyName(commaMatch[1].trim()) }
    } else {
      // "Software Engineer, Google" → title, company
      return { title: commaMatch[1].trim(), company: cleanCompanyName(secondPart) }
    }
  }

  // Dash pattern: "Google - Software Engineer" or "Fission Lab - Software Developer"
  const dashMatch = cleanLine.match(/(.+?)\s*[-–]\s*(.+)/)
  if (dashMatch && dashMatch[1].trim().length > 2 && dashMatch[2].trim().length > 1) {
    const leftPart = dashMatch[1].trim()
    const rightPart = dashMatch[2].trim()
    
    // If left part has NO title keywords and right part HAS title keywords, swap:
    // "Fission Lab – Software Developer" → company: "Fission Lab", title: "Software Developer"
    if (!isLikelyTitle(leftPart) && isLikelyTitle(rightPart)) {
      return { title: rightPart, company: cleanCompanyName(leftPart) }
    }
    // Default: left = title, right = company
    return { title: leftPart, company: cleanCompanyName(rightPart) }
  }

  // If no pattern matched, the whole line is likely the title
  if (cleanLine.length > 3 && cleanLine.length < 80) {
    return { title: cleanLine, company: null }
  }

  return { title: line, company: null }
}

// ─── Companies Extraction ─────────────────────────────────────

function extractCompaniesFromWork(sections: Section[]): Company[] {
  const entries = extractWorkHistory(sections)
  return entries.map(e => ({
    name: e.company,
    title: e.title,
    from: e.from,
    to: e.to,
  }))
}

// ─── Education Extraction ─────────────────────────────────────

function extractEducation(sections: Section[]): Education[] {
  const eduSection = sections.find(s => s.type === 'education')
  if (!eduSection) return []

  const entries: Education[] = []
  const lines = eduSection.lines

  // Strategy 1: Try to find institution keywords and parse lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length < 3) continue

    // Check if line contains an actual institution name
    const hasInstitutionKeyword = /(?:University|College|Institute|School|Academy|Polytechnic|Point|Bootcamp|Coursera|Udemy|edX|Udacity|Pluralsight|LinkedIn Learning|Codecademy|General Assembly|Le Wagon|Springboard)/i.test(line)
    
    // Check if line contains a degree keyword
    const hasDegreeKeyword = DEGREE_KEYWORDS.some(kw => line.toLowerCase().includes(kw.toLowerCase()))
    
    // If no institution and no degree, skip
    if (!hasInstitutionKeyword && !hasDegreeKeyword) continue
    
    // If no institution but has degree, check if next line has institution
    if (!hasInstitutionKeyword && hasDegreeKeyword && i + 1 < lines.length) {
      const nextLine = lines[i + 1]
      const nextHasInstitution = /(?:University|College|Institute|School|Academy|Polytechnic)/i.test(nextLine)
      if (nextHasInstitution) {
        // Degree on this line, school on next - combine them
        const entry: Education = { school: '' }
        
        // Extract school from next line
        const schoolMatch = nextLine.match(/([A-Z][A-Za-z\s]*(?:University|College|Institute|School|Academy|Polytechnic)[A-Za-z\s]*)/i)
        if (schoolMatch) entry.school = schoolMatch[1].trim()
        
        // Extract degree from current line
        entry.degree = line.trim()
        
        // Extract year from either line
        const yearFromLine = line.match(/\b(20\d{2}|19\d{2})(?:\s*[-–—]\s*(?:present|current|\d{4}))?\b/i)
        const yearFromNext = nextLine.match(/\b(20\d{2}|19\d{2})(?:\s*[-–—]\s*(?:present|current|\d{4}))?\b/i)
        if (yearFromLine) entry.year = yearFromLine[1]
        else if (yearFromNext) entry.year = yearFromNext[1]
        
        if (entry.school && (entry.degree || entry.year)) entries.push(entry)
        i++ // Skip the school line
        continue
      }
    }

    // If has institution but no degree, check if previous line was a degree
    if (hasInstitutionKeyword && !hasDegreeKeyword && entries.length > 0) {
      const prevEntry = entries[entries.length - 1]
      if (prevEntry.school && prevEntry.degree && !prevEntry.school.includes('University')) {
        // Previous entry was actually a degree line without school, merge
        const schoolMatch = line.match(/([A-Z][A-Za-z\s]*(?:University|College|Institute|School|Academy|Polytechnic)[A-Za-z\s]*)/i)
        if (schoolMatch) {
          prevEntry.school = schoolMatch[1].trim()
          if (prevEntry.year) entries.push(prevEntry)
        }
      }
    }

    // Standard parsing: line has institution keyword
    const entry: Education = { school: '' }

    // Extract school name
    const schoolMatch = line.match(/([A-Z][A-Za-z\s]*(?:University|College|Institute|School|Academy|Polytechnic|Point)[A-Za-z\s]*)/i)
    if (schoolMatch) {
      entry.school = schoolMatch[1].trim()
      // Fix stuck month: "Marist CollegeAug" → "Marist College"
      entry.school = entry.school.replace(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*$/i, '').trim()
    }

    // Extract degree
    const degreePatterns = [
      /(?:Bachelor|B\.?Tech|B\.?E\.|B\.?Sc|B\.?CA|B\.?Com|B\.?BA|B\.?BS)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:Master|M\.?Tech|M\.?E\.|M\.?Sc|M\.?CA|M\.?Com|M\.?BA|M\.?BS|MBA)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:PhD|Ph\.?D)[^\s,]*(?:\s+in\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
      /(?:Diploma|Class\s*(?:X|XI|XII|10|11|12))[^\s,]*(?:\s+(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
    ]

    for (const pattern of degreePatterns) {
      const match = line.match(pattern)
      if (match) {
        entry.degree = match[0].trim()
        
        const fieldMatch = line.match(/(?:in|of)\s+([A-Za-z\s]+?)(?:\s*[,–|\(]|$)/i)
        if (fieldMatch && !fieldMatch[1].trim().includes('University') && !fieldMatch[1].trim().includes('College')) {
          entry.field = fieldMatch[1].trim()
        }
        break
      }
    }

    // Extract year range
    const yearRangeMatch = line.match(/\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+)?(\d{4})\s*[-–—to]+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+)?(present|current|\d{4})\b/i)
    if (yearRangeMatch) {
      entry.year = yearRangeMatch[2] + '-' + (yearRangeMatch[4].includes('present') || yearRangeMatch[4].includes('current') ? 'Present' : yearRangeMatch[4])
    } else {
      const yearMatch = line.match(/\b(20\d{2}|19\d{2})\b/)
      if (yearMatch) entry.year = yearMatch[1]
    }

    // Extract GPA/CGPA
    const gpaMatch = line.match(/(?:CGPA|GPA|Percentage|Grade)[:\s]*(\d+\.?\d*)/i)
    if (gpaMatch) entry.gpa = gpaMatch[1]

    if (entry.school && (entry.degree || entry.year)) {
      entries.push(entry)
    }
  }

  return entries.slice(0, 5)
}

// ─── Projects Extraction ──────────────────────────────────────

function extractProjects(sections: Section[]): Project[] {
  const projSection = sections.find(s => s.type === 'projects')
  if (!projSection) return []

  const entries: Project[] = []

  for (const line of projSection.lines) {
    if (line.length < 5) continue

    // Try to extract project name and description
    const dashMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)/)
    if (dashMatch) {
      entries.push({
        name: dashMatch[1].trim(),
        description: dashMatch[2].trim(),
        tech: extractTechFromLine(line),
      })
    } else if (line.length > 10 && line.length < 200) {
      entries.push({
        name: line.slice(0, 60),
        description: line,
        tech: extractTechFromLine(line),
      })
    }
  }

  return entries.slice(0, 5)
}

function extractTechFromLine(line: string): string[] {
  const tech: string[] = []
  const techKeywords = ['react', 'vue', 'angular', 'node', 'python', 'java', 'typescript', 'javascript',
    'django', 'flask', 'fastapi', 'express', 'spring', 'aws', 'azure', 'gcp', 'docker',
    'kubernetes', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'html', 'css',
    'pytorch', 'tensorflow', 'pandas', 'numpy', ' kafka', 'spark', 'airflow', 'llm', 'rag']

  const lower = line.toLowerCase()
  for (const kw of techKeywords) {
    if (lower.includes(kw)) tech.push(kw.trim())
  }
  return tech
}

// ─── Certifications Extraction ────────────────────────────────

function extractCertifications(sections: Section[]): Certification[] {
  const certSection = sections.find(s => s.type === 'certifications')
  if (!certSection) return []

  return certSection.lines
    .filter(l => l.length > 3)
    .map(line => parseCertificationLine(line))
    .filter(c => c.name.length > 2)
    .slice(0, 8)
}

function parseCertificationLine(line: string): Certification {
  const parts = line.split(/[-–|,]+/).map(p => p.trim()).filter(Boolean)

  let name = parts[0]
  let issuer: string | undefined
  let year: string | undefined

  if (parts.length >= 3) {
    issuer = parts[1]
    year = extractYearFromCert(parts[parts.length - 1])
  } else if (parts.length === 2) {
    const lastIsYear = /\b(20\d{2}|19\d{2})\b/.test(parts[1])
    if (lastIsYear) {
      year = extractYearFromCert(parts[1])
    } else {
      issuer = parts[1]
    }
  }

  return { name, issuer, year }
}

function extractYearFromCert(s: string): string | undefined {
  const m = s.match(/(20\d{2}|19\d{2})/)
  return m?.[1]
}

// ─── Languages Extraction ─────────────────────────────────────

function extractLanguages(sections: Section[]): Language[] {
  const langSection = sections.find(s => s.type === 'languages')
  if (!langSection) return []

  const languages: Language[] = []

  for (const line of langSection.lines) {
    // Split by comma or bullet
    const parts = line.split(/[,•\-|]/).map(p => p.trim()).filter(Boolean)
    for (const part of parts) {
      if (part.length > 1 && part.length < 30) {
        // Try to extract proficiency
        const profMatch = part.match(/(.+?)\s*[-–(]\s*(.+?)\)?$/)
        if (profMatch) {
          languages.push({ name: profMatch[1].trim(), proficiency: profMatch[2].trim() })
        } else {
          languages.push({ name: part })
        }
      }
    }
  }

  return languages.slice(0, 10)
}
