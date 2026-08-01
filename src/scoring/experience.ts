// ─── Experience Score Calculation ──────────────────────────────

export function computeExperienceScore(
  jobExpMax: number | null | undefined,
  candidateExp: number | null | undefined
): number {
  if (jobExpMax === null || jobExpMax === undefined) return 50
  if (candidateExp === null || candidateExp === undefined) return 50

  const diff = Math.abs(candidateExp - jobExpMax)

  if (diff <= 1) return 96
  if (diff <= 2) return 90
  if (diff <= 3) return 82
  if (diff <= 5) return 68
  if (diff <= 7) return 55
  return Math.max(35, 100 - diff * 6)
}
