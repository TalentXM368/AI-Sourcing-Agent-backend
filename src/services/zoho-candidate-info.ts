/**
 * Zoho Recruit Candidate_info CSV helpers (one CSV per candidate, exported next to each resume).
 */

/** "KRANTHI MINKURI" -> "Kranthi Minkuri"; "Sandeep Sandeep" -> "Sandeep"; keeps initials ("Nagarjun K"). */
export function tidyName(name: string): string {
  if (!name || name === 'Unknown') return name
  let words = name.replace(/\s+/g, ' ').trim().split(' ')
  words = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase())
  return words.map(w => (w === w.toUpperCase() && w.replace(/[^A-Za-z]/g, '').length > 2
    ? w.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
    : w)).join(' ')
}

/** One-row Zoho export: header line + one record; fields may be quoted with embedded commas. */
export function parseInfoCsv(content: string): Record<string, string> | null {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const text = content.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f.trim())) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(f => f.trim())) rows.push(row)
  if (rows.length < 2) return null
  const out: Record<string, string> = {}
  rows[0].forEach((h, i) => { out[h.trim()] = (rows[1][i] || '').trim() })
  return out
}

/**
 * Merge recruiter-entered Zoho fields into a parsed resume. Zoho wins for name, email and phone
 * (entered by recruiters, not guessed from layout); the resume keeps work history, education,
 * projects and summary. Zoho skills are added to the parsed skills.
 */
export function mergeInfo(parsed: any, info: Record<string, string>, isName: (s: string) => boolean) {
  const fullName = [info.First_Name, info.Last_Name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  if (fullName && isName(fullName)) parsed.name = fullName
  if (/@/.test(info.Email || '')) parsed.email = info.Email.trim()
  if ((info.Phone || '').replace(/\D/g, '').length >= 10) parsed.phone = info.Phone.trim()
  if (!parsed.headline && info.Current_Job_Title) parsed.headline = info.Current_Job_Title
  const years = parseFloat(info.Experience_in_Years || '')
  if (!parsed.experience_years && Number.isFinite(years) && years > 0 && years <= 50) parsed.experience_years = years
  const employer = (info.Current_Employer || '').trim()
  if (employer && info.Current_Job_Title && !parsed.work_history.some((w: any) =>
    String(w.company || '').toLowerCase().includes(employer.toLowerCase().slice(0, 12)))) {
    const entry = { title: info.Current_Job_Title, company: employer, to: 'Present', is_current: true, description: '', achievements: [] }
    parsed.work_history = [entry, ...parsed.work_history]
    parsed.companies = [{ name: employer, title: entry.title, to: 'Present' }, ...parsed.companies]
  }
  const have = new Set(parsed.skills.map((s: any) => String(s.name).toLowerCase()))
  for (const raw of (info.Skill_Set || '').split(/[,;|]/)) {
    const name = raw.trim().toLowerCase()
    if (name.length >= 2 && name.length <= 40 && !have.has(name)) { have.add(name); parsed.skills.push({ name, category: 'other' }) }
  }
}
