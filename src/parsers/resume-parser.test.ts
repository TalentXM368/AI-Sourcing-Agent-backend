import { describe, expect, it } from 'vitest'
import { parseResumeRegex } from './resume-parser.js'
import { detectMimetype } from './text-extractor.js'

describe('resume parsing', () => {
  it('extracts a person name before contact and section content', () => {
    const result = parseResumeRegex([
      'Aarav Sharma',
      'aarav.sharma@example.com | +1 555 123 4567',
      'Professional Summary',
      'Software engineer with backend experience.',
      'Skills',
      'TypeScript, PostgreSQL, Docker',
    ].join('\n'))

    expect(result.name).toBe('Aarav Sharma')
    expect(result.email).toBe('aarav.sharma@example.com')
    expect(result.skills.length).toBeGreaterThan(0)
  })

  it('recognizes document types when filenames contain URL query strings', () => {
    expect(detectMimetype('resume.pdf?download=1')).toBe('application/pdf')
    expect(detectMimetype('resume.DOCX#page=1')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })
})