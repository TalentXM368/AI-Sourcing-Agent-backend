import type { SourceTracking, ProcessedSection, ExtractedJobLocation } from '../types/index.js';
import { st } from '../utils/index.js';
import { normalizeWorkMode } from '../normalizers/index.js';

const LOCATION_PATTERNS = [
  /(?:location|office|based in|located in)[:\s]*([^\n,]+)/i,
  /(?:city|state|country)[:\s]*([^\n,]+)/i,
  /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z]{2})\b/,
  /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b/,
];

export function extractJobLocation(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobLocation {
  const locationSection = sections.find(s => s.normalizedName === 'location');
  const searchText = locationSection?.content || fullText;

  const locationParts = parseLocation(searchText);
  const workMode = extractWorkMode(searchText + ' ' + fullText);

  return {
    city: locationParts.city
      ? st(locationParts.city, 'location-extractor', locationSection ? 'location' : 'document', 0.7)
      : null,
    state: locationParts.state
      ? st(locationParts.state, 'location-extractor', locationSection ? 'location' : 'document', 0.7)
      : null,
    country: locationParts.country
      ? st(locationParts.country, 'location-extractor', locationSection ? 'location' : 'document', 0.7)
      : null,
    raw: locationParts.raw
      ? st(locationParts.raw, 'location-extractor', locationSection ? 'location' : 'document', 0.85)
      : null,
    workMode,
  };
}

function parseLocation(text: string): {
  city: string | null;
  state: string | null;
  country: string | null;
  raw: string | null;
} {
  for (const pattern of LOCATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      if (match[2]) {
        return {
          city: match[1]?.trim() || null,
          state: match[2]?.trim() || null,
          country: null,
          raw: match[0]?.trim() || null,
        };
      }
      return {
        city: null,
        state: null,
        country: null,
        raw: match[1]?.trim() || match[0]?.trim() || null,
      };
    }
  }

  const remotePattern = /\b(remote|work from home|wfh|distributed|anywhere|global)\b/i;
  const remoteMatch = text.match(remotePattern);
  if (remoteMatch) {
    return {
      city: null,
      state: null,
      country: null,
      raw: remoteMatch[0],
    };
  }

  return { city: null, state: null, country: null, raw: null };
}

function extractWorkMode(text: string): SourceTracking | null {
  const lower = text.toLowerCase();

  if (/\b(remote|work from home|wfh|fully remote|100% remote|work from anywhere)\b/i.test(lower)) {
    return st('remote', 'location-extractor', 'document', 0.8);
  }
  if (/\b(hybrid|flexible location|partial remote)\b/i.test(lower)) {
    return st('hybrid', 'location-extractor', 'document', 0.8);
  }
  if (/\b(onsite|on-site|in-office|in office|on site)\b/i.test(lower)) {
    return st('onsite', 'location-extractor', 'document', 0.8);
  }
  if (/\b(flexible|flex)\b/i.test(lower)) {
    return st('flexible', 'location-extractor', 'document', 0.6);
  }

  return null;
}
