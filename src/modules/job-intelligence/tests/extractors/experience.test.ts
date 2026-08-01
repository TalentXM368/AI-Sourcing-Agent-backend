import { describe, it, expect } from 'vitest';
import { extractJobExperience } from '../../extractors/experience-extractor.js';
import type { ProcessedSection } from '../../types/index.js';

function makeSection(name: string, content: string): ProcessedSection {
  return { originalName: name, normalizedName: name, content, level: 1 };
}

describe('Experience Extractor', () => {
  it('extracts year range from requirements', () => {
    const sections = [makeSection('requirements', '3-5 years of experience required')];
    const result = extractJobExperience(sections, '');
    expect(result.minimumYears?.value).toBe('3');
    expect(result.maximumYears?.value).toBe('5');
  });

  it('extracts single year minimum', () => {
    const sections = [makeSection('requirements', 'Minimum 7 years experience')];
    const result = extractJobExperience(sections, '');
    expect(result.minimumYears?.value).toBe('7');
  });

  it('extracts from full text', () => {
    const fullText = 'We need someone with 5+ years of software development experience';
    const result = extractJobExperience([], fullText);
    expect(result.minimumYears?.value).toBe('5');
  });

  it('returns nulls when no experience found', () => {
    const result = extractJobExperience([], 'No experience requirements listed');
    expect(result.minimumYears).toBeNull();
    expect(result.maximumYears).toBeNull();
  });
});
