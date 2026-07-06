// ─── Education Score Calculation ───────────────────────────────

export function computeEducationScore(education: unknown): number {
  if (!education) return 50

  const eduArray = Array.isArray(education) ? education : []
  if (eduArray.length === 0) return 50

  // Has education listed
  return 85
}
