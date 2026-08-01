import type { SourceTracking } from '../types/common.types.js';

export function resolveConflict(
  candidates: (SourceTracking | null)[],
): SourceTracking | null {
  const valid = candidates.filter((c): c is SourceTracking => c !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  // Sort by confidence (highest first)
  valid.sort((a, b) => b.confidence.score - a.confidence.score);

  // If top two have same confidence, prefer the one from a more specific section
  if (valid[0].confidence.score === valid[1].confidence.score) {
    const sectionPriority: Record<string, number> = {
      'contact': 5,
      'experience': 4,
      'education': 3,
      'skills': 2,
      'summary': 1,
      'header': 0,
      'document': 0,
    };

    const aPriority = sectionPriority[valid[0].sourceSection] ?? 0;
    const bPriority = sectionPriority[valid[1].sourceSection] ?? 0;

    if (bPriority > aPriority) return valid[1];
  }

  return valid[0];
}

export function resolveNameConflict(
  candidates: (SourceTracking | null)[],
): SourceTracking | null {
  const valid = candidates.filter((c): c is SourceTracking => c !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];

  // For names, prefer the one with the highest confidence
  // But also check if one is clearly a real name vs "Unknown"
  const realNames = valid.filter(v =>
    v.raw !== 'Unknown' && v.raw.length > 1 && !/^\d+$/.test(v.raw)
  );

  if (realNames.length === 1) return realNames[0];
  if (realNames.length > 1) {
    realNames.sort((a, b) => b.confidence.score - a.confidence.score);
    return realNames[0];
  }

  return valid[0];
}
