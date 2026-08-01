import { readFileSync } from 'fs';
import { join } from 'path';
import { normalizeCompanyName, normalizeForComparison, jaroWinkler } from '../utils/string-similarity.js';

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(__dirname, filename), 'utf-8'));
}

interface CompaniesData {
  aliases: Record<string, string>;
  legalSuffixes: string[];
}

interface JobTitlesData {
  canonicalizations: Record<string, string>;
  levelPatterns: Record<string, string[]>;
}

interface DegreesData {
  aliases: Record<string, string>;
  levels: Record<string, string[]>;
}

interface LanguagesData {
  languages: string[];
  proficiencyLevels: Record<string, string[]>;
}

interface LocationsData {
  cities: Record<string, string>;
  states: Record<string, string>;
  countries: Record<string, string>;
}

export class KnowledgeService {
  private companyAliases: Map<string, string>;
  private companyLegalSuffixes: Set<string>;
  private titleCanonicalizations: Map<string, string>;
  private degreeAliases: Map<string, string>;
  private degreeLevels: Map<string, string[]>;
  private knownLanguages: Set<string>;
  private languageProficiencyLevels: Map<string, string[]>;
  private cityMappings: Map<string, string>;
  private stateMappings: Map<string, string>;
  private countryMappings: Map<string, string>;

  constructor() {
    const companies = loadJson<CompaniesData>('companies.json');
    this.companyAliases = new Map(Object.entries(companies.aliases));
    this.companyLegalSuffixes = new Set(companies.legalSuffixes);

    const titles = loadJson<JobTitlesData>('job-titles.json');
    this.titleCanonicalizations = new Map(Object.entries(titles.canonicalizations));

    const degrees = loadJson<DegreesData>('degrees.json');
    this.degreeAliases = new Map(Object.entries(degrees.aliases));
    this.degreeLevels = new Map(Object.entries(degrees.levels));

    const languages = loadJson<LanguagesData>('languages.json');
    this.knownLanguages = new Set(languages.languages.map((l: string) => l.toLowerCase()));
    this.languageProficiencyLevels = new Map(
      Object.entries(languages.proficiencyLevels).map(([k, v]) => [k, v])
    );

    const locations = loadJson<LocationsData>('locations.json');
    this.cityMappings = new Map(Object.entries(locations.cities));
    this.stateMappings = new Map(Object.entries(locations.states));
    this.countryMappings = new Map(Object.entries(locations.countries));
  }

  resolveCompany(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    const exact = this.companyAliases.get(lower);
    if (exact) return exact;

    for (const [alias, canonical] of this.companyAliases) {
      if (lower.includes(alias) || alias.includes(lower)) {
        return canonical;
      }
    }

    const normalized = normalizeCompanyName(raw);
    if (normalized.length >= 3) {
      let bestMatch: string | null = null;
      let bestScore = 0;
      for (const [alias, canonical] of this.companyAliases) {
        const score = jaroWinkler(normalized, alias);
        if (score > 0.85 && score > bestScore) {
          bestScore = score;
          bestMatch = canonical;
        }
      }
      if (bestMatch) return bestMatch;
    }

    return raw.replace(/\b([a-z])/g, (_: string, c: string) => c.toUpperCase()).trim();
  }

  resolveSkill(raw: string): { canonical: string; category: string } | null {
    const lower = raw.toLowerCase().trim();
    for (const [alias, canonical] of this.companyAliases) {
      if (lower === alias) return { canonical, category: 'unknown' };
    }
    return null;
  }

  resolveJobTitle(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    const exact = this.titleCanonicalizations.get(lower);
    if (exact) return exact;

    for (const [alias, canonical] of this.titleCanonicalizations) {
      if (lower.includes(alias) || alias.includes(lower)) {
        return canonical;
      }
    }

    return raw;
  }

  getJobTitleLevel(title: string): string {
    return 'mid';
  }

  resolveDegree(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    const exact = this.degreeAliases.get(lower);
    if (exact) return exact;

    for (const [alias, canonical] of this.degreeAliases) {
      if (lower.includes(alias)) return canonical;
    }

    return raw;
  }

  getEducationLevel(degree: string): string | null {
    const lower = degree.toLowerCase();
    for (const [level, keywords] of this.degreeLevels) {
      if (keywords.some((kw: string) => lower.includes(kw))) return level;
    }
    return null;
  }

  isKnownLanguage(name: string): boolean {
    return this.knownLanguages.has(name.toLowerCase().trim());
  }

  resolveLanguageProficiency(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    for (const [level, keywords] of this.languageProficiencyLevels) {
      if (keywords.some((kw: string) => lower.includes(kw))) return level;
    }
    return null;
  }

  resolveCity(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    return this.cityMappings.get(lower) || null;
  }

  resolveState(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    return this.stateMappings.get(lower) || null;
  }

  resolveCountry(raw: string): string | null {
    const lower = raw.toLowerCase().trim();
    return this.countryMappings.get(lower) || null;
  }

  resolveLocation(raw: string): { city: string | null; state: string | null; country: string | null } {
    const parts = raw.split(',').map(p => p.trim());
    if (parts.length >= 3) {
      return {
        city: this.resolveCity(parts[0]),
        state: this.resolveState(parts[1]),
        country: this.resolveCountry(parts[2]),
      };
    }
    if (parts.length === 2) {
      const city = this.resolveCity(parts[0]);
      const state = this.resolveState(parts[1]);
      const country = this.resolveCountry(parts[1]);
      return { city, state: state || null, country: country || null };
    }
    const city = this.resolveCity(raw);
    const state = this.resolveState(raw);
    const country = this.resolveCountry(raw);
    return { city: city || null, state: state || null, country: country || null };
  }
}
