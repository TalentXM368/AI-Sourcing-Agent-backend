/**
 * Parser benchmark: measures the deterministic parsers on real stored resumes.
 *
 *   npx tsx scripts/benchmark-parsers.ts --limit 45 --out <dir>
 *
 * For each sampled resume it downloads the file, extracts text (document
 * service first, local extractors as fallback), then runs:
 *   A. parseResumeRegex           (legacy flat-text regex parser)
 *   B. candidate-intelligence     (section-aware deterministic pipeline)
 *   C. parseResumeDeterministic   (v2 engine alone)
 *   D. parseResumeOffline         (production path: v2 + legacy gap fill)
 * and reports per-field hit rates, data-quality scores and how often the
 * Claude "extreme" trigger would fire. No LLM is called.
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
config({ path: resolve(process.cwd(), '.env') })

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const LIMIT = parseInt(args.get('limit') || '45', 10)
const OUT = args.get('out') || resolve(process.cwd(), 'benchmark-output')
mkdirSync(OUT, { recursive: true })

const FIELDS = ['name', 'email', 'phone', 'linkedin_url', 'headline', 'location', 'summary', 'skills3', 'work1', 'edu1', 'exp_years'] as const
type Field = typeof FIELDS[number]

function validName(n?: string): boolean {
  if (!n || n === 'Unknown' || n.length < 2 || n.length > 60) return false
  if (/\d|@|http|\.(pdf|docx?)$/i.test(n)) return false
  if (n.split(/\s+/).length > 5) return false
  if (/^(professional|work|summary|education|skills|experience|resume|curriculum|objective|contact)/i.test(n)) return false
  return true
}

function hits(p: any): Record<Field, boolean> {
  return {
    name: validName(p.name),
    email: !!p.email,
    phone: !!p.phone,
    linkedin_url: !!p.linkedin_url,
    headline: !!p.headline,
    location: !!p.location,
    summary: !!p.summary && p.summary.length > 20,
    skills3: (p.skills?.length || 0) >= 3,
    work1: (p.work_history?.length || 0) >= 1,
    edu1: (p.education?.length || 0) >= 1,
    exp_years: typeof p.experience_years === 'number' && p.experience_years > 0,
  }
}

async function main() {
  const { pool } = await import('../src/db/index.js')
  const { fetchFromCloudinary } = await import('../src/services/cloudinary.js')
  const { detectMimetype, extractTextFromBuffer } = await import('../src/parsers/text-extractor.js')
  const { checkDocumentIntelligenceHealth, extractWithDocumentIntelligence } = await import('../src/services/document-intelligence.js')
  const { parseResumeRegex, isExtremeParseFailure, parseResumeOffline } = await import('../src/parsers/resume-parser.js')
  const { parseResumeDeterministic } = await import('../src/parsers/deterministic-resume-parser.js')
  const { existsSync, readFileSync } = await import('fs')
  const cacheDir = resolve(OUT, 'cache')
  mkdirSync(cacheDir, { recursive: true })
  const { runPipeline } = await import('../src/modules/candidate-intelligence/pipeline.js')
  const { toParsedCandidate } = await import('../src/services/resume-recovery.js')
  const { computeDataQuality } = await import('../src/scoring/data-quality.js')

  const diHealthy = await checkDocumentIntelligenceHealth()
  console.log(`Document service (${process.env.DOCUMENT_INTELLIGENCE_URL}): ${diHealthy ? 'UP' : 'DOWN'}`)

  // Stratified sample: unparsed/failed, low-quality completed, good completed.
  // The sample is persisted so repeated runs compare the same resumes.
  const samplePath = resolve(OUT, 'sample.json')
  const per = Math.ceil(LIMIT / 3)
  const sample = existsSync(samplePath)
    ? { rows: JSON.parse(readFileSync(samplePath, 'utf8')) as any[] }
    : await pool.query(
    `(SELECT id, name, resume_url, source_file, parse_status, data_quality_score, 'failed' AS bucket
        FROM candidates WHERE source = 'resume' AND resume_url IS NOT NULL AND parse_status IN ('failed', 'pending')
        ORDER BY random() LIMIT $1)
     UNION ALL
     (SELECT id, name, resume_url, source_file, parse_status, data_quality_score, 'low' AS bucket
        FROM candidates WHERE source = 'resume' AND resume_url IS NOT NULL AND parse_status = 'completed' AND COALESCE(data_quality_score, 0) < 50
        ORDER BY random() LIMIT $1)
     UNION ALL
     (SELECT id, name, resume_url, source_file, parse_status, data_quality_score, 'good' AS bucket
        FROM candidates WHERE source = 'resume' AND resume_url IS NOT NULL AND parse_status = 'completed' AND COALESCE(data_quality_score, 0) >= 70
        ORDER BY random() LIMIT $1)`,
    [per],
  )
  if (!existsSync(samplePath)) writeFileSync(samplePath, JSON.stringify(sample.rows, null, 2))
  console.log(`Sampled ${sample.rows.length} resumes${existsSync(samplePath) ? ' (persisted sample)' : ''}`)

  const totals: Record<string, { n: number; hits: Record<string, number>; quality: number[]; extreme: number }> = {
    A_regex: { n: 0, hits: {}, quality: [], extreme: 0 },
    B_intel: { n: 0, hits: {}, quality: [], extreme: 0 },
    C_v2: { n: 0, hits: {}, quality: [], extreme: 0 },
    D_final: { n: 0, hits: {}, quality: [], extreme: 0 },
  }
  const extraction: Record<string, number> = { di: 0, di_ocr: 0, local: 0, failed: 0, zero_sections: 0 }
  const rows: any[] = []
  const startAll = Date.now()

  for (const [i, c] of sample.rows.entries()) {
    const label = `${i + 1}/${sample.rows.length} [${String(c.bucket).padEnd(6)}] ${c.id.slice(0, 8)}`
    const rec: any = { id: c.id, bucket: c.bucket, db_name: c.name, db_quality: c.data_quality_score, parse_status: c.parse_status, resume_url: c.resume_url }
    try {
      const publicId = c.resume_url.split('/upload/')[1]?.replace(/^v\d+\//, '').split('?')[0]
      const filename = (publicId || c.resume_url).split('/').pop() || 'resume'
      const mimetype = detectMimetype(filename)
      rec.filename = filename
      rec.mimetype = mimetype

      let text = ''
      let sections: Array<{ name: string; content: string; level?: number }> = []
      let method = 'local'
      const cachePath = resolve(cacheDir, `${c.id}.json`)
      if (existsSync(cachePath)) {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8'))
        text = cached.text
        sections = cached.sections
        method = cached.method
        rec.bytes = cached.bytes
        rec.cached = true
      } else {
        const t0 = Date.now()
        const bytes = await fetchFromCloudinary(c.resume_url, publicId)
        rec.bytes = bytes.length
        rec.fetch_ms = Date.now() - t0
        if (diHealthy) {
          try {
            const di = await extractWithDocumentIntelligence(bytes, mimetype, filename)
            if (di.text.trim().length >= 50) {
              text = di.text
              sections = di.sections.map(s => ({ name: s.name, content: s.content, level: s.level ?? undefined }))
              method = di.quality?.needsOcr || di.quality?.isScanned ? 'di_ocr' : 'di'
            }
          } catch (e: any) {
            rec.di_error = String(e.message).slice(0, 160)
          }
        }
        if (!text) text = await extractTextFromBuffer(bytes, mimetype)
        writeFileSync(cachePath, JSON.stringify({ text, sections, method, bytes: bytes.length, filename, mimetype }))
      }
      extraction[method]++
      if (sections.length === 0) extraction.zero_sections++
      rec.extraction = method
      rec.text_len = text.length
      rec.sections = sections.map(s => s.name)
      rec.text_head = text.slice(0, 800)

      const a = parseResumeRegex(text)
      const profile = await runPipeline({
        markdown: text,
        plainText: text,
        sections,
        tables: [],
        images: [],
        metadata: { fileName: filename, mimeType: mimetype },
      })
      const b = toParsedCandidate(profile, c.resume_url)
      const v2 = parseResumeDeterministic(text, sections)
      const final = parseResumeOffline(text, sections)

      for (const [key, p] of [['A_regex', a], ['B_intel', b], ['C_v2', v2], ['D_final', final]] as const) {
        const h = hits(p)
        totals[key].n++
        for (const f of FIELDS) totals[key].hits[f] = (totals[key].hits[f] || 0) + (h[f] ? 1 : 0)
        const q = computeDataQuality(p as any).quality_score
        totals[key].quality.push(q)
        const extreme = isExtremeParseFailure(p as any)
        if (extreme) totals[key].extreme++
        rec[key] = {
          name: p.name, email: p.email, phone: p.phone, linkedin_url: p.linkedin_url,
          headline: p.headline, location: p.location, experience_years: p.experience_years,
          skills: p.skills.map((s: any) => s.name).slice(0, 15), skills_n: p.skills.length,
          work_history: p.work_history.slice(0, 4).map((w: any) => ({ title: w.title, company: w.company, from: w.from, to: w.to })),
          work_n: p.work_history.length,
          education: p.education.slice(0, 3),
          quality: q, extreme,
        }
      }
      console.log(`${label} ${method.padEnd(6)} ${String(text.length).padStart(6)}ch sec=${String(sections.length).padStart(2)} | A q=${String(rec.A_regex.quality).padStart(3)} ${String(rec.A_regex.name).slice(0, 20).padEnd(20)} | B q=${String(rec.B_intel.quality).padStart(3)} ${String(rec.B_intel.name).slice(0, 20).padEnd(20)} | C q=${String(rec.C_v2.quality).padStart(3)} ${String(rec.C_v2.name).slice(0, 22)}`)
    } catch (e: any) {
      extraction.failed++
      rec.error = String(e.message || e).slice(0, 200)
      console.log(`${label} ERROR ${rec.error}`)
    }
    rows.push(rec)
  }

  writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(rows, null, 2))
  const summary: any = { sample: sample.rows.length, seconds: Math.round((Date.now() - startAll) / 1000), extraction, parsers: {} }
  for (const [key, t] of Object.entries(totals)) {
    const pct = (x: number) => (t.n ? Math.round((x / t.n) * 100) : 0)
    summary.parsers[key] = {
      parsed: t.n,
      avg_quality: t.quality.length ? Math.round(t.quality.reduce((s, q) => s + q, 0) / t.quality.length) : 0,
      quality_ge70_pct: pct(t.quality.filter(q => q >= 70).length),
      extreme_trigger_pct: pct(t.extreme),
      field_hit_pct: Object.fromEntries(FIELDS.map(f => [f, pct(t.hits[f] || 0)])),
    }
  }
  writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log('\n=== SUMMARY ===')
  console.log(JSON.stringify(summary, null, 2))
  await pool.end()
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
