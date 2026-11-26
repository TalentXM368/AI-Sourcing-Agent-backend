import { identityCollisionChecks } from '../checks/fake/identity-collisions.js';
import { placeholderChecks } from '../checks/fake/placeholder-checks.js';
import { profileLinkChecks } from '../checks/fake/profile-checks.js';
import { experienceClaimCheck, timelineChecks } from '../checks/resume/timeline.js';
import type { CandidateTrustResult, TrustCandidate, TrustSection, TrustSignal } from '../types.js';
import { buildChecklist } from './checklist.js';
import type { IdentityIndex } from './identity-index.js';

/**
 * Runs every rule check for one candidate. `index` must contain every candidate
 * that could match (the whole org, or the related ones from the fingerprint table).
 * `comparedAgainst` is how many candidates the comparison covered (for the checklist text).
 */
export function evaluateCandidate(
  c: TrustCandidate,
  index: IdentityIndex,
  sections: TrustSection[] = ['fake', 'resume'],
  now: Date = new Date(),
  comparedAgainst: number = index.size,
): CandidateTrustResult {
  const signals: TrustSignal[] = [];
  if (sections.includes('fake')) {
    // locationPhoneCheck is intentionally off: region-classifier matches substrings
    // ("Indiana" → India), so it was wrong more often than right on real data.
    signals.push(...placeholderChecks(c), ...identityCollisionChecks(c, index), ...profileLinkChecks(c));
  }
  if (sections.includes('resume')) {
    signals.push(...timelineChecks(c, now), ...experienceClaimCheck(c, now));
  }
  return { candidateId: c.id, sections, signals, checklist: buildChecklist(c, signals, sections, comparedAgainst, now) };
}
