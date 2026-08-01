import type { QdrantFilter, QdrantCondition } from '../../vector-intelligence/types/qdrant.types.js';
import type { HardFilters } from '../types/index.js';

function keywordMatch(key: string, value: string): QdrantCondition {
  return { key, match: { value } };
}

function rangeCondition(key: string, opts: { gte?: number; lte?: number; gt?: number; lt?: number }): QdrantCondition {
  return { key, range: opts };
}

export function buildQdrantFilterFromHardFilters(filters: HardFilters): QdrantFilter | undefined {
  if (!filters) return undefined;

  const must: QdrantCondition[] = [];

  if (filters.country) {
    must.push(keywordMatch('location', filters.country.toLowerCase()));
  }

  if (filters.employmentType) {
    must.push(keywordMatch('employmentType', filters.employmentType.toLowerCase()));
  }

  if (filters.minimumExperienceYears !== undefined) {
    must.push(rangeCondition('experienceYears', { gte: filters.minimumExperienceYears }));
  }

  if (filters.requiredSkills?.length) {
    for (const skill of filters.requiredSkills) {
      must.push(keywordMatch('skills', skill.toLowerCase()));
    }
  }

  if (must.length === 0) return undefined;

  return { must };
}
