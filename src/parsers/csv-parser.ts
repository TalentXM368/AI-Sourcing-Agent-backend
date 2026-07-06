// ─── CSV Parser for JD Master File ─────────────────────────────
// Handles quoted fields, embedded commas, HTML entities, newlines

export interface CSVRow {
  [key: string]: string
}

export interface ParsedJDFromCSV {
  zoho_job_id: string
  job_title: string
  industry: string | null
  region_preference: string | null
  required_skills: string[]
  job_description: string
  work_experience: string | null
  job_type: string | null
  hours_per_week: number | null
  job_opening_status: string | null
  date_opened: string | null
}

// ─── Parse CSV text into rows ─────────────────────────────────

export function parseCSV(text: string): CSVRow[] {
  const lines = splitCSVLines(text)
  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const rows: CSVRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row: CSVRow = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = decodeHTMLEntities((values[j] || '').trim())
    }
    rows.push(row)
  }

  return rows
}

// ─── Split CSV into logical lines (handles quoted newlines) ──

function splitCSVLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
        current += ch
      }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) lines.push(current)
  return lines
}

// ─── Parse a single CSV line into fields ──────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  fields.push(current)
  return fields
}

// ─── Decode HTML entities ─────────────────────────────────────

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// ─── Convert CSV rows to structured JDs ──────────────────────

export function convertToJDs(rows: CSVRow[]): ParsedJDFromCSV[] {
  return rows
    .filter(row => row.job_id && row.job_title) // skip empty rows
    .map(row => ({
      zoho_job_id: row.job_id || '',
      job_title: row.job_title || '',
      industry: row.Industry || null,
      region_preference: row.Region_prefernce || null,
      required_skills: parseSkillsList(row.Required_Skills || ''),
      job_description: row.Job_Description || '',
      work_experience: row.Work_Experience || null,
      job_type: row.Job_Type || null,
      hours_per_week: row.Hours_per_week ? parseInt(row.Hours_per_week) : null,
      job_opening_status: row.Job_Opening_Status || null,
      date_opened: row.date_opened || null,
    }))
}

// ─── Parse comma-separated skills into array ─────────────────

function parseSkillsList(skillsStr: string): string[] {
  if (!skillsStr) return []
  return skillsStr
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}
