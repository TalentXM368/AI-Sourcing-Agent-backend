import type { ParsedCandidate } from '../types.js'

export interface RecoveryThresholds {
  success: number
  partial: number
  lowQuality: number
}

export type RecoveryQuality = 'success' | 'partial' | 'low_quality' | 'failed'

export const RECOVERY_COMPARISON_FIELDS = [
  'name', 'email', 'phone', 'location', 'skills', 'work_history',
  'education', 'projects', 'certifications',
] as const

function fieldPresent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function fieldComparable(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item.toLowerCase().trim()
      if (!item || typeof item !== 'object') return String(item)
      return Object.entries(item as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, itemValue]) => `${key}:${String(itemValue ?? '').toLowerCase().trim()}`)
        .join('|')
    }).sort().join('::')
  }
  return String(value ?? '').toLowerCase().trim()
}

export function compareRecoveryProfiles(oldProfile: Record<string, unknown>, newProfile: ParsedCandidate) {
  const oldFields = RECOVERY_COMPARISON_FIELDS.filter(field => fieldPresent(oldProfile[field]))
  const newFields = RECOVERY_COMPARISON_FIELDS.filter(field => fieldPresent(newProfile[field]))
  const improvedFields: string[] = []
  const lostFields: string[] = []
  const conflicts: Array<{ field: string; old: unknown; new: unknown }> = []

  for (const field of RECOVERY_COMPARISON_FIELDS) {
    const hadOld = fieldPresent(oldProfile[field])
    const hasNew = fieldPresent(newProfile[field])
    if (!hadOld && hasNew) improvedFields.push(field)
    else if (hadOld && !hasNew) lostFields.push(field)
    else if (hadOld && hasNew && fieldComparable(oldProfile[field]) !== fieldComparable(newProfile[field])) {
      conflicts.push({ field, old: oldProfile[field], new: newProfile[field] })
    }
  }
  return { oldFields, newFields, improvedFields, lostFields, conflicts }
}

export function isRecoveryResultClearlyWorse(
  newScore: number,
  oldScore: number | null,
  comparison: ReturnType<typeof compareRecoveryProfiles>,
): boolean {
  if (oldScore != null && newScore + 15 < oldScore) return true
  return comparison.lostFields.length >= 2 && comparison.improvedFields.length === 0
}

export function classifyRecoveryQuality(
  score: number,
  isValid: boolean,
  thresholds: RecoveryThresholds,
): RecoveryQuality {
  if (score >= thresholds.success && isValid) return 'success'
  if (score >= thresholds.partial && isValid) return 'partial'
  if (score >= thresholds.lowQuality) return 'low_quality'
  return 'failed'
}
