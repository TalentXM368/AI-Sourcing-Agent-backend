import type { ExtractedExperience, ExtractedEducation, ExtractedProject } from '../types/extracted.types.js';

function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

export function deduplicateExperience(entries: ExtractedExperience[]): ExtractedExperience[] {
  const grouped = new Map<string, ExtractedExperience[]>();

  for (const entry of entries) {
    const key = `${normalizeForDedup(entry.company)}|${normalizeForDedup(entry.title)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(key, [entry]);
    }
  }

  const deduped: ExtractedExperience[] = [];
  for (const group of grouped.values()) {
    if (group.length === 1) {
      deduped.push(group[0]);
    } else {
      // Merge: keep longest responsibilities
      const best = group.reduce((a, b) =>
        a.responsibilities.length >= b.responsibilities.length ? a : b
      );
      deduped.push(best);
    }
  }

  return deduped;
}

export function deduplicateEducation(entries: ExtractedEducation[]): ExtractedEducation[] {
  const seen = new Set<string>();
  const deduped: ExtractedEducation[] = [];

  for (const entry of entries) {
    const key = `${normalizeForDedup(entry.university)}|${normalizeForDedup(entry.degree)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  return deduped;
}

export function deduplicateProjects(entries: ExtractedProject[]): ExtractedProject[] {
  const seen = new Set<string>();
  const deduped: ExtractedProject[] = [];

  for (const entry of entries) {
    const key = normalizeForDedup(entry.name);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  return deduped;
}
