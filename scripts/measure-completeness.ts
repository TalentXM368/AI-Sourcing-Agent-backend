/**
 * Completeness audit: for each saved resume profile, check that what the resume text contains
 * actually made it into the profile (not just "is the quality score high").
 *
 *   npx tsx scripts/measure-completeness.ts [--source import|recovery|all] [--sample 300]
 *
 * Per resume, each applicable check passes or fails:
 *   jobs           every distinct dated range outside the education block -> a work_history entry
 *   education      degree lines in the text -> education entries
 *   email / phone  present in text -> captured
 *   skills         text has a skills section -> at least 5 skills
 *   summary / projects / certifications   section heading present -> field filled
 * Completeness = passed / applicable. Read-only.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const SOURCE = arg('source', 'all')
const SAMPLE = parseInt(arg('sample', '300'), 10)
const REPARSE = process.argv.includes('--reparse')
const SEED = parseFloat(arg('seed', '0.42'))

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?'
const POINT = `(?:${MONTH}\\s*'?\\s*\\d{2,4}|\\d{1,2}\\s*[/\\-.]\\s*(?:19|20)\\d{2}|(?:19|20)\\d{2})`
const END = `(?:${POINT}|present|current|till\\s+date|to\\s+date|now|ongoing|today)`
const RANGE_RE = new RegExp(`${POINT}\\s*(?:-|–|—|to|until|till)\\s*${END}`, 'gi')
// Strict: real degree mentions only ("MS Office", "Vendor Master data", "MS CRM" are not degrees)
const DEGREE_LINE_RE = /\b(?:bachelor(?:'?s)?\s+(?:of|in|degree)|bachelor's|master(?:'?s)?\s+(?:of|in|degree)|master's|b\.\s?tech|btech|m\.\s?tech|mtech|b\.e\.|m\.e\.|b\.\s?sc|bsc|m\.\s?sc|msc|bca|mca|mba|b\.\s?com|m\.\s?com|ph\.?\s?d|b\.a\.|m\.a\.|b\.s\.|m\.s\.|(?:bs|ms)\s+(?:in|of)\s|llb|b\.\s?pharm|associate(?:'s)?\s+degree|high school diploma|post\s*graduat)/i
const EDU_CONTEXT_RE = /\b(?:university|universidad|college|school|institute|academy|cgpa|gpa|grade|class\s+(?:x|xii|10|12)|cbse|icse|board|semester|phd|master'?s|bachelor'?s|degree|graduat|percentage|marks)\b/i
const EDU_HEAD =/^\s*(?:education|academic|qualification|scholastic|educational)/i
const SECTION_HEAD = (words: string) => new RegExp(`^\\s*(?:${words})\\b[^\\n]{0,30}$`, 'im')

function audit(text: string, p: any) {
  const lines = text.split(/\r?\n/)
  // Ranges outside the education block (a block starts at an education heading, ends at the next short all-caps/heading line)
  let inEdu = false
  const jobRanges = new Set<string>()
  for (const line of lines) {
    const t = line.trim()
    if (EDU_HEAD.test(t) && t.length < 40) { inEdu = true; continue }
    if (inEdu && t.length > 0 && t.length < 40 && /^[A-Z][A-Z &/]{3,}$/.test(t) && !EDU_HEAD.test(t)) inEdu = false
    // Education/school dates are not jobs: skip date lines on or right after a degree/school/grade line
    const prevLine = (lines[lines.indexOf(line) - 1] || '').trim()
    if (inEdu || DEGREE_LINE_RE.test(t) || EDU_CONTEXT_RE.test(t) || EDU_CONTEXT_RE.test(prevLine) || DEGREE_LINE_RE.test(prevLine)) continue
    for (const m of t.matchAll(RANGE_RE)) jobRanges.add(m[0].toLowerCase().replace(/\s+/g, ' '))
  }
  const degreeLines = lines.filter(l => DEGREE_LINE_RE.test(l) && l.trim().length < 160).length

  const checks: Record<string, boolean | null> = {
    jobs: jobRanges.size ? (p.work_history?.length || 0) >= Math.min(jobRanges.size, 12) : null,
    education: degreeLines ? (p.education?.length || 0) >= Math.min(degreeLines, 2) : null,
    email: /[\w.+-]+@[\w-]+\.[\w.]+/.test(text) ? Boolean(p.email) : null,
    phone: /(?:\+?\d[\d\s().-]{8,}\d)/.test(text) ? Boolean(p.phone) : null,
    skills: SECTION_HEAD('(?:technical\\s+|key\\s+|core\\s+)?skills?|skill\\s*set|technologies|competenc').test(text) ? (p.skills?.length || 0) >= 5 : null,
    summary: SECTION_HEAD('(?:professional\\s+)?summary|profile|objective|about\\s+me').test(text) ? Boolean(p.summary) : null,
    projects: SECTION_HEAD('(?:academic\\s+|key\\s+|personal\\s+)?projects?').test(text) ? (p.projects?.length || 0) > 0 : null,
    certifications: SECTION_HEAD('certifications?|certificates?|licen[cs]es').test(text) ? (p.certifications?.length || 0) > 0 : null,
  }
  const applicable = Object.values(checks).filter(v => v !== null) as boolean[]
  const score = applicable.length ? applicable.filter(Boolean).length / applicable.length : 1
  return { checks, score, expectedJobs: jobRanges.size, gotJobs: p.work_history?.length || 0, degreeLines, gotEdu: p.education?.length || 0 }
}

async function main() {
  const { pool } = await import('../src/db/index.js')
  const { parseResumeOffline } = await import('../src/parsers/resume-parser.js')
  const sourceFilter = SOURCE === 'import'
    ? `c.id IN (SELECT candidate_id FROM resume_import_items WHERE status IN ('imported','merged'))`
    : SOURCE === 'recovery'
      ? `c.id IN (SELECT resume_id FROM resume_parse_runs WHERE status IN ('success','partial'))`
      : `c.source = 'resume'`
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.raw_text, c.work_history, c.education, c.email, c.phone, c.skills, c.summary, c.projects, c.certifications, c.data_quality_score
     FROM candidates c WHERE ${sourceFilter} AND COALESCE(c.raw_text, '') <> '' AND c.parse_status = 'completed'
     ORDER BY md5(c.id::text || $2) LIMIT $1`, [SAMPLE, String(SEED)])

  const fields = ['jobs', 'education', 'email', 'phone', 'skills', 'summary', 'projects', 'certifications']
  const per: Record<string, { pass: number; total: number }> = Object.fromEntries(fields.map(f => [f, { pass: 0, total: 0 }]))
  const buckets = { 'complete (100%)': 0, '80-99%': 0, '60-79%': 0, 'below 60%': 0 }
  const worst: Array<{ name: string; score: number; missed: string; jobs: string; edu: string }> = []
  let sum = 0
  for (const r of rows) {
    // --reparse: audit what the CURRENT parser produces from the same text (no Zoho merge)
    const profile = REPARSE ? parseResumeOffline(r.raw_text) : r
    const a = audit(r.raw_text, profile)
    sum += a.score
    for (const f of fields) {
      const v = a.checks[f]
      if (v === null) continue
      per[f].total++
      if (v) per[f].pass++
    }
    if (a.score === 1) buckets['complete (100%)']++
    else if (a.score >= 0.8) buckets['80-99%']++
    else if (a.score >= 0.6) buckets['60-79%']++
    else buckets['below 60%']++
    worst.push({
      name: String(r.name).slice(0, 26), score: Math.round(a.score * 100),
      missed: fields.filter(f => a.checks[f] === false).join(', '),
      jobs: `${a.gotJobs}/${a.expectedJobs}`, edu: `${a.gotEdu}/${a.degreeLines}`,
    })
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a')
  console.log(`\nCompleteness of ${REPARSE ? 'CURRENT parser output' : 'saved profiles'} vs their own resume text (${SOURCE}, ${rows.length} resumes, parse_status=completed)`)
  console.log(`Average completeness: ${pct(sum, rows.length)}\n`)
  console.table(Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { resumes: v, share: pct(v, rows.length) }])))
  console.table(Object.fromEntries(fields.map(f => [f, { captured: pct(per[f].pass, per[f].total), applicable: per[f].total }])))
  console.log('Lowest completeness (jobs = captured/dated ranges in text, edu = captured/degree lines):')
  console.table(worst.sort((a, b) => a.score - b.score).slice(0, 12))
  await pool.end()
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
