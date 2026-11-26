/**
 * Deterministic resume parser (v2).
 *
 * Single rule-based engine used as the primary parser for every ingestion
 * path. No LLM calls. Accepts the plain text plus, when available, the
 * section list produced by the document-intelligence service (headings
 * detected from layout), and falls back to line-based heading detection.
 *
 * Design notes (from benchmarking the two previous engines):
 *  - name/headline/location/contact come from the document HEADER block,
 *    never from section content (the old section pipeline returned headings
 *    such as "Responsibilities" or "CORE SKILLS" as names);
 *  - skills use the canonical alias dictionary with word boundaries and an
 *    ambiguity stoplist (the flat regex engine produced "r", "pa", "lua");
 *  - work history is anchored on date ranges, then title/company/location are
 *    classified from the surrounding lines instead of positional splitting;
 *  - education pairs degree lines with institution lines within a window.
 */
import type {
  ParsedCandidate, Skill, Company, Education, Project, WorkHistoryEntry, Certification, Language,
} from '../types.js'
import { SECTION_ALIASES } from '../modules/candidate-intelligence/constants/section-aliases.js'
import { SKILL_CATEGORIES, SKILL_ALIASES } from '../modules/candidate-intelligence/constants/skill-aliases.js'

export interface DocSection { name: string; content: string; level?: number }

export const DETERMINISTIC_PARSER_VERSION = 'deterministic-2.5.0'

// ─── Constants ───────────────────────────────────────────────

// English plus Spanish/Portuguese abbreviations (ene, abr, ago, dic, fev, dez) seen in LATAM resumes
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ene|abr|ago|dic|fev|dez)[a-z]*\\.?'
const MONTH_ALIAS: Record<string, string> = { ene: 'jan', abr: 'apr', ago: 'aug', dic: 'dec', fev: 'feb', dez: 'dec' }
const PRESENT = '(?:present|current(?:ly)?|now|till(?:\\s+(?:date|now|today))?|to\\s+date|ongoing|today)'
const SEP = '\\s*(?:[-–—]|to|until|till)\\s*'

/** Date-range patterns. Group 1 = start, group 2 = end. */
const RANGE_PATTERNS: RegExp[] = [
  new RegExp(`(${MONTH}\\s*,?\\s*\\d{4})${SEP}(${MONTH}\\s*,?\\s*\\d{4}|${PRESENT})`, 'i'),
  new RegExp(`(${MONTH}\\s*[\\/'’]\\s*\\d{2,4})${SEP}(${MONTH}\\s*[\\/'’]\\s*\\d{2,4}|${PRESENT})`, 'i'),
  // "October 22 – Present", "April 19 – August 20" (two-digit years, no separator)
  new RegExp(`\\b(${MONTH}\\s+\\d{2})(?!\\d)${SEP}(${MONTH}\\s+\\d{2,4}(?!\\d)|${PRESENT})`, 'i'),
  // "03/2020 – 03-2021", "06.2019 - 09.2019": numeric month/year with any separator on either side
  new RegExp(`(\\d{1,2}[\\/.\\-]\\d{4})${SEP}(\\d{1,2}[\\/.\\-]\\d{4}|${PRESENT})`, 'i'),
  new RegExp(`(\\d{1,2}\\/\\d{1,2}\\/\\d{4})${SEP}(\\d{1,2}\\/\\d{1,2}\\/\\d{4}|${PRESENT})`, 'i'),
  new RegExp(`(\\d{4}-\\d{2}(?:-\\d{2})?)${SEP}(\\d{4}-\\d{2}(?:-\\d{2})?|${PRESENT})`, 'i'),
  new RegExp(`(Q[1-4]\\s+\\d{4})${SEP}(Q[1-4]\\s+\\d{4}|${PRESENT})`, 'i'),
  new RegExp(`\\b((?:19|20)\\d{2})${SEP}((?:19|20)\\d{2}|${PRESENT})\\b`, 'i'),
]
const SINGLE_DATE = new RegExp(`\\b(${MONTH}\\s*,?\\s*\\d{4}|\\d{1,2}\\/\\d{4}|(?:19|20)\\d{2})\\b`, 'i')

const TITLE_WORDS = [
  'engineer', 'developer', 'architect', 'manager', 'lead', 'senior', 'junior', 'staff', 'principal',
  'director', 'analyst', 'consultant', 'specialist', 'scientist', 'intern', 'associate', 'coordinator',
  'supervisor', 'administrator', 'technician', 'designer', 'executive', 'officer', 'assistant', 'head',
  'vp', 'president', 'founder', 'owner', 'partner', 'recruiter', 'accountant', 'auditor', 'lawyer',
  'advocate', 'attorney', 'nurse', 'physician', 'doctor', 'pharmacist', 'therapist', 'teacher',
  'professor', 'lecturer', 'trainer', 'instructor', 'student', 'graduate', 'fresher', 'aspiring',
  'programmer', 'tester', 'qa', 'sdet', 'devops', 'sre', 'full stack', 'full-stack', 'frontend',
  'front-end', 'backend', 'back-end', 'software', 'data', 'cloud', 'platform', 'network', 'security',
  'marketing', 'sales', 'business', 'product', 'project', 'program', 'operations', 'hr', 'human resources',
  'talent', 'finance', 'financial', 'legal', 'customer', 'support', 'representative', 'strategist',
  'writer', 'editor', 'artist', 'photographer', 'chef', 'driver', 'electrician', 'mechanic', 'planner',
  'controller', 'generalist', 'clerk', 'secretary', 'receptionist', 'paralegal', 'counsel', 'actuary',
]
const TITLE_RE = new RegExp(`\\b(?:${TITLE_WORDS.map(w => w.replace(/[-\/]/g, m => `\\${m}`)).join('|')})\\b`, 'i')
/** Role nouns that make a phrase a job title on their own ("Network" alone does not). */
const TITLE_NOUN_RE = /\b(?:engineer|developer|architect|manager|lead|analyst|consultant|specialist|scientist|intern|associate|coordinator|supervisor|administrator|technician|designer|executive|officer|assistant|head|vp|president|founder|owner|partner|recruiter|accountant|auditor|lawyer|advocate|attorney|nurse|physician|doctor|pharmacist|therapist|teacher|professor|lecturer|trainer|instructor|student|graduate|fresher|programmer|tester|sdet|sre|strategist|writer|editor|artist|photographer|chef|driver|electrician|mechanic|planner|controller|generalist|clerk|secretary|receptionist|paralegal|counsel|actuary|representative|director|cto|ceo|cfo|coo|cio|principal|staff|researcher|advisor|adviser|agent|operator|technologist|practitioner|contractor|freelancer|volunteer|apprentice|trainee)\b/i
const TITLE_MODIFIER_RE = /\b(?:senior|junior|sr\.?|jr\.?|lead|staff|principal|chief|associate|assistant|full[-\s]?stack|front[-\s]?end|back[-\s]?end|software|data|cloud|platform|network|security|devops|qa|test|product|project|program|business|operations|hr|human resources|talent|finance|financial|legal|customer|support|marketing|sales|digital|technical|solutions?|systems?|infrastructure|ai|ml|machine learning|embedded|mobile|web|ui|ux|graphic|mechanical|electrical|civil|chemical|process|quality|supply chain|logistics|clinical|medical|research)\b/gi
function isTitleLike(seg: string): boolean {
  const t = seg.trim()
  if (!t || t.length > 90 || /@|https?:/i.test(t)) return false
  if (TITLE_NOUN_RE.test(t)) return true
  const mods = t.match(TITLE_MODIFIER_RE)
  return !!mods && mods.length >= 2
}

const COMPANY_SUFFIX_RE = /\b(?:inc|inc\.|llc|llp|ltd|ltd\.|limited|pvt|pvt\.|private|plc|gmbh|s\.?a\.?|corp|corp\.|corporation|co\.|company|technologies|technology|tech|solutions|systems|software|services|consulting|consultancy|labs|lab|group|holdings|bank|financial|insurance|hospital|clinic|healthcare|university|college|institute|school|agency|studio|studios|networks|network|infotech|info\s*tech|digital|global|international|enterprises|industries|partners|associates|capital|ventures|foundation|trust|media|logistics|pharma|pharmaceuticals|motors|airlines|retail|stores|mart|interconnection|infosys|tcs|wipro|accenture|cognizant|capgemini|deloitte|pwc|kpmg|ey|ibm|microsoft|google|amazon|oracle|sap|hcl|tech mahindra|mindtree|mphasis|ltimindtree|persistent|zensar|hexaware|birlasoft|cyient|virtusa|genpact|concentrix|teleperformance|wns|exl)\b/i

const SECTION_WORD_RE = /^(?:professional\s+)?(?:summary|profile|objective|experience|work\s+history|employment|education|skills|projects?|certifications?|languages?|achievements?|awards?|references?|contact|personal\s+details|declaration|hobbies|interests|strengths|training|internships?|publications?|activities|core\s+competenc(?:y|ies)|technical\s+skills|career\s+objective|about\s+me|responsibilities|key\s+skills|scholastics|academic\s+(?:background|qualifications?))\b/i

const COUNTRIES = ['venezuela', 'ecuador', 'bolivia', 'paraguay', 'uruguay', 'guatemala', 'honduras', 'costa rica', 'panama', 'cuba', 'puerto rico', 'el salvador', 'nicaragua', 'dominican republic', 'mexico', 'méxico', 'mxico', 'india', 'usa','u.s.a', 'united states', 'united states of america', 'uk', 'u.k', 'united kingdom', 'england', 'canada', 'australia', 'germany', 'france', 'netherlands', 'ireland', 'spain', 'italy', 'sweden', 'norway', 'denmark', 'finland', 'switzerland', 'poland', 'portugal', 'belgium', 'austria', 'uae', 'united arab emirates', 'dubai', 'abu dhabi', 'qatar', 'saudi arabia', 'oman', 'kuwait', 'bahrain', 'singapore', 'malaysia', 'indonesia', 'philippines', 'thailand', 'vietnam', 'japan', 'china', 'hong kong', 'south korea', 'korea', 'taiwan', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'new zealand', 'south africa', 'nigeria', 'kenya', 'egypt', 'brazil', 'mexico', 'argentina', 'colombia', 'chile', 'peru', 'turkey', 'israel', 'russia', 'ukraine', 'remote']
const REGIONS = ['karnataka', 'maharashtra', 'tamil nadu', 'telangana', 'andhra pradesh', 'kerala', 'gujarat', 'rajasthan', 'uttar pradesh', 'madhya pradesh', 'west bengal', 'delhi', 'ncr', 'haryana', 'punjab', 'bihar', 'odisha', 'orissa', 'assam', 'jharkhand', 'chhattisgarh', 'uttarakhand', 'himachal pradesh', 'goa', 'jammu', 'kashmir', 'chandigarh', 'california', 'texas', 'new york', 'florida', 'illinois', 'pennsylvania', 'ohio', 'georgia', 'north carolina', 'south carolina', 'michigan', 'new jersey', 'virginia', 'washington', 'arizona', 'massachusetts', 'tennessee', 'indiana', 'missouri', 'maryland', 'wisconsin', 'colorado', 'minnesota', 'alabama', 'louisiana', 'kentucky', 'oregon', 'oklahoma', 'connecticut', 'utah', 'iowa', 'nevada', 'arkansas', 'mississippi', 'kansas', 'new mexico', 'nebraska', 'idaho', 'west virginia', 'hawaii', 'new hampshire', 'maine', 'montana', 'rhode island', 'delaware', 'south dakota', 'north dakota', 'alaska', 'vermont', 'wyoming', 'ontario', 'quebec', 'british columbia', 'alberta', 'new south wales', 'victoria', 'queensland']
const CITIES = ['bangalore', 'bengaluru', 'mumbai', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'lucknow', 'indore', 'nagpur', 'surat', 'noida', 'gurgaon', 'gurugram', 'new delhi', 'delhi', 'kochi', 'cochin', 'trivandrum', 'thiruvananthapuram', 'coimbatore', 'mysore', 'mysuru', 'visakhapatnam', 'vizag', 'vijayawada', 'bhubaneswar', 'bhopal', 'chandigarh', 'mohali', 'patna', 'ranchi', 'guwahati', 'thane', 'navi mumbai', 'nashik', 'vadodara', 'rajkot', 'madurai', 'mangalore', 'hubli', 'dehradun', 'kanpur', 'agra', 'varanasi', 'ludhiana', 'amritsar', 'faridabad', 'ghaziabad', 'greater noida', 'san francisco', 'san jose', 'new york', 'los angeles', 'chicago', 'seattle', 'boston', 'austin', 'dallas', 'houston', 'atlanta', 'denver', 'miami', 'portland', 'raleigh', 'durham', 'charlotte', 'phoenix', 'tucson', 'detroit', 'minneapolis', 'pittsburgh', 'columbus', 'indianapolis', 'nashville', 'memphis', 'louisville', 'milwaukee', 'baltimore', 'philadelphia', 'washington dc', 'washington, dc', 'tampa', 'orlando', 'jacksonville', 'cleveland', 'cincinnati', 'st. louis', 'kansas city', 'salt lake city', 'las vegas', 'sacramento', 'san diego', 'oakland', 'irvine', 'plano', 'frisco', 'richmond', 'arlington', 'alexandria', 'reston', 'herndon', 'jersey city', 'newark', 'hoboken', 'stamford', 'hartford', 'princeton', 'edison', 'montrose', 'london', 'manchester', 'birmingham', 'leeds', 'glasgow', 'edinburgh', 'dublin', 'berlin', 'munich', 'frankfurt', 'hamburg', 'paris', 'amsterdam', 'rotterdam', 'brussels', 'zurich', 'geneva', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'madrid', 'barcelona', 'lisbon', 'milan', 'rome', 'warsaw', 'prague', 'vienna', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa', 'sydney', 'melbourne', 'brisbane', 'perth', 'auckland', 'singapore', 'kuala lumpur', 'jakarta', 'manila', 'quezon city', 'cebu', 'bangkok', 'ho chi minh', 'hanoi', 'tokyo', 'osaka', 'seoul', 'shanghai', 'beijing', 'shenzhen', 'hong kong', 'taipei', 'dubai', 'abu dhabi', 'sharjah', 'doha', 'riyadh', 'jeddah', 'muscat', 'kuwait city', 'manama', 'karachi', 'lahore', 'islamabad', 'dhaka', 'colombo', 'kathmandu', 'nairobi', 'lagos', 'cairo', 'johannesburg', 'cape town', 'sao paulo', 'mexico city', 'buenos aires', 'bogota', 'santiago', 'lima', 'istanbul', 'tel aviv']
const US_STATE_ABBR = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'ON', 'QC', 'BC', 'AB', 'NSW', 'VIC', 'QLD'])
const GAZETTEER = new Set([...COUNTRIES, ...REGIONS, ...CITIES])

/** Dictionary tokens that are common English words; accepted only inside a skills section. */
const AMBIGUOUS_SKILLS = new Set(['ms', 'r', 'go', 'c', 'd', 'less', 'lean', 'rest', 'agent', 'parcel', 'inventor', 'valuation', 'audit', 'compliance', 'kyc', 'pa', 'lua', 'dart', 'swift', 'rust', 'spring', 'express', 'remix', 'astro', 'shell', 'assembly', 'processing', 'scheme', 'ada', 'basic', 'flow', 'canvas', 'material', 'bootstrap', 'ionic', 'electron', 'flutter', 'maui', 'cordova', 'blazor', 'nuxt', 'next', 'fastify', 'rails', 'laravel', 'symfony', 'keras', 'plotly', 'cohere', 'transformers', 'slack', 'jira', 'confluence', 'figma', 'notion', 'asana', 'trello', 'zoom', 'teams', 'office', 'word', 'excel', 'outlook', 'access', 'power', 'point', 'sketch', 'mint', 'arch', 'storm', 'spark', 'flink', 'beam', 'hive', 'pig', 'hue', 'oozie', 'presto', 'drill', 'kudu', 'ranger', 'knox', 'atlas', 'glue', 'athena', 'lambda', 'step', 'batch', 'fargate', 'lightsail', 'amplify', 'cognito', 'pinpoint', 'connect', 'chime', 'workmail', 'workdocs', 'workspaces', 'appstream', 'outposts', 'wavelength', 'braket', 'ground', 'station', 'snowball', 'snowmobile', 'storage', 'gateway', 'transfer', 'backup', 'elastic', 'disaster', 'recovery', 'migration', 'hub', 'control', 'tower', 'organizations', 'config', 'trail', 'watch', 'inspector', 'detective', 'macie', 'shield', 'waf', 'firewall', 'manager', 'secrets', 'certificate', 'directory', 'service', 'catalog', 'marketplace', 'well', 'architected', 'tool', 'trusted', 'advisor', 'personal', 'health', 'dashboard', 'support', 'center', 'console', 'mobile', 'application', 'cli', 'sdk', 'cdk', 'sam', 'copilot', 'proton', 'app', 'runner', 'mesh', 'cloud', 'map', 'x-ray', 'logs', 'insights', 'events', 'bridge', 'bus', 'queue', 'notification', 'topic', 'email', 'sms', 'push', 'voice', 'video', 'chat', 'bot', 'assistant', 'agent', 'automation', 'workflow', 'pipeline', 'build', 'deploy', 'commit', 'star', 'artifact', 'guru', 'profiler', 'reviewer', 'security', 'identity', 'management', 'resource', 'tagging', 'editor', 'license', 'systems', 'ops', 'works', 'patch', 'session', 'inventory', 'maintenance', 'window', 'change', 'calendar', 'parameter', 'store', 'run', 'command', 'state', 'document', 'distributor', 'fleet', 'explorer', 'quick', 'setup', 'incident', 'contacts', 'response', 'plan', 'opscenter', 'application manager', 'go lang'])

// ─── Helpers ─────────────────────────────────────────────────

function normalizeHeading(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

const EXPERIENCE_HEADING_OVERRIDE = /^(?:project experience|projects? (?:handled|undertaken|executed)|client (?:experience|engagements?|projects?|history)|(?:professional |work |relevant |technical )?exp(?!ertise|ectation|osure)[a-z]{5,})$/

function matchSectionType(rawName: string): string | null {
  const normalized = normalizeHeading(rawName)
  if (!normalized || normalized.length > 60 || normalized.split(' ').length > 6) return null
  // IT-consulting resumes list client engagements under these headings; they are work history.
  // Also tolerate misspelled "experience" headings ("PROFESSIONAL EXPEREICNE").
  if (EXPERIENCE_HEADING_OVERRIDE.test(normalized)) return 'experience'
  let best: string | null = null
  let bestScore = 0
  for (const [type, aliases] of Object.entries(SECTION_ALIASES)) {
    for (const alias of aliases) {
      let score = 0
      if (normalized === alias) score = 1
      else if (normalized === alias.replace(/\s+/g, '')) score = 0.95
      else if (normalized.startsWith(alias + ' ') || normalized.endsWith(' ' + alias) || normalized.includes(' ' + alias + ' ')) score = 0.85
      else if (normalized.includes(alias) && normalized.length <= alias.length + 12) score = 0.8
      if (score > bestScore) { bestScore = score; best = type }
    }
  }
  // Extra aliases not in the shared table
  if (bestScore < 0.8) {
    if (/^(?:scholastics?|academics?|academic (?:background|qualifications?|details)|educational? (?:background|qualifications?|details)|qualifications?)$/.test(normalized)) return 'education'
    if (/^(?:internships?(?: (?:and|&) trainings?)?|internship experience|industrial experience|career (?:history|summary|details|structure|path|progression)|professional (?:history|background|experience)|work (?:experience|details)|employment(?: (?:history|details|record))?(?: organi[sz]ation history)?|organi[sz]ation history|experience (?:details|summary)|relevant experience)$/.test(normalized)) return 'experience'
    // Short headings that contain the key word, e.g. "Employment Details/Organization History"
    if (normalized.split(' ').length <= 5 && /\b(?:experience|employment)\b/.test(normalized) && !/\b(?:years?|summary of)\b/.test(normalized)) return 'experience'
    if (/^(?:skills?|skill ?sets?|technical (?:skills?|skill ?sets?|expertise|proficienc(?:y|ies)|summary)|core (?:skills?|competenc(?:y|ies))|skills? (?:summary|set|profile)|key (?:skills?|competenc(?:y|ies))|areas? of expertise|technologies|tools? (?:and|&) technologies|it skills|computer skills|software skills|professional skills|functional skills|competenc(?:y|ies))$/.test(normalized)) return 'skills'
    if (/^(?:about(?: me)?|profile(?: summary)?|career objective|objective|summary|professional summary|executive summary|personal statement|overview|introduction|synopsis)$/.test(normalized)) return 'summary'
    if (/^(?:personal (?:details|information|profile|info)|contact(?: (?:details|information|info))?)$/.test(normalized)) return 'contact'
    if (/^(?:achievements?|accomplishments?|awards?(?: (?:and|&) (?:honou?rs|recognitions?))?|honou?rs)$/.test(normalized)) return 'awards'
    if (/^(?:projects?|key projects?|academic projects?|personal projects?|project (?:details|experience|work))$/.test(normalized)) return 'projects'
    if (/^(?:certifications?|certificates?|licen[sc]es?(?: (?:and|&) certifications?)?|trainings?(?: (?:and|&) certifications?)?|courses?)$/.test(normalized)) return 'certifications'
    if (/^(?:languages?(?: known)?|language (?:skills|proficiency))$/.test(normalized)) return 'languages'
  }
  return bestScore >= 0.8 ? best : null
}

function isHeadingLine(line: string): string | null {
  const t = line.trim()
  if (!t || t.length > 60) return null
  if (/[@|]/.test(t) || /https?:/i.test(t)) return null
  const stripped = t.replace(/[:\-–—•▪▸·]+$/g, '').trim()
  if (stripped.split(/\s+/).length > 6) return null
  // headings rarely end with a period or contain digits
  if (/\d/.test(stripped) || /\.$/.test(stripped)) return null
  return matchSectionType(stripped)
}

function cleanLine(line: string): string {
  return line.replace(/\t+/g, '  ').replace(/ /g, ' ').replace(/[ ]{3,}/g, '  ').trim()
}

function collapseSpacedLetters(text: string): string {
  const tokens = text.split(/\s+/)
  if (tokens.length >= 4 && tokens.every(t => t.length === 1)) return tokens.join('')
  return text
}

function isBullet(line: string): boolean {
  return /^[•●○◦▪▫▸►➢➤✓✔\-*–—·]\s*/.test(line) || /^\d+[.)]\s+/.test(line)
}

function stripBullet(line: string): string {
  return line.replace(/^[•●○◦▪▫▸►➢➤✓✔\-*–—·]\s*/, '').replace(/^\d+[.)]\s+/, '').trim()
}

function findRange(line: string): { start: string; end: string; match: string } | null {
  for (const re of RANGE_PATTERNS) {
    const m = line.match(re)
    if (m) return { start: m[1].trim(), end: m[2].trim(), match: m[0] }
  }
  return null
}

function normalizeEnd(end: string): string {
  return new RegExp(`^${PRESENT}$`, 'i').test(end.trim()) ? 'Present' : end.trim()
}

function parseDate(s: string): Date | null {
  if (!s) return null
  const lower = s.toLowerCase().trim()
  if (new RegExp(`^${PRESENT}$`, 'i').test(lower)) return new Date()
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  let m = lower.match(/([a-z]{3})[a-z]*\.?\s*[,'’\/]?\s*(\d{2,4})/)
  const mon = m ? (MONTH_ALIAS[m[1]] || m[1]) : ''
  if (m && months.includes(mon)) {
    let year = parseInt(m[2], 10)
    if (year < 100) year += year > 50 ? 1900 : 2000
    return new Date(year, months.indexOf(mon), 1)
  }
  m = lower.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return new Date(parseInt(m[3], 10), Math.min(11, parseInt(m[2], 10) - 1), 1)
  m = lower.match(/^(\d{1,2})[\/.\-](\d{4})$/)
  if (m) return new Date(parseInt(m[2], 10), Math.min(11, parseInt(m[1], 10) - 1), 1)
  m = lower.match(/^(\d{4})-(\d{2})/)
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1)
  m = lower.match(/^q([1-4])\s+(\d{4})$/)
  if (m) return new Date(parseInt(m[2], 10), (parseInt(m[1], 10) - 1) * 3, 1)
  m = lower.match(/^((?:19|20)\d{2})$/)
  if (m) return new Date(parseInt(m[1], 10), 0, 1)
  return null
}

function looksLikeLocation(seg: string): boolean {
  if (/^\(?\s*(?:remote|hybrid|on-?site|wfh)\s*\)?$/i.test(seg.trim())) return true
  // "Peoria, IL (Remote)" -> "Peoria, IL"
  const t = seg.replace(/[()]/g, ' ').replace(/\b(?:remote|hybrid|on-?site|wfh)\b/gi, ' ').replace(/\s+/g, ' ').trim().replace(/[,\s-]+$/, '')
  if (!t || t.length > 50) return false
  if (/^(?:client|company|employer|organi[sz]ation|role|title)\s*[:\-–]/i.test(t)) return false
  const lower = t.toLowerCase().replace(/\s+/g, ' ')
  if (GAZETTEER.has(lower)) return true
  if (t.length === 2 && US_STATE_ABBR.has(t.toUpperCase())) return true
  if (/^remote(?:\s*[-–,\/]\s*\w+)?$/i.test(t) || /^(?:hybrid|on-?site|work from home|wfh)$/i.test(t)) return true
  const parts = lower.split(/\s*,\s*/)
  if (parts.length >= 2 && parts.length <= 3) {
    if (parts.some(p => p.split(' ').length > 3 || COMPANY_SUFFIX_RE.test(p) || (TITLE_RE.test(p) && !GAZETTEER.has(p)))) return false
    const last = parts[parts.length - 1]
    if (GAZETTEER.has(last) || US_STATE_ABBR.has(last.toUpperCase()) || /^\d{5,6}$/.test(last)) return true
    if (parts.some(p => GAZETTEER.has(p))) return true
  }
  if (/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}(?:\s+\d{5})?$/.test(t) && US_STATE_ABBR.has(t.split(',')[1].trim().slice(0, 2))) return true
  return false
}

function looksLikeTitle(seg: string): boolean {
  const t = seg.trim()
  if (!t || t.length > 90) return false
  if (/[@]|https?:/i.test(t)) return false
  return isTitleLike(t) && !COMPANY_SUFFIX_RE.test(t.replace(TITLE_NOUN_RE, '').replace(TITLE_MODIFIER_RE, ''))
}

function looksLikeCompany(seg: string): boolean {
  const t = seg.trim()
  if (!t || t.length > 90) return false
  if (/^(?:client|company|employer|organi[sz]ation)(?:\s+name)?\s*[:\-–]/i.test(t)) return true
  return COMPANY_SUFFIX_RE.test(t)
}

function stripLabel(seg: string): string {
  return seg
    .replace(/^(?:client|company|employer|organi[sz]ation|role|title|position|designation)(?:\s+name)?\s*[:\-–]\s*/i, '')
    .replace(/^[lI|]\s+(?=[A-Z])/, '')   // stray pipe rendered as a letter by some converters
    .replace(/\s+[lI|]$/, '')
    .trim()
}

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s
  return s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\b(Of|And|The|For|At|In|On)\b/g, w => w.toLowerCase())
}

// ─── Section model ───────────────────────────────────────────

interface Sec { type: string; lines: string[] }

interface Layout { header: string[]; sections: Sec[]; allLines: string[] }

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map(cleanLine)
}

function layoutFromLines(lines: string[]): Layout {
  const header: string[] = []
  const sections: Sec[] = []
  let current: Sec | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    // Inline heading: "SKILLS: Python, Java" or "Experience  Software Engineer ..."
    let type = isHeadingLine(line)
    let remainder = ''
    if (!type) {
      const inline = line.match(/^([A-Za-z][A-Za-z\s&\/]{2,40}?)\s*[:\-–—]\s+(.{3,})$/)
      if (inline) {
        const t = matchSectionType(inline[1])
        if (t && !/\d/.test(inline[1])) { type = t; remainder = inline[2].trim() }
      }
    }
    if (type) {
      if (current) sections.push(current)
      current = { type, lines: remainder ? [remainder] : [] }
      continue
    }
    if (current) current.lines.push(line)
    else if (header.length < 25) header.push(line)
  }
  if (current) sections.push(current)
  return { header, sections, allLines: lines.filter(Boolean) }
}

function layoutFromDocSections(text: string, docSections: DocSection[]): Layout {
  const lines = splitLines(text)
  const sections: Sec[] = []
  const preamble: string[] = []
  let current: Sec | null = null
  for (const ds of docSections) {
    const type = matchSectionType(ds.name)
    const contentLines = splitLines(ds.content || '').filter(Boolean)
    if (type) {
      if (current) sections.push(current)
      current = { type, lines: [...contentLines] }
    } else if (current) {
      // Unrecognised heading inside a known section (e.g. a job title or company
      // rendered in heading font). Keep it as content.
      current.lines.push(ds.name.trim(), ...contentLines)
    } else {
      preamble.push(ds.name.trim(), ...contentLines)
    }
  }
  if (current) sections.push(current)

  // Header: plain-text lines before the first recognised heading, plus anything
  // the document service placed before that heading. The service may name a
  // heading differently from the text ("Summary" vs "PROFESSIONAL SUMMARY"), so
  // also stop at the first line our own heading detector recognises.
  const firstHeading = docSections.find(ds => matchSectionType(ds.name))?.name
  let headerEnd = Math.min(lines.length, 25)
  if (firstHeading) {
    const target = normalizeHeading(firstHeading)
    const idx = lines.findIndex((l, i) => i < 60 && l.trim() && (normalizeHeading(l) === target || normalizeHeading(l).endsWith(' ' + target)))
    if (idx >= 0) headerEnd = Math.min(idx, 40)
  }
  const firstDetected = lines.findIndex((l, i) => i < 60 && l.trim() && isHeadingLine(l) !== null)
  if (firstDetected >= 0) headerEnd = Math.min(headerEnd, firstDetected)
  const header = lines.slice(0, headerEnd).filter(Boolean)
  // Fall back to the layout detector on the plain text for sections the service missed
  const lineLayout = layoutFromLines(lines)
  for (const sec of lineLayout.sections) {
    if (!sections.some(s => s.type === sec.type)) sections.push(sec)
  }
  const merged = header.length > 0 ? header : preamble
  // Re-run heading detection inside each section's lines so "Experience" blocks
  // that contain an inline "Education" heading are split correctly.
  const finalSections: Sec[] = []
  for (const sec of sections) {
    const nested = layoutFromLines(sec.lines)
    finalSections.push({ type: sec.type, lines: nested.header })
    for (const n of nested.sections) {
      const existing = finalSections.find(s => s.type === n.type)
      if (existing) existing.lines.push(...n.lines)
      else finalSections.push(n)
    }
  }
  return { header: merged, sections: finalSections, allLines: lines.filter(Boolean) }
}

function sectionLines(layout: Layout, type: string): string[] {
  return layout.sections.filter(s => s.type === type).flatMap(s => s.lines)
}

// ─── Header: name, headline, location, contact ───────────────

const NAME_SKIP = [/@/, /https?:/i, /www\./i, /\bresume\b/i, /\bcurriculum/i, /\bcv\b/i, /\b(?:phone|mobile|email|e-mail|contact|address|linkedin|github|portfolio|dob|date of birth|nationality|gender|marital)\b/i, /\d{3,}/, /^[\W_]+$/]

/** "Sangli Maharashtra India", "Pune, India": most words are known places, so it is not a person's name. */
export function isPlaceName(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  let places = 0
  for (let i = 0; i < words.length; i++) {
    const two = i + 1 < words.length ? `${words[i]} ${words[i + 1]}` : ''
    if (two && GAZETTEER.has(two)) { places += 2; i++ }
    else if (GAZETTEER.has(words[i])) places++
  }
  // Two-word names such as "Victoria Washington" stay valid unless written as "City, Region".
  if (words.length < 3 && !text.includes(',')) return false
  return places >= 2 && places / words.length >= 0.5
}

// Words that appear in resume headings, roles, degrees or filler but never in a person's name
// (English and Spanish, since part of the backlog is Latin American resumes).
const NOT_NAME_WORDS = new Set([
  'perfil', 'profesional', 'contacto', 'curriculum', 'vitae', 'hoja', 'vida', 'datos', 'personales', 'resumen', 'experiencia', 'educacion', 'formacion', 'ingeniero', 'ingeniera', 'licenciado', 'licenciada', 'tecnico',
  'profile', 'summary', 'contact', 'resume', 'objective', 'mobile', 'phone', 'email', 'address', 'certified', 'certification', 'summer', 'internship', 'training', 'intern', 'fresher', 'learner', 'fast', 'present', 'current',
  'msc', 'mba', 'bsc', 'btech', 'mtech', 'ba', 'llb', 'llm', 'phd', 'bachelor', 'master', 'diploma', 'international', 'management', 'general', 'english', 'hindi', 'functional', 'consultant', 'senior', 'junior', 'developer', 'engineer',
  'name', 'team', 'player', 'public', 'school', 'college', 'university', 'institute', 'technology', 'technologies', 'solutions', 'services', 'systems', 'skills', 'expertise', 'areas', 'personal', 'details', 'information', 'relevant', 'coursework', 'human', 'behavior', 'behaviour',
  'acerca', 'sobre', 'mi', 'constitutional', 'law', 'regulatory', 'analytical', 'multiple', 'linked', 'linkedin', 'gmail', 'com', 'hons', 'cgpa',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
])
const NAME_PARTICLES = new Set(['de', 'da', 'del', 'della', 'dos', 'das', 'do', 'di', 'du', 'la', 'le', 'van', 'von', 'der', 'den', 'bin', 'binti', 'al', 'el', 'y', 'e'])
// Common-noun endings that names essentially never have (Requirements, Connectivity, Thinking...)
// (Not -ing/-ence/-ance: Manning, Lawrence, Florence are names.)
const NOUN_SUFFIX_RE = /(?:tion|tions|sion|ity|ities|ment|ments|ness|ology|ship)$/i

/**
 * Conservative test that a string reads as a person's name: 1-5 alphabetic words, none of them
 * a heading/role/degree word, not a place, no glued CamelCase words ("SeniorMicrosoftDynamics").
 */
export function looksLikePersonName(raw: string | null | undefined): boolean {
  if (!raw) return false
  const name = raw.replace(/\.(?:pdf|docx?)$/i, '').trim()
  if (name.length < 2 || name.length > 60 || /\d|@|_|\.pdf|http/i.test(raw)) return false
  if (/^(?:unknown|failed\b)/i.test(name)) return false
  const words = name.split(/\s+/)
  if (words.length > 5) return false
  if (!words.every(w => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'’-]*$/.test(w))) return false
  // Dots only as initials or short abbreviations ("E.", "Ma.", "Adv.", "J.B"), never inside a word ("jagtap.chandrakant")
  if (words.some(w => /\./.test(w) && !/^(?:[A-Za-z]{1,3}\.)+[A-Za-z]{0,3}\.?$/.test(w))) return false
  // Names are capitalised or all upper-case; lower-case words are only allowed as particles ("de", "van")
  if (words.some(w => /^[a-zà-ÿ]/.test(w) && !NAME_PARTICLES.has(w.toLowerCase()))) return false
  if (words.every(w => NAME_PARTICLES.has(w.toLowerCase()))) return false
  // Joined words: "LeelaKrishna" is fine, "SeniorMicrosoftDynamics" (2+ joins) is not; check each part
  const parts = words.flatMap(w => w.split(/-|(?<=[a-zà-ÿ])(?=[A-Z])/)).filter(Boolean)
  if (words.some(w => (w.match(/[a-zà-ÿ][A-Z]/g) || []).length >= 2 && !/^(?:Mc|Mac)/.test(w))) return false
  if (parts.some(p => NOT_NAME_WORDS.has(p.toLowerCase().replace(/[.'’-]/g, '')))) return false
  if (parts.some(p => p.length >= 6 && NOUN_SUFFIX_RE.test(p))) return false
  if (TITLE_NOUN_RE.test(name) || SECTION_WORD_RE.test(name) || matchSectionType(name)) return false
  if (isPlaceName(name) || words.some(w => COUNTRIES.includes(w.toLowerCase()))) return false
  // "Pottstown PA": a mixed-case word followed by an upper-case US/CA state code
  const last = words[words.length - 1]
  if (words.length === 2 && US_STATE_ABBR.has(last) && words[0] !== words[0].toUpperCase()) return false
  if (/\b(?:of|and|the|for|with|in|at|to)\b/i.test(name) && words.length > 2) return false
  return true
}

function nameScore(line: string): number {
  const t = line.trim()
  if (t.length < 2 || t.length > 60) return -10
  if (NAME_SKIP.some(re => re.test(t))) return -10
  if (SECTION_WORD_RE.test(t)) return -10
  if (matchSectionType(t)) return -10
  const words = t.split(/\s+/)
  if (words.length > 5) return -10
  let score = 0
  const alphaWords = words.filter(w => /^[A-Za-z][A-Za-z.'’\-]*$/.test(w))
  if (alphaWords.length !== words.length) score -= 3
  if (words.length >= 2 && words.length <= 4) score += 2
  if (words.every(w => /^[A-Z]/.test(w))) score += 2
  if (t === t.toUpperCase() && t.length <= 40) score += 1
  if (TITLE_RE.test(t)) score -= 4
  if (looksLikeLocation(t)) score -= 4
  if (isPlaceName(t)) return -10
  if (!looksLikePersonName(t)) return -10
  if (COMPANY_SUFFIX_RE.test(t)) score -= 2
  if (/\b(?:of|and|the|for|with|in|at|to|a|an)\b/i.test(t)) score -= 3
  if (/[,;:|]/.test(t)) score -= 2
  return score
}

function extractName(header: string[]): string {
  const candidates: Array<{ name: string; score: number; idx: number }> = []
  header.slice(0, 10).forEach((raw, idx) => {
    let line = raw
    // "Name: John Smith"
    const labelled = line.match(/^(?:name|full name)\s*(?:[:\-–]\s*|\s+(?=[A-Z]))(.+)$/i)
    if (labelled) line = labelled[1]
    // Name followed by contact on the same line: take the first segment
    const seg = line.split(/\s*[|•·]\s*|\s{2,}|\t/)[0].trim()
    const cleaned = collapseSpacedLetters(seg.replace(/\.(?:pdf|docx?|txt)$/i, '').replace(/[^A-Za-z\s.'’\-]/g, ' ').replace(/\s+/g, ' ').trim())
    if (!cleaned) return
    const score = nameScore(cleaned) - idx * 0.4
    if (score > -10) candidates.push({ name: cleaned, score, idx })
  })
  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx)
  const best = candidates[0]
  if (!best || best.score < 0) return 'Unknown'
  return titleCase(best.name).replace(/\s+/g, ' ').trim()
}

/** Name fallback: the header may be empty when the document opens with a heading such as "CONTACT". */
function extractNameAnywhere(allLines: string[]): string {
  const pool = allLines.slice(0, 20).filter(l => !isHeadingLine(l) && !SECTION_WORD_RE.test(l))
  return extractName(pool)
}

function extractHeadline(header: string[], name: string): string | undefined {
  const nameIdx = header.findIndex(l => l.toLowerCase().includes(name.toLowerCase().split(' ')[0]) && nameScore(l.split(/\s*[|•·]\s*/)[0]) > 0)
  const start = nameIdx >= 0 ? nameIdx + 1 : 0
  for (const raw of header.slice(start, start + 6)) {
    for (const seg of raw.split(/\s*[|•·]\s*/)) {
      const t = stripLabel(seg.trim())
      if (t.length < 4 || t.length > 80) continue
      if (/@|https?:|www\.|\d{4,}/i.test(t)) continue
      if (matchSectionType(t) || SECTION_WORD_RE.test(t)) continue
      if (looksLikeLocation(t)) continue
      if ((t.match(/,/g) || []).length > 1) continue
      if (/\b(?:university|college|institute|school|b\.?tech|m\.?tech|bachelor|master|mba|phd)\b/i.test(t) && !/\bstudent\b/i.test(t)) continue
      if (isTitleLike(t) && !/\b(?:years?|experience|skilled|proficient|expertise|seeking|looking)\b/i.test(t)) return t
    }
  }
  return undefined
}

const HEADER_SEP = /\s*[|•·⋄~¦]\s*|\s{2,}|\t|\s\/\/\s/

function extractLocation(header: string[], allLines: string[]): string | undefined {
  const pool = header.length ? header : allLines.slice(0, 15)
  for (const raw of pool) {
    const cleaned = raw.replace(/^(?:location|address|based in|city)\s*[:\-–]\s*/i, '')
    for (const seg of cleaned.split(HEADER_SEP)) {
      let t = seg.trim().replace(/^[^A-Za-z]+/, '').replace(/\s*\d{5,6}.*$/, '').trim()
      if (t.length < 2 || t.length > 50) continue
      if (/@|https?:|www\./i.test(t)) continue
      if (TITLE_RE.test(t) && !looksLikeLocation(t)) continue
      if (looksLikeLocation(t)) return t.replace(/\s*,\s*/g, ', ')
    }
    // "City, State" embedded in a longer contact line
    const m = cleaned.match(/\b([A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+){0,2}),\s*([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?|[A-Z]{2})\b/)
    if (m && looksLikeLocation(m[0])) return m[0]
  }
  // Explicit label anywhere in the document
  for (const line of allLines.slice(0, 80)) {
    const m = line.match(/^(?:location|address|current location|city)\s*[:\-–]\s*(.{2,60})$/i)
    if (m && !/\d{5,}/.test(m[1])) return m[1].trim()
  }
  return undefined
}

function extractEmail(text: string): string | undefined {
  const m = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/)
  return m?.[0].replace(/\.$/, '')
}

function extractPhone(text: string): string | undefined {
  // Groups after an optional country code / "(area)" prefix: covers "+91 98765 43210",
  // "(240) 385-9013", "+1 (317) 763-2462", "9876543210".
  const candidates = text.match(/(?<![\w])(?:\+\d{1,3}[\s\-.]?)?(?:\(\d{2,5}\)[\s\-.]?)?\d{2,5}(?:[\s\-.]?\d{2,5}){1,3}(?![\w])/g) || []
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 13) continue
    // Reject runs of years ("2019 2021 2023") and year ranges
    if (/^(?:(?:19|20)\d{2}[\s\-.]*){2,}$/.test(c.trim())) continue
    return c.trim()
  }
  return undefined
}

function extractLinkedin(text: string): string | undefined {
  const m = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub|profile)\/[A-Za-z0-9\-_.%+]+(?:\/[A-Za-z0-9\-_.]+)*/i)
  if (m) return m[0].replace(/[).,;]+$/, '')
  const bare = text.match(/\blinkedin\s*[:\-–]\s*([A-Za-z0-9\-_.]{5,})/i)
  return bare ? `linkedin.com/in/${bare[1]}` : undefined
}

function extractGithub(text: string): string | undefined {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9\-_.]+(?:\/[A-Za-z0-9\-_.]+)*/i)
  return m?.[0].replace(/[).,;]+$/, '')
}

function extractPortfolio(text: string): string | undefined {
  const matches = text.match(/https?:\/\/[^\s)]+|(?:www\.)[^\s)]+/gi) || []
  for (const m of matches) {
    const lower = m.toLowerCase()
    if (/linkedin|github|mailto|facebook|twitter|instagram|x\.com|wa\.me|cloudinary/.test(lower)) continue
    return m.replace(/[).,;]+$/, '')
  }
  return undefined
}

// ─── Summary ─────────────────────────────────────────────────

function extractSummary(layout: Layout): string | undefined {
  const lines = sectionLines(layout, 'summary').map(stripBullet).filter(l => l.length > 3)
  if (lines.length) return lines.join(' ').replace(/\s+/g, ' ').slice(0, 1500)
  // Fallback: first prose paragraph in the header or right after it
  const prose = layout.allLines.slice(0, 40).filter(l => l.length > 80 && !/@|https?:/.test(l) && !findRange(l))
  if (prose.length) return prose.slice(0, 3).join(' ').slice(0, 1500)
  return undefined
}

// ─── Skills ──────────────────────────────────────────────────

const SKILL_ENTRIES = Object.keys(SKILL_CATEGORIES)
const SKILL_REGEX = new Map<string, RegExp>()
for (const skill of [...SKILL_ENTRIES, ...Object.keys(SKILL_ALIASES)]) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startsWord = /^[a-z0-9]/i.test(skill)
  const endsWord = /[a-z0-9]$/i.test(skill)
  SKILL_REGEX.set(skill, new RegExp(`${startsWord ? '(?<![a-z0-9])' : ''}${escaped}${endsWord ? '(?![a-z0-9])' : ''}`, 'i'))
}

function canonicalSkill(raw: string): { name: string; category: Skill['category'] } | null {
  const lower = raw.toLowerCase().trim().replace(/\s+/g, ' ')
  const canonical = SKILL_ALIASES[lower] || (SKILL_CATEGORIES[lower] ? lower : null)
  if (!canonical) return null
  const cat = SKILL_CATEGORIES[canonical] || 'other'
  const category = (['language', 'framework', 'tool', 'platform', 'concept'].includes(cat) ? cat : 'other') as Skill['category']
  return { name: canonical, category }
}

function extractSkills(layout: Layout, fullText: string): Skill[] {
  const found = new Map<string, Skill>()
  const add = (raw: string, allowAmbiguous: boolean) => {
    const rawLower = raw.toLowerCase().trim()
    const c = canonicalSkill(raw)
    if (!c) return
    if (!allowAmbiguous && (AMBIGUOUS_SKILLS.has(c.name) || AMBIGUOUS_SKILLS.has(rawLower))) return
    if (!found.has(c.name)) found.set(c.name, { name: c.name, category: c.category })
  }
  const addBusiness = (raw: string) => {
    const lower = raw.toLowerCase().trim().replace(/\s+/g, ' ')
    const hit = BUSINESS_SKILLS.get(lower)
    if (hit && !found.has(hit)) found.set(hit, { name: hit, category: 'other' })
  }
  // Terms from an explicit skills list that are not in either dictionary. Kept separately,
  // filtered hard (prose, places, education lines, adjectives) and capped, because they
  // feed search and matching and a junk term is worse than a missing one.
  const rawFound = new Map<string, Skill>()
  const addRaw = (raw: string) => {
    const t = raw.trim().replace(/\s+/g, ' ').replace(/^[^A-Za-z0-9+#.]+|[^A-Za-z0-9+#)]+$/g, '')
    if (t.length < 3 || t.length > 32) return
    if (/\d{3,}|@|https?:|www\.|—|\.(?:com|in|org)\b/i.test(t)) return
    const words = t.split(' ')
    if (words.length > 3) return
    if (/^(?:and|or|the|with|using|in|of|for|a|an|etc|others?|more|year|years|level|modules?|product|honou?rs?|graduate|w)$/i.test(t)) return
    if (/^(?:skills?|tools?|technologies|languages?|frameworks?|databases?|cloud|platforms?|other|soft skills|technical skills|basic knowledge|key deliverables|responsibilities)$/i.test(t)) return
    // Sentence fragments: start with a verb in past tense / gerund, or contain filler words
    if (/^(?:[a-z]+(?:ed|ing))\b/i.test(words[0]) && !BUSINESS_SKILLS.has(t.toLowerCase())) return
    if (/\b(?:possess|excellent|good|best|expert|strong|dedicated|personable|flexible|motivator|speaker|listener|knowledge of|involved|responsible|w\.r\.t)\b/i.test(t)) return
    if (/\b(?:city|town|district|village|county|province|state|nagar|colony)$/i.test(t)) return
    if (isPlaceName(t) || GAZETTEER.has(t.toLowerCase()) || words.some(w => GAZETTEER.has(w.toLowerCase()) && words.length <= 2)) return
    if (INSTITUTION_RE.test(t) || DEGREE_RE.test(t)) return
    if (/[()]/.test(t) && !/^[^()]*\([^()]*\)$/.test(t)) return
    const name = t.toLowerCase()
    if (!found.has(name) && !rawFound.has(name)) rawFound.set(name, { name, category: 'other' })
  }

  // 1. Explicit skills section: split on list separators; also try "Label: a, b, c"
  for (const line of sectionLines(layout, 'skills')) {
    const content = line.replace(/^[^:]{2,40}:\s*/, m => (/\b(?:skills?|tools?|technologies|languages?|frameworks?|databases?|cloud|platforms?|other)\b/i.test(m) ? '' : m))
    const listLike = /[,;|•●▪▸►/&]/.test(content) || content.trim().split(/\s+/).length <= 5
    for (const part of stripBullet(content).split(/[,;|•●▪▸►/&]|\s{2,}|\band\b|\s[-–—]\s/i)) {
      const p = part.trim().replace(/\(.*?\)/g, '').replace(/[.:]+$/, '').trim()
      if (p.length > 1 && p.length < 45) {
        add(p, true)
        addBusiness(p)
        if (listLike && !canonicalSkill(p) && !BUSINESS_SKILLS.has(p.toLowerCase())) addRaw(p)
      }
      // Multi-word fragments like "Python scripting": scan dictionary inside the fragment
      if (p.length >= 4) {
        for (const [skill, re] of SKILL_REGEX) {
          if (skill.length >= 3 && re.test(p)) add(skill, false)
        }
      }
    }
  }

  // 2. Whole-document dictionary scan (strict word boundaries, no ambiguous words)
  for (const [skill, re] of SKILL_REGEX) {
    if (skill.length < 2) continue
    if (re.test(fullText)) add(skill, false)
  }
  // 3. Business / domain skills anywhere in the document
  for (const [phrase, re] of BUSINESS_SKILL_REGEX) {
    if (re.test(fullText)) addBusiness(phrase)
  }

  return [...found.values(), ...Array.from(rawFound.values()).slice(0, 15)].slice(0, 60)
}

/** Non-technical skills (HR, finance, legal, sales, operations, healthcare, soft skills). */
const BUSINESS_SKILL_LIST = [
  'recruitment', 'talent acquisition', 'sourcing', 'onboarding', 'payroll', 'employee relations', 'employee engagement', 'performance management', 'hr policies', 'hr operations', 'hr generalist', 'compensation and benefits', 'training and development', 'learning and development', 'workforce planning', 'succession planning', 'hris', 'labour law', 'labor law', 'statutory compliance',
  'accounting', 'bookkeeping', 'accounts payable', 'accounts receivable', 'tally', 'tally erp', 'gst', 'taxation', 'tax compliance', 'financial reporting', 'financial analysis', 'financial modeling', 'financial modelling', 'budgeting', 'forecasting', 'auditing', 'internal audit', 'statutory audit', 'reconciliation', 'bank reconciliation', 'invoicing', 'cost accounting', 'ifrs', 'gaap', 'sap fico', 'quickbooks', 'xero', 'zoho books',
  'legal research', 'legal drafting', 'legal writing', 'legal document drafting', 'contract drafting', 'contract review', 'contract drafting & review', 'contract management', 'contract negotiation', 'due diligence', 'litigation', 'arbitration', 'corporate law', 'company law', 'compliance management', 'regulatory compliance', 'intellectual property', 'legal documentation', 'case preparation', 'commercial dispute analysis',
  'sales', 'b2b sales', 'b2c sales', 'inside sales', 'field sales', 'lead generation', 'cold calling', 'negotiation', 'account management', 'key account management', 'client relationship management', 'customer relationship management', 'customer service', 'customer support', 'customer success', 'business development', 'upselling', 'cross-selling', 'sales strategy', 'pipeline management', 'territory management', 'channel sales', 'retail sales',
  'digital marketing', 'content marketing', 'content writing', 'copywriting', 'social media marketing', 'social media management', 'email marketing', 'performance marketing', 'brand management', 'market research', 'product marketing', 'marketing strategy', 'campaign management', 'google analytics', 'influencer marketing', 'public relations', 'event management', 'event planning',
  'project management', 'program management', 'project coordination', 'project planning', 'stakeholder management', 'vendor management', 'risk management', 'change management', 'resource planning', 'pmp', 'prince2', 'waterfall',
  'supply chain', 'supply chain management', 'procurement', 'purchasing', 'logistics', 'inventory management', 'warehouse management', 'operations management', 'production planning', 'quality control', 'quality assurance', 'quality management', 'six sigma', 'lean manufacturing', 'kaizen', '5s', 'iso 9001', 'process improvement', 'root cause analysis', 'kpi tracking',
  'administration', 'office administration', 'administrative support', 'executive assistance', 'calendar management', 'travel management', 'data entry', 'documentation', 'record keeping', 'ms office', 'microsoft office', 'ms excel', 'advanced excel', 'excel', 'ms word', 'powerpoint', 'ms powerpoint', 'outlook', 'google workspace', 'g suite', 'virtual assistance',
  'teaching', 'curriculum development', 'lesson planning', 'classroom management', 'tutoring', 'training delivery', 'mentoring', 'coaching', 'counseling', 'counselling',
  'patient care', 'clinical research', 'clinical documentation', 'nursing', 'phlebotomy', 'medical coding', 'medical billing', 'icd-10', 'pharmacovigilance', 'pharmacy', 'first aid', 'cpr', 'bls', 'acls', 'infection control', 'medication administration', 'electronic health records', 'ehr', 'emr', 'epic', 'cerner',
  'communication', 'communication skills', 'verbal communication', 'written communication', 'presentation skills', 'public speaking', 'leadership', 'team leadership', 'team management', 'team coordination', 'teamwork', 'collaboration', 'problem solving', 'critical thinking', 'analytical skills', 'decision making', 'time management', 'multitasking', 'adaptability', 'attention to detail', 'organizational skills', 'interpersonal skills', 'conflict resolution', 'strategic planning', 'business analysis', 'requirements gathering', 'data analysis', 'reporting', 'mis reporting', 'client coordination', 'cross-functional collaboration',
  'graphic design', 'ui design', 'ux design', 'ui/ux', 'wireframing', 'prototyping', 'adobe photoshop', 'photoshop', 'illustrator', 'adobe illustrator', 'indesign', 'after effects', 'premiere pro', 'canva', 'video editing', 'motion graphics', 'autocad', 'solidworks', 'catia', 'revit', 'sketchup', 'staad pro', 'ansys', 'matlab', 'plc', 'scada', 'embedded systems',
]
const BUSINESS_SKILLS = new Map<string, string>(BUSINESS_SKILL_LIST.map(s => [s, s]))
const BUSINESS_SKILL_REGEX = new Map<string, RegExp>()
for (const phrase of BUSINESS_SKILL_LIST) {
  // Only multi-word or distinctive phrases are scanned across the whole document;
  // single common words (sales, excel, epic...) are accepted only from a skills section.
  if (!phrase.includes(' ') && phrase.length < 9) continue
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  BUSINESS_SKILL_REGEX.set(phrase, new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i'))
}

// ─── Experience ──────────────────────────────────────────────

function classifySegments(segments: string[]): { title?: string; company?: string; location?: string } {
  const out: { title?: string; company?: string; location?: string } = {}
  const leftovers: string[] = []
  for (let seg of segments) {
    seg = seg.trim().replace(/^[,\-–—|:]+|[,\-–—|:]+$/g, '').trim()
    if (!seg || seg.length < 2) continue
    if (findRange(seg) || SINGLE_DATE.test(seg) && seg.replace(SINGLE_DATE, '').trim().length < 3) continue
    if (/^(?:full[-\s]?time|part[-\s]?time|contract|internship|freelance|remote|hybrid|onsite|on-site|w2|c2c|1099)$/i.test(seg)) continue
    if (KNOWN_LANGS.has(seg.toLowerCase())) continue  // a Languages list right above a misfiled job
    if (/^(?:role|title|position|designation)\s*[:\-–]/i.test(seg)) { out.title = out.title || stripLabel(seg); continue }
    if (/^(?:client|company|employer|organi[sz]ation)(?:\s+name)?\s*[:\-–]/i.test(seg)) { out.company = out.company || stripLabel(seg); continue }
    if (looksLikeLocation(seg)) { out.location = out.location || seg; continue }
    if (!out.title && looksLikeTitle(seg)) { out.title = seg; continue }
    if (!out.company && looksLikeCompany(seg)) { out.company = seg; continue }
    leftovers.push(seg)
  }
  for (const seg of leftovers) {
    if (!out.title && isTitleLike(seg) && seg.length <= 90) out.title = seg
    else if (!out.company && seg.length <= 70) out.company = seg
    else if (!out.title && seg.length <= 90) out.title = seg
  }
  return out
}

const PROTECT = '⁣'
function splitSegments(line: string): string[] {
  // "Client Name:  Public Storage": keep a label glued to its value so the column split below
  // (two or more spaces) does not separate them
  line = line.replace(/\b((?:client|company|employer|organi[sz]ation|role|title|position|designation)(?:\s+name)?\s*:)\s+/gi, '$1 ')
  // "(Client: X)" inside a company name becomes its own labelled segment
  const withClients = line.replace(/\(\s*((?:client|customer|end client)\s*[:\-–][^()]*)\)/gi, (_m, inner: string) => ` | ${inner.trim()}`)
  // Keep "City, ST" / "City, Country" together before splitting on commas
  const protectedLine = withClients.replace(
    /([A-Za-z.]+(?:\s[A-Za-z.]+){0,2}),\s*([A-Z]{2}\b|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b)/g,
    (m, a: string, b: string) => (looksLikeLocation(`${a}, ${b}`) ? `${a}${PROTECT}${b}` : m),
  )
  return protectedLine
    .split(/\s*\|\s*|\s{2,}|\t|\s+[–—]\s+|\s+-\s+|\s+at\s+|\s+@\s+|\s*,\s*(?=[A-Z])/)
    .map(s => s.replace(new RegExp(PROTECT, 'g'), ', ').trim().replace(/^[lI]\s+(?=[A-Z])/, ''))
    .filter(Boolean)
}

// Labelled detail lines inside a job that must never be read as its title or company
const NOT_JOB_HEADER_RE = /^(?:environment|technolog(?:y|ies)|tech(?:nical)?\s*stack|tools?(?:\s*(?:&|and)\s*technologies)?|skills?(?:\s+used)?|software|platforms?|reason\s+for\s+leaving|responsibilit(?:y|ies)|duties|achievements?|key\s+achievements|accomplishments|project\s+description|description|reference|salary)\s*[:\-–]/i

// Words that mark a date as a school/education date rather than a job
const EDU_CONTEXT_RE = /\b(?:university|universidad|universidade|college|school|institute|academy|polytechnic|cgpa|gpa|grade|class\s+(?:x|xii|10|12)|cbse|icse|ssc|hsc|board|semester|phd|master'?s|bachelor'?s|degree|graduat|percentage|marks|b\.?\s?tech|m\.?\s?tech|diploma|licenciatura|ingenier[ií]a|elementary|primary|secondary|high\s+school|kindergarten|attainment|matriculation|intermediate|10th|12th)\b/i

// 'Development Tools: Visual Studio' style lines (any label) - except explicit job labels
const LABEL_VALUE_RE = /^(?!(?:role|title|position|designation|client|company|employer|organi[sz]ation)\s*:)[A-Za-z][^:]{1,40}:\s*\S/i

function extractWorkHistory(layout: Layout): WorkHistoryEntry[] {
  let lines = sectionLines(layout, 'experience')
  // Jobs often sit outside the detected Experience section: a "Technologies:" or location line
  // inside a job is mistaken for a new heading, or there is no Experience heading at all.
  // Sections that never hold jobs are excluded; any other section with a real date range is
  // scanned too, as its own block ('' separates blocks so context never crosses them).
  const NEVER_JOBS = new Set(['experience', 'education', 'certifications', 'projects', 'awards', 'languages', 'summary', 'references'])
  // Section detection often files jobs under the wrong heading in designed/two-column resumes
  // (Languages, Awards, Projects, even Education). Every non-Experience section is scanned for
  // date ranges, as small windows (two lines above, one below):
  //   - school dates are always skipped (school/degree/grade words on or next to the line);
  //   - in sections that normally hold no jobs, a window is used only with job evidence
  //     (a job-title word, a company word, or a Client/Company/Role label).
  const OPEN_SECTIONS = new Set(['skills', 'contact', 'other', 'additional'])
  const extraBlocks: string[][] = []
  for (const s of layout.sections) {
    if (s.type === 'experience' || s.type === 'certifications') continue
    s.lines.forEach((l, i) => {
      if (!findRange(l)) return
      // Context above stops at the previous date line, which belongs to the previous job
      let start = Math.max(0, i - 2)
      for (let k = i - 1; k >= start; k--) if (findRange(s.lines[k])) { start = k + 1; break }
      const window = s.lines.slice(start, i + 2)
      const near = [s.lines[i - 1], l, s.lines[i + 1]].filter(Boolean).join(' ')
      if (EDU_CONTEXT_RE.test(near) || DEGREE_RE.test(near) || DEGREE_SHORT_RE.test(near)) return
      if (!OPEN_SECTIONS.has(s.type)) {
        const context = window.map(w => w.replace(findRange(w)?.match || '', ' ')).join(' ')
        if (!(TITLE_NOUN_RE.test(context) || COMPANY_SUFFIX_RE.test(context) || /\b(?:client|company|employer|organi[sz]ation|role|designation|position)\b/i.test(context))) return
      }
      extraBlocks.push(['', ...window])
    })
  }
  const usingFallback = lines.length === 0
  if (usingFallback) {
    const skipLines = new Set(layout.sections.filter(s => NEVER_JOBS.has(s.type)).flatMap(s => s.lines))
    lines = [...layout.allLines.filter(l => !skipLines.has(l) && !layout.header.includes(l)), ...extraBlocks.flat()]
  } else {
    lines = [...lines, ...extraBlocks.flat()]
  }
  const entries: WorkHistoryEntry[] = []
  const consumed = new Set<number>()
  let current: WorkHistoryEntry | null = null
  let pendingContext: string[] = []

  const flush = () => {
    if (current && (current.title || current.company)) {
      if (!current.title) current.title = 'Unknown'
      if (!current.company) current.company = 'Unknown'
      entries.push(current)
    }
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const range = findRange(line)
    if (range) {
      flush()
      // A date glued onto an 'Environment: ...' line belongs to the next job; ignore that text
      const residual = NOT_JOB_HEADER_RE.test(line) ? '' : line.replace(range.match, ' ').replace(/\s*[|,()–—-]\s*$/g, ' ').trim()
      const headerParts: string[] = []
      if (residual.length > 1) headerParts.push(...splitSegments(residual))
      // Previous short lines (title/company often sit above the date line)
      for (let back = 1; back <= 2 && i - back >= 0; back++) {
        const prev = lines[i - back]
        if (!prev || consumed.has(i - back) || isBullet(prev) || findRange(prev) || prev.length > 90 || /[.!?]$/.test(prev) && prev.length > 60 || NOT_JOB_HEADER_RE.test(prev) || LABEL_VALUE_RE.test(prev) || /:\s*$/.test(prev) || /:\s*$/.test(lines[i - back - 1] || '')) break
        if (matchSectionType(prev)) break
        headerParts.unshift(...splitSegments(prev))
        consumed.add(i - back)
      }
      // Next line: an explicit label ("Role: ...", "Client: ...") always applies;
      // otherwise use it only to fill what is still missing.
      let cls = classifySegments(headerParts)
      if (i + 1 < lines.length) {
        const next = lines[i + 1]
        const LABEL = /^(?:role|title|position|designation|client|company|employer|organi[sz]ation)(?:\s+name)?\s*[:\-–]/i
        if (next && LABEL.test(next)) {
          const more = classifySegments([next])
          if (more.title) {
            // The date line's "title" was really the employer when an explicit Role: follows
            if (cls.title && !cls.company && !TITLE_NOUN_RE.test(cls.title)) cls.company = cls.title
            cls.title = more.title
          }
          if (more.company && !cls.company) cls.company = more.company
          consumed.add(i + 1)
          i++
          const after = lines[i + 1]
          if (after && LABEL.test(after)) {
            const m2 = classifySegments([after])
            if (m2.title && (!cls.title || /^(?:role|title|position|designation)/i.test(after))) cls.title = m2.title
            if (m2.company && !cls.company) cls.company = m2.company
            consumed.add(i + 1)
            i++
          }
        } else if ((!cls.title || !cls.company) && next && !isBullet(next) && !findRange(next) && next.length <= 90 && !matchSectionType(next) && !/[.!?]$/.test(next)) {
          const more = classifySegments(splitSegments(next))
          if (more.title || more.company) {
            cls = { title: cls.title || more.title, company: cls.company || more.company, location: cls.location || more.location }
            consumed.add(i + 1)
            i++
          }
        }
      }
      // Context lines collected before the date (used when nothing else was found)
      if (!cls.title && !cls.company && pendingContext.length) {
        cls = classifySegments(pendingContext.flatMap(splitSegments))
      }
      pendingContext = []
      const end = normalizeEnd(range.end)
      current = {
        title: cls.title ? stripLabel(cls.title).replace(/\s+/g, ' ') : '',
        company: cls.company ? stripLabel(cls.company).replace(/\s+/g, ' ').replace(/[,\s]+$/, '') : '',
        from: range.start,
        to: end,
        description: '',
        achievements: [],
        is_current: end === 'Present',
      }
      consumed.add(i)
      continue
    }
    if (current) {
      if (isBullet(line)) current.achievements!.push(stripBullet(line))
      else if (line.length > 25) current.description = (current.description ? current.description + ' ' : '') + line
      else if (!current.title || current.title === 'Unknown') {
        if (looksLikeTitle(line)) current.title = line
      } else if (!current.company || current.company === 'Unknown') {
        if (!/:\s*$/.test(line) && !NOT_JOB_HEADER_RE.test(line) && (looksLikeCompany(line) || (!TITLE_RE.test(line) && line.length <= 60))) current.company = line
      }
    } else if (!isBullet(line) && line.length <= 90 && !NOT_JOB_HEADER_RE.test(line)) {
      pendingContext.push(line)
      if (pendingContext.length > 3) pendingContext.shift()
    }
  }
  flush()

  // Experience section without any date ranges: accept "Company - Title" style lines
  if (entries.length === 0 && !usingFallback) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line || isBullet(line) || line.length > 100 || /[.!?]$/.test(line)) continue
      if (!/\s[|–—-]\s|\s+at\s+|^(?:client|company|employer)\s*[:\-–]/i.test(line)) continue
      const cls = classifySegments(splitSegments(line))
      if (!cls.title && !cls.company) continue
      const entry: WorkHistoryEntry = {
        title: cls.title ? stripLabel(cls.title) : 'Unknown',
        company: cls.company ? stripLabel(cls.company) : 'Unknown',
        description: '',
        achievements: [],
        is_current: false,
      }
      for (let j = i + 1; j < lines.length && j < i + 12; j++) {
        const l = lines[j]
        if (!l || (!isBullet(l) && l.length <= 100 && /\s[|–—-]\s/.test(l))) break
        if (isBullet(l)) entry.achievements!.push(stripBullet(l))
        else if (l.length > 25) entry.description = (entry.description ? entry.description + ' ' : '') + l
      }
      entries.push(entry)
    }
  }

  // Dedupe (same company + title) and drop junk
  const seen = new Set<string>()
  const result: WorkHistoryEntry[] = []
  for (const e of entries) {
    e.title = stripLabel(e.title)
    e.company = stripLabel(e.company)
    if (e.company === 'Unknown' && e.title === 'Unknown') continue
    if (e.description && e.description.length > 1500) e.description = e.description.slice(0, 1500)
    const key = `${e.company.toLowerCase()}|${e.title.toLowerCase()}|${e.from}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(e)
  }
  return result.slice(0, 12)
}

// ─── Education ───────────────────────────────────────────────

// Case-insensitive degree words. Two-letter abbreviations (BE, MS, BA...) are handled
// separately with case sensitivity so that "be", "me" and "ms" in prose do not match.
const DEGREE_RE = /\b(?:bachelor(?:'s|s)?(?:\s+of\s+[a-z]+(?:\s+[a-z]+)?)?|master(?:'s|s)?(?:\s+of\s+[a-z]+(?:\s+[a-z]+)?)?|b\.?\s?tech|m\.?\s?tech|b\.?\s?sc|m\.?\s?sc|bca|mca|mba|pgdm|pgdba|bba|b\.?\s?com|m\.?\s?com|ll\.?\s?b|ll\.?\s?m|b\.?\s?ed|m\.?\s?ed|b\.?\s?pharm|m\.?\s?pharm|mbbs|bds|b\.?\s?arch|m\.?\s?arch|ph\.?\s?d|doctorate|diploma|associate(?:'s)?\s+degree|post\s*graduat(?:e|ion)|under\s*graduat(?:e|ion)|higher\s+secondary|senior\s+secondary|secondary\s+school|hsc|ssc|sslc|cbse|icse|12th|10th|xii|high\s+school(?:\s+diploma)?|ged|bs\/ms|b\.?\s?des|m\.?\s?des|bfa|mfa|bhm|gnm|anm)\b/i
const DEGREE_SHORT_RE = /\b(?:B\.\s?E\.?|M\.\s?E\.?|B\.\s?A\.?|M\.\s?A\.?|B\.\s?S\.?|M\.\s?S\.?|M\.?D\.?|BE|ME|BA|MA|BS|MS|BTech|MTech|BSc|MSc)(?=\s*(?:\(|in\b|of\b|from\b|[-–,/|:])|\s*$)/
const INSTITUTION_RE = /\b(?:university|universit[yi]|college|institute|institution|school|academy|polytechnic|iit|nit|iiit|bits|vit|iim|xlri|isb|jntu[hka]?|vtu|srm|kiit|lpu|amity|manipal|symbiosis|osmania|faculty|campus|vidyalaya|vidhyalaya|gymnasium|lyceum|conservatory|seminary|board)\b/i
/** Lines such as "College Captain" mention an institution word without naming an institution. */
function namesAnInstitution(line: string): boolean {
  const m = line.match(INSTITUTION_RE)
  if (!m) return false
  const before = line.slice(0, m.index).trim()
  const after = line.slice((m.index || 0) + m[0].length).trim()
  // Something capitalised must precede the keyword ("Lloyd Law College") or follow "of" ("University of Delhi")
  return /[A-Z][A-Za-z.&'-]+\s*$/.test(before) || /^(?:of|for)\s+[A-Z]/.test(after) || /^(?:,|\s*-|\s*–)/.test(after)
}

const hasDegree = (line: string) => DEGREE_RE.test(line) || DEGREE_SHORT_RE.test(line)
const isProse = (line: string) => line.length > 140 || (/[.!?]$/.test(line) && line.split(/\s+/).length > 14)

function extractEducation(layout: Layout): Education[] {
  let lines = sectionLines(layout, 'education').map(stripBullet).filter(l => !isProse(l))
  const fallback = lines.length === 0
  if (fallback) {
    // No usable education section: scan the document, but require a named institution
    // or a degree with a year so that summary or achievement lines are not mistaken for entries.
    const otherSections = new Set(['awards', 'summary', 'skills', 'projects', 'languages', 'certifications', 'references', 'additional', 'contact'])
    const excluded = new Set(layout.sections.filter(s => otherSections.has(s.type)).flatMap(s => s.lines))
    lines = layout.allLines
      .filter(l => !excluded.has(l) && !isBullet(l) && !isProse(l) && (namesAnInstitution(l) || (hasDegree(l) && /\b(?:19|20)\d{2}\b/.test(l))))
      .slice(0, 20)
  }
  const entries: Education[] = []
  const used = new Set<number>()

  const schoolFrom = (line: string): string | undefined => {
    const fromMatch = line.match(/\b(?:from|at)\s+([A-Z][^,|(]{3,90}?)(?=\s*(?:[,|(.]|\bin\b\s+\d{4}|\d{4}|$))/)
    let seg = fromMatch?.[1]
    if (!seg || !INSTITUTION_RE.test(seg)) {
      seg = splitSegments(line).find(s => INSTITUTION_RE.test(s) && !hasDegree(s.replace(INSTITUTION_RE, '')))
        || splitSegments(line).find(s => INSTITUTION_RE.test(s))
    }
    if (!seg) return undefined
    const cleaned = seg
      .replace(/\(?\b(?:19|20)\d{2}(?:\s*[-–—]\s*(?:(?:19|20)\d{2}|present))?\)?/gi, '')
      .replace(/\b(?:cgpa|gpa|percentage|grade|marks?)\b.*$/i, '')
      .replace(/^(?:from|at)\s+/i, '')
      .replace(/[.,\-–—|:\s]+$/, '')
      .trim()
    if (!cleaned || cleaned.length > 90 || cleaned.split(/\s+/).length > 10) return undefined
    return cleaned
  }
  const degreeFrom = (line: string): { degree?: string; field?: string } => {
    const m = line.match(DEGREE_RE) || line.match(DEGREE_SHORT_RE)
    if (!m) return {}
    let degree = m[0].trim()
    const after = line.slice((m.index || 0) + m[0].length)
    const field = after.match(/^\s*(?:\(|in|of|[-–:,])?\s*([A-Za-z][A-Za-z&\s]{2,50}?)(?=\s*(?:[,|()–—\-]|\b(?:from|at|with)\b|\d{4}|$))/i)
    let fieldStr = field?.[1]?.trim()
    if (fieldStr && (INSTITUTION_RE.test(fieldStr) || /\bfrom\b/i.test(fieldStr))) fieldStr = undefined
    if (fieldStr && /^(?:in|of)\s/i.test(fieldStr)) fieldStr = fieldStr.replace(/^(?:in|of)\s+/i, '')
    const specialization = line.match(/\((?:hons?\.?|honou?rs|hr|finance|marketing|cs|it)\)/i)?.[0]
    if (specialization) degree = `${degree} ${specialization}`
    return { degree, field: fieldStr }
  }
  const yearFrom = (line: string): string | undefined => {
    const r = line.match(/\b((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2}|present|current|ongoing|pursuing)\b/i)
    if (r) return `${r[1]}-${/^\d/.test(r[2]) ? r[2] : 'Present'}`
    const y = line.match(/\b((?:19|20)\d{2})\b/)
    return y?.[1]
  }
  const gpaFrom = (line: string): string | undefined => line.match(/\b(?:cgpa|gpa|percentage|grade|marks?|score)\s*[:\-–]?\s*(\d{1,2}(?:\.\d{1,2})?\s*%?(?:\s*\/\s*\d{1,2})?)/i)?.[1]?.trim()

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const line = lines[i]
    const lineHasDegree = hasDegree(line)
    const hasInst = INSTITUTION_RE.test(line)
    if (!lineHasDegree && !hasInst) continue
    let school = hasInst ? schoolFrom(line) : undefined
    let { degree, field } = lineHasDegree ? degreeFrom(line) : {}
    let year = yearFrom(line)
    let gpa = gpaFrom(line)
    // Pair with neighbouring lines (window of 2 either side); never pair in fallback mode
    if (!fallback) {
      for (const j of [i + 1, i - 1, i + 2, i - 2]) {
        if (j < 0 || j >= lines.length || used.has(j)) continue
        const other = lines[j]
        if (!other || isProse(other)) continue
        if (!school && INSTITUTION_RE.test(other) && !(hasDegree(other) && !lineHasDegree && j > i)) { school = schoolFrom(other); used.add(j) }
        else if (!degree && hasDegree(other) && !INSTITUTION_RE.test(other)) { ({ degree, field } = degreeFrom(other)); used.add(j) }
        if (!year) year = yearFrom(other)
        if (!gpa) gpa = gpaFrom(other)
        if (school && degree) break
      }
    }
    used.add(i)
    if (!school && !degree) continue
    if (fallback && !school) continue
    if (school && school.length < 3) school = undefined
    entries.push({ school: school || 'Unknown', degree, field, year, gpa })
  }
  // Dedupe; drop entries whose "school" is just a generic word or equals the degree
  const seen = new Set<string>()
  return entries.filter(e => {
    const schoolLower = e.school.toLowerCase()
    if (e.school !== 'Unknown' && (schoolLower === (e.degree || '').toLowerCase() || /^(?:high school|school|college|university|institute|board)$/i.test(e.school))) return false
    const k = `${schoolLower}|${(e.degree || '').toLowerCase()}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).slice(0, 6)
}

/** Diagnostics: how the parser segmented a document. Used by scripts/benchmark-parsers.ts. */
export function analyzeLayout(text: string, docSections?: DocSection[]): { header: string[]; sections: Array<{ type: string; lines: number; sample: string[] }> } {
  const normalizedText = text.replace(/\r\n?/g, '\n')
  const layout = docSections && docSections.length > 0
    ? layoutFromDocSections(normalizedText, docSections)
    : layoutFromLines(splitLines(normalizedText))
  return {
    header: layout.header,
    sections: layout.sections.map(s => ({ type: s.type, lines: s.lines.length, sample: s.lines.slice(0, 3).map(l => l.slice(0, 80)) })),
  }
}

// ─── Experience years ────────────────────────────────────────

function explicitYears(text: string): number | undefined {
  const patterns = [
    /(\d{1,2}(?:\.\d)?)[\s\-]*\+?[\s\-]*(?:years?|yrs?)(?:\s+(?:of|in))?\s+(?:[a-z\s,&\/-]{0,40}?)?(?:experience|exp\b|industry|career)/i,
    /(?:experience|exp)\s*(?:of|:)?\s*(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/i,
    /(?:over|more than|nearly|around|about|almost)\s+(\d{1,2})\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*[-–to]+\s*(\d{1,2})\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)/i,
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      const a = parseFloat(m[1])
      const b = m[2] ? parseFloat(m[2]) : undefined
      const v = b ? (a + b) / 2 : a
      if (v > 0 && v <= 50) return Math.round(v)
    }
  }
  return undefined
}

function yearsFromHistory(work: WorkHistoryEntry[]): number | undefined {
  const intervals: Array<[number, number]> = []
  for (const w of work) {
    const s = parseDate(w.from || '')
    const e = parseDate(w.to || '')
    if (!s || !e || e < s) continue
    intervals.push([s.getTime(), Math.min(e.getTime(), Date.now())])
  }
  if (!intervals.length) return undefined
  intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let [cs, ce] = intervals[0]
  for (const [s, e] of intervals.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e)
    else { total += ce - cs; cs = s; ce = e }
  }
  total += ce - cs
  const years = total / (365.25 * 24 * 3600 * 1000)
  if (years < 0.2) return undefined
  return Math.min(45, Math.round(years * 10) / 10)
}

// ─── Projects / certifications / languages ──────────────────

function extractProjects(layout: Layout): Project[] {
  const lines = sectionLines(layout, 'projects')
  const entries: Project[] = []
  let current: Project | null = null
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const bullet = isBullet(line)
    if (!bullet && line.length <= 90 && !/[.!?]$/.test(line) && !/^(?:tech(?:nologies)?|tools?|stack)\s*[:\-–]/i.test(line)) {
      if (current) entries.push(current)
      const [name, ...rest] = line.split(/\s*[-–—|:]\s+/)
      current = { name: name.trim().slice(0, 80), description: rest.join(' ').trim() || undefined, tech: [] }
    } else if (current) {
      const content = stripBullet(line)
      const techMatch = content.match(/^(?:tech(?:nologies)?|tools?|stack|environment|built with)\s*[:\-–]\s*(.+)$/i)
      if (techMatch) current.tech = techMatch[1].split(/[,|\/]/).map(t => t.trim()).filter(Boolean).slice(0, 12)
      else current.description = ((current.description || '') + ' ' + content).trim().slice(0, 600)
    } else {
      current = { name: stripBullet(line).slice(0, 80), description: undefined, tech: [] }
    }
  }
  if (current) entries.push(current)
  for (const p of entries) {
    if (!p.tech?.length) {
      const text = `${p.name} ${p.description || ''}`
      p.tech = Array.from(SKILL_REGEX).filter(([s, re]) => s.length >= 3 && !AMBIGUOUS_SKILLS.has(s) && re.test(text)).map(([s]) => SKILL_ALIASES[s] || s).slice(0, 10)
    }
  }
  return entries.filter(p => p.name.length > 2).slice(0, 8)
}

function extractCertifications(layout: Layout): Certification[] {
  const lines = sectionLines(layout, 'certifications').map(stripBullet).filter(l => l.length > 3)
  const out: Certification[] = []
  for (const line of lines) {
    const year = line.match(/\b((?:19|20)\d{2})\b/)?.[1]
    const parts = line.replace(/\(?\b(?:19|20)\d{2}\)?/g, '').split(/\s*[|–—]\s*|\s+-\s+|\s*,\s*(?=[A-Z])|\s+(?:by|from|issued by)\s+/i).map(p => p.trim()).filter(Boolean)
    if (!parts.length) continue
    out.push({ name: parts[0].replace(/[:\-–,\s]+$/, '').slice(0, 120), issuer: parts[1]?.slice(0, 80), year })
  }
  return out.slice(0, 10)
}

const KNOWN_LANGS = new Set(['english', 'hindi', 'marathi', 'tamil', 'telugu', 'kannada', 'malayalam', 'gujarati', 'bengali', 'punjabi', 'urdu', 'odia', 'assamese', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'russian', 'chinese', 'mandarin', 'cantonese', 'japanese', 'korean', 'arabic', 'hebrew', 'turkish', 'polish', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'czech', 'hungarian', 'romanian', 'thai', 'vietnamese', 'indonesian', 'malay', 'tagalog', 'filipino', 'swahili', 'afrikaans', 'nepali', 'sinhala', 'persian', 'farsi', 'ukrainian'])

function extractLanguages(layout: Layout): Language[] {
  const lines = sectionLines(layout, 'languages').map(stripBullet)
  const out: Language[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    for (const part of line.split(/[,;|•/]|\sand\s/i)) {
      const m = part.trim().match(/^([A-Za-z]+)(?:\s*[\-–:(]\s*([A-Za-z\s]+)\)?)?/)
      if (!m) continue
      const name = m[1].toLowerCase()
      if (!KNOWN_LANGS.has(name) || seen.has(name)) continue
      seen.add(name)
      out.push({ name: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), proficiency: m[2]?.trim() || undefined })
    }
  }
  return out.slice(0, 10)
}

// ─── Main ────────────────────────────────────────────────────

const CONTACT_LABEL_RE = /(?<=\S)\s*(?=(?:e-?mail|phone|mobile|mob|ph\.?\s*no|tel|contact|linkedin|github|address|location)\s*[:.])/gi
const GLUED_TITLE_RE = /([a-z])(?=Sr\.|Jr\.|(?:Senior|Junior|Lead|Principal|Staff|Chief|Head)\b|(?:Software|Data|Java|Python|Full\s?[Ss]tack|Front\s?[Ee]nd|Back\s?[Ee]nd|DevOps|Cloud|QA|Business|Project|Product|Program|Sales|Marketing|HR)\s+[A-Za-z.]*\s*(?:Engineer|Developer|Analyst|Manager|Architect|Consultant|Specialist|Lead|Scientist|Administrator|Executive|Recruiter))/g

/**
 * Some DOCX/PDF extractors drop the breaks between text boxes, producing a header like
 * "Jane DoeSr. Data EngineerEmail: jane@x.comPhone: 555...". Split such lines at contact
 * labels and at a job title glued onto the previous word. Only the first lines are touched.
 */
function unglueHeader(text: string): string {
  const lines = text.split('\n')
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i]
    if (line.length < 30) continue
    lines[i] = line.replace(CONTACT_LABEL_RE, '\n').replace(GLUED_TITLE_RE, '$1\n')
  }
  return lines.join('\n')
}

export function parseResumeDeterministic(text: string, docSections?: DocSection[]): ParsedCandidate {
  const normalizedText = unglueHeader(text.replace(/\r\n?/g, '\n'))
  const layout = docSections && docSections.length > 0
    ? layoutFromDocSections(normalizedText, docSections)
    : layoutFromLines(splitLines(normalizedText))

  const headerText = layout.header.join('\n')
  const headerName = extractName(layout.header)
  const name = headerName === 'Unknown' ? extractNameAnywhere(layout.allLines) : headerName
  const headline = extractHeadline(layout.header, name)
  const location = extractLocation(layout.header, layout.allLines)
  const contactScope = headerText + '\n' + sectionLines(layout, 'contact').join('\n') + '\n' + normalizedText.slice(0, 3000)

  const work_history = extractWorkHistory(layout)
  const education = extractEducation(layout)
  const skills = extractSkills(layout, normalizedText)
  const summary = extractSummary(layout)

  const experience_years = explicitYears([summary || '', headerText, normalizedText.slice(0, 4000)].join('\n')) ?? yearsFromHistory(work_history)

  return {
    name,
    email: extractEmail(contactScope) || extractEmail(normalizedText),
    phone: extractPhone(contactScope) || extractPhone(normalizedText),
    linkedin_url: extractLinkedin(normalizedText),
    github_url: extractGithub(normalizedText),
    portfolio_url: extractPortfolio(headerText),
    headline,
    location,
    summary,
    experience_years,
    skills,
    companies: work_history.map<Company>(w => ({ name: w.company, title: w.title, from: w.from, to: w.to })),
    work_history,
    education,
    projects: extractProjects(layout),
    certifications: extractCertifications(layout),
    languages: extractLanguages(layout),
  }
}
