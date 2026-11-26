/**
 * Parser accuracy against recruiter-entered Zoho data (Candidate_info CSVs) for imported resumes.
 * Re-parses the stored resume text with the deterministic parser ALONE (no CSV merge) and compares.
 * Read-only.
 *
 *   npx tsx scripts/measure-accuracy.ts [--sample 200]
 */
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env') })

const i = process.argv.indexOf('--sample')
const SAMPLE = i >= 0 ? parseInt(process.argv[i + 1], 10) : 200

const norm = (s?: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const digits = (s?: string) => (s || '').replace(/\D/g, '').slice(-10)

async function main() {
  const { pool } = await import('../src/db/index.js')
  const { fetchFromCloudinary } = await import('../src/services/cloudinary.js')
  const { parseResumeOffline } = await import('../src/parsers/resume-parser.js')
  const { parseInfoCsv } = await import('../src/services/zoho-candidate-info.js')

  const { rows } = await pool.query(
    `SELECT c.raw_text, info.secure_url AS info_url
     FROM resume_import_items r
     JOIN candidates c ON c.id = r.candidate_id
     JOIN resume_import_items info ON info.kind = 'info' AND info.record_id = r.record_id
     WHERE r.kind = 'resume' AND r.status = 'imported' AND COALESCE(c.raw_text, '') <> ''
     ORDER BY random() LIMIT $1`, [SAMPLE])

  const t = { n: 0, nameExact: 0, nameFirst: 0, emailHave: 0, emailOk: 0, emailFound: 0, phoneHave: 0, phoneOk: 0, phoneFound: 0,
    titleHave: 0, titleOk: 0, employerHave: 0, employerOk: 0, yearsHave: 0, yearsWithin1: 0, yearsWithin2: 0, yearsFound: 0,
    skillsHave: 0, skillRecallSum: 0, workAny: 0, eduAny: 0 }
  const misses: string[] = []

  for (const row of rows) {
    let csv: Record<string, string> | null = null
    try { csv = parseInfoCsv((await fetchFromCloudinary(row.info_url)).toString('utf8')) } catch { continue }
    if (!csv) continue
    const p = parseResumeOffline(row.raw_text)
    t.n++

    const truthName = norm([csv.First_Name, csv.Last_Name].join(' '))
    const gotName = norm(p.name)
    if (gotName && gotName === truthName) t.nameExact++
    if (gotName && norm(csv.First_Name) && gotName.split(' ').includes(norm(csv.First_Name).split(' ')[0])) t.nameFirst++
    else if (misses.length < 12) misses.push(`name: "${p.name}" vs Zoho "${csv.First_Name} ${csv.Last_Name}"`)

    if (csv.Email) { t.emailHave++; if (p.email) t.emailFound++; if (norm(p.email) === norm(csv.Email)) t.emailOk++ }
    if (digits(csv.Phone).length === 10) { t.phoneHave++; if (p.phone) t.phoneFound++; if (digits(p.phone) === digits(csv.Phone)) t.phoneOk++ }

    const titles = [p.headline, ...p.work_history.slice(0, 2).map(w => w.title)].map(norm).filter(Boolean)
    if (csv.Current_Job_Title) {
      t.titleHave++
      const truth = norm(csv.Current_Job_Title)
      if (titles.some(x => x.includes(truth) || truth.includes(x))) t.titleOk++
    }
    if (csv.Current_Employer) {
      t.employerHave++
      const truth = norm(csv.Current_Employer).split(' ').slice(0, 2).join(' ')
      if (p.work_history.slice(0, 3).some(w => norm(w.company).includes(truth))) t.employerOk++
    }
    const years = parseFloat(csv.Experience_in_Years)
    if (Number.isFinite(years) && years > 0) {
      t.yearsHave++
      if (p.experience_years) {
        t.yearsFound++
        const d = Math.abs(p.experience_years - years)
        if (d <= 1) t.yearsWithin1++
        if (d <= 2) t.yearsWithin2++
      }
    }
    const truthSkills = (csv.Skill_Set || '').split(/[,;|]/).map(norm).filter(s => s.length > 1)
    if (truthSkills.length) {
      t.skillsHave++
      const got = new Set(p.skills.map(s => norm(s.name)))
      const gotText = [...got].join(' | ')
      const hit = truthSkills.filter(s => got.has(s) || gotText.includes(s)).length
      t.skillRecallSum += hit / truthSkills.length
    }
    if (p.work_history.length) t.workAny++
    if (p.education.length) t.eduAny++
  }

  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a')
  console.log(`\nParser-only accuracy vs Zoho recruiter data, ${t.n} imported resumes\n`)
  console.table({
    'Name (first name matches)': { result: pct(t.nameFirst, t.n), compared: t.n },
    'Name (full name exact)': { result: pct(t.nameExact, t.n), compared: t.n },
    'Email correct': { result: pct(t.emailOk, t.emailHave), compared: t.emailHave },
    'Phone correct': { result: pct(t.phoneOk, t.phoneHave), compared: t.phoneHave },
    'Current title found': { result: pct(t.titleOk, t.titleHave), compared: t.titleHave },
    'Current employer found': { result: pct(t.employerOk, t.employerHave), compared: t.employerHave },
    'Years of experience (±1 yr)': { result: pct(t.yearsWithin1, t.yearsHave), compared: t.yearsHave },
    'Years of experience (±2 yrs)': { result: pct(t.yearsWithin2, t.yearsHave), compared: t.yearsHave },
    'Zoho skills found (avg recall)': { result: pct(t.skillRecallSum, t.skillsHave), compared: t.skillsHave },
    'Has work history': { result: pct(t.workAny, t.n), compared: t.n },
    'Has education': { result: pct(t.eduAny, t.n), compared: t.n },
  })
  if (misses.length) console.log('Name misses (sample):\n  ' + misses.join('\n  '))
  await pool.end()
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
