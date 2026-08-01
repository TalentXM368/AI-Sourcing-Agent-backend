import { describe, it, expect } from 'vitest';
import { KnowledgeService } from '../../knowledge/index.js';

describe('KnowledgeService', () => {
  const knowledge = new KnowledgeService();

  describe('resolveCompany', () => {
    it('resolves exact alias', () => {
      expect(knowledge.resolveCompany('google')).toBe('Google');
      expect(knowledge.resolveCompany('goog')).toBe('Google');
    });

    it('resolves partial match', () => {
      expect(knowledge.resolveCompany('google inc')).toBe('Google');
    });

    it('capitalizes unknown company names', () => {
      const result = knowledge.resolveCompany('xyznotacompany');
      expect(result).toBe('Xyznotacompany');
    });
  });

  describe('resolveJobTitle', () => {
    it('resolves exact alias', () => {
      expect(knowledge.resolveJobTitle('swe')).toBe('Software Engineer');
    });

    it('resolves partial match', () => {
      expect(knowledge.resolveJobTitle('sr software engineer')).toBe('Senior Software Engineer');
    });

    it('returns raw title if no match', () => {
      expect(knowledge.resolveJobTitle('Custom Role XYZ')).toBe('Custom Role XYZ');
    });

    it('returns raw for unmatched abbreviations', () => {
      expect(knowledge.resolveJobTitle('sw engineer')).toBe('sw engineer');
    });
  });

  describe('resolveDegree', () => {
    it('resolves exact alias', () => {
      expect(knowledge.resolveDegree('bs')).toBe('Bachelor of Science');
      expect(knowledge.resolveDegree('bsc')).toBe('Bachelor of Science');
    });

    it('resolves partial match via substring', () => {
      const result = knowledge.resolveDegree('bachelor of arts in cs');
      expect(result).toBeDefined();
    });

    it('resolves phd', () => {
      expect(knowledge.resolveDegree('phd')).toBe('Doctorate');
    });

    it('resolves doctor of philosophy', () => {
      expect(knowledge.resolveDegree('doctor of philosophy')).toBe('Doctorate');
    });
  });

  describe('getEducationLevel', () => {
    it('identifies masters level', () => {
      expect(knowledge.getEducationLevel('master')).toBe('master');
    });

    it('identifies bachelors level', () => {
      expect(knowledge.getEducationLevel('bachelor')).toBe('bachelor');
    });

    it('identifies phd level', () => {
      expect(knowledge.getEducationLevel('phd')).toBe('doctorate');
    });

    it('returns null for unknown', () => {
      expect(knowledge.getEducationLevel('Unknown Degree XYZ')).toBeNull();
    });
  });

  describe('isKnownLanguage', () => {
    it('recognizes common languages', () => {
      expect(knowledge.isKnownLanguage('English')).toBe(true);
      expect(knowledge.isKnownLanguage('spanish')).toBe(true);
      expect(knowledge.isKnownLanguage('FRENCH')).toBe(true);
    });

    it('rejects unknown strings', () => {
      expect(knowledge.isKnownLanguage('Klingon')).toBe(false);
    });
  });

  describe('resolveLanguageProficiency', () => {
    it('resolves native proficiency', () => {
      expect(knowledge.resolveLanguageProficiency('native')).toBe('native');
    });

    it('resolves native speaker', () => {
      expect(knowledge.resolveLanguageProficiency('native speaker')).toBe('native');
    });

    it('resolves fluency levels', () => {
      expect(knowledge.resolveLanguageProficiency('fluent')).toBe('fluent');
    });

    it('returns null for unrecognized', () => {
      expect(knowledge.resolveLanguageProficiency('meh')).toBeNull();
    });
  });

  describe('resolveCity', () => {
    it('resolves city names', () => {
      expect(knowledge.resolveCity('new york')).toBe('New York');
      expect(knowledge.resolveCity('sf')).toBe('San Francisco');
    });

    it('returns null for unknown cities', () => {
      expect(knowledge.resolveCity('xyznotacity')).toBeNull();
    });
  });

  describe('resolveState', () => {
    it('resolves state abbreviations', () => {
      expect(knowledge.resolveState('ca')).toBe('California');
      expect(knowledge.resolveState('ny')).toBe('New York');
    });
  });

  describe('resolveCountry', () => {
    it('resolves country names', () => {
      expect(knowledge.resolveCountry('usa')).toBe('United States');
      expect(knowledge.resolveCountry('uk')).toBe('United Kingdom');
    });
  });

  describe('resolveLocation', () => {
    it('parses city, state, country', () => {
      const result = knowledge.resolveLocation('San Francisco, CA, USA');
      expect(result.city).toBe('San Francisco');
      expect(result.state).toBe('California');
      expect(result.country).toBe('United States');
    });

    it('parses city, state', () => {
      const result = knowledge.resolveLocation('New York, NY');
      expect(result.city).toBe('New York');
      expect(result.state).toBe('New York');
    });

    it('handles single location string', () => {
      const result = knowledge.resolveLocation('London');
      expect(result.city).toBe('London');
    });
  });
});
