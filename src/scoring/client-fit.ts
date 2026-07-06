// ─── Client Fit Score Calculation ──────────────────────────────

export function computeClientFitScore(
  candidate: any,
  clientContext: any,
  job: any
): number {
  const hiringPrefs = clientContext.hiring_preferences || {}
  const roleContext = clientContext.role_context || {}
  const historical = clientContext.historical_patterns || {}

  // Get candidate skills
  const candidateSkills = new Set<string>()
  if (Array.isArray(candidate.skills)) {
    for (const s of candidate.skills) {
      candidateSkills.add(normalize(s.name || s))
    }
  }

  // Get candidate text for keyword matching
  const candidateText = `${candidate.headline || ''} ${(candidate.companies || []).map((c: any) => `${c.title || ''} ${c.name || ''}`).join(' ')}`.toLowerCase()

  // 1. Must-have matching (55% weight)
  const mustHave = hiringPrefs.must_have || []
  const matchedMust = mustHave.filter((m: string) =>
    candidateSkills.has(normalize(m)) || candidateText.includes(normalize(m))
  )
  const mustScore = mustHave.length > 0 ? matchedMust.length / mustHave.length : 0.7

  // 2. Tech stack overlap (25% weight)
  const techStack = roleContext.tech_stack || []
  const matchedStack = techStack.filter((t: string) =>
    candidateSkills.has(normalize(t)) || candidateText.includes(normalize(t))
  )
  const stackScore = techStack.length > 0 ? matchedStack.length / techStack.length : 0.5

  // 3. Tenure fit (20% weight)
  const avgTenure = historical.avg_tenure_years || 3
  const candidateCompanies = candidate.companies || []
  const candidateTenure = candidateCompanies.length > 0
    ? (candidate.experience_years || 0) / candidateCompanies.length
    : candidate.experience_years || 0
  const tenureFit = Math.max(0, 1 - Math.abs(candidateTenure - avgTenure) / (avgTenure + 2))

  // 4. Nice-to-have bonus
  const niceToHave = hiringPrefs.nice_to_have || []
  const matchedNice = niceToHave.filter((n: string) =>
    candidateSkills.has(normalize(n)) || candidateText.includes(normalize(n))
  )
  const niceBonus = niceToHave.length > 0 ? (matchedNice.length / niceToHave.length) * 0.15 : 0

  // 5. Avoid penalty
  const avoid = hiringPrefs.avoid || []
  const avoidHits = avoid.filter((a: string) => {
    const firstWord = a.split(' ')[0]?.toLowerCase() || ''
    return candidateText.includes(firstWord) && firstWord.length > 2
  })

  // Calculate final score
  let fit = mustScore * 0.55 + stackScore * 0.25 + tenureFit * 0.20 + niceBonus
  fit -= 0.15 * avoidHits.length
  fit = Math.max(0, Math.min(1, fit))

  return Math.round(fit * 100)
}

// ─── Normalize ────────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().trim()
}
