import { describe, expect, it } from 'vitest'
import type { ParsedCandidate } from '../types.js'
import {
  classifyRecoveryQuality,
  compareRecoveryProfiles,
  isRecoveryResultClearlyWorse,
} from './resume-recovery-rules.js'

const thresholds = { success: 75, partial: 60, lowQuality: 40 }

function parsed(overrides: Partial<ParsedCandidate> = {}): ParsedCandidate {
  return {
    name: 'Rohan Sharma',
    skills: [],
    companies: [],
    work_history: [],
    education: [],
    projects: [],
    certifications: [],
    languages: [],
    ...overrides,
  }
}

describe('resume recovery rules', () => {
  it('compares profile fields and ignores ordering/case in skill arrays', () => {
    const comparison = compareRecoveryProfiles(
      {
        name: 'Rohan Sharma',
        email: 'rohan@example.com',
        skills: [{ name: 'TypeScript' }, { name: 'React' }],
      },
      parsed({ skills: [{ name: 'react' }, { name: 'typescript' }], location: 'Pune' }),
    )

    expect(comparison.lostFields).toEqual(['email'])
    expect(comparison.improvedFields).toEqual(['location'])
    expect(comparison.conflicts).toEqual([])
  })

  it('blocks a materially worse parse by score or by loss of fields', () => {
    const comparison = compareRecoveryProfiles(
      { name: 'Rohan Sharma', email: 'rohan@example.com', phone: '123' },
      parsed({ name: '', email: undefined, phone: undefined }),
    )

    expect(isRecoveryResultClearlyWorse(70, 90, comparison)).toBe(true)
    expect(isRecoveryResultClearlyWorse(90, 90, comparison)).toBe(true)
  })

  it('classifies on configured thresholds and requires a valid profile for success/partial', () => {
    expect(classifyRecoveryQuality(75, true, thresholds)).toBe('success')
    expect(classifyRecoveryQuality(60, true, thresholds)).toBe('partial')
    expect(classifyRecoveryQuality(60, false, thresholds)).toBe('low_quality')
    expect(classifyRecoveryQuality(39, true, thresholds)).toBe('failed')
  })
})
