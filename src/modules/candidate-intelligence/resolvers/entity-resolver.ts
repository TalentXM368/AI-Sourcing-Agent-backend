import type { SourceTracking } from '../types/common.types.js';

interface EntityGroup {
  canonical: string;
  variants: string[];
  sources: SourceTracking[];
}

const ENTITY_MAPPINGS: Record<string, string> = {
  'google llc': 'Google',
  'google inc': 'Google',
  'google inc.': 'Google',
  'google corporation': 'Google',
  'google.com': 'Google',
  'alphabet': 'Google',
  'alphabet inc': 'Google',
  'alphabet inc.': 'Google',
  'microsoft corporation': 'Microsoft',
  'microsoft corp': 'Microsoft',
  'microsoft corp.': 'Microsoft',
  'msft': 'Microsoft',
  'apple inc': 'Apple',
  'apple inc.': 'Apple',
  'apple computer': 'Apple',
  'amazon.com': 'Amazon',
  'amazon inc': 'Amazon',
  'amazon inc.': 'Amazon',
  'aws': 'Amazon Web Services',
  'meta platforms': 'Meta',
  'meta platforms inc': 'Meta',
  'facebook': 'Meta',
  'facebook inc': 'Meta',
  'facebook inc.': 'Meta',
  'netflix inc': 'Netflix',
  'netflix inc.': 'Netflix',
  'tesla inc': 'Tesla',
  'tesla inc.': 'Tesla',
  'tesla motors': 'Tesla',
  'nvidia corp': 'NVIDIA',
  'nvidia corporation': 'NVIDIA',
  'nvidia inc': 'NVIDIA',
  'ibm corp': 'IBM',
  'ibm corporation': 'IBM',
  'international business machines': 'IBM',
  'oracle corp': 'Oracle',
  'oracle corporation': 'Oracle',
  'salesforce.com': 'Salesforce',
  'salesforce inc': 'Salesforce',
  'salesforce inc.': 'Salesforce',
  'adobe inc': 'Adobe',
  'adobe systems': 'Adobe',
  'adobe systems incorporated': 'Adobe',
  'uber technologies': 'Uber',
  'uber technologies inc': 'Uber',
  'uber inc': 'Uber',
  'airbnb inc': 'Airbnb',
  'airbnb inc.': 'Airbnb',
  'spotify ab': 'Spotify',
  'spotify ltd': 'Spotify',
  'spotify technology sa': 'Spotify',
};

export function resolveEntityName(name: string): string {
  const lower = name.toLowerCase().trim();

  // Exact match
  if (ENTITY_MAPPINGS[lower]) return ENTITY_MAPPINGS[lower];

  // Partial match
  for (const [variant, canonical] of Object.entries(ENTITY_MAPPINGS)) {
    if (lower.includes(variant) || variant.includes(lower)) {
      return canonical;
    }
  }

  // Return normalized (title case) if no mapping found
  return name.replace(/\b([a-z])/g, (_, c) => c.toUpperCase()).trim();
}

export function groupEntities(names: string[]): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();

  for (const name of names) {
    const canonical = resolveEntityName(name);
    const existing = groups.get(canonical);
    if (existing) {
      existing.variants.push(name);
    } else {
      groups.set(canonical, {
        canonical,
        variants: [name],
        sources: [],
      });
    }
  }

  return Array.from(groups.values());
}
