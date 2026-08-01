import { describe, it, expect } from 'vitest';
import { extractJobMetadata } from '../../extractors/metadata-extractor.js';
import type { ProcessedSection } from '../../types/index.js';

function makeSection(name: string, content: string): ProcessedSection {
  return { originalName: name, normalizedName: name, content, level: 1 };
}

describe('Metadata Extractor', () => {
  it('extracts title from title section', () => {
    const sections = [makeSection('title', 'Senior Software Engineer')];
    const result = extractJobMetadata(sections, '');
    expect(result.title?.value).toBe('Senior Software Engineer');
  });

  it('extracts company from company section', () => {
    const sections = [makeSection('company', 'Google Inc.')];
    const result = extractJobMetadata(sections, '');
    expect(result.company?.value).toBeDefined();
  });

  it('extracts title from header lines', () => {
    const sections: ProcessedSection[] = [];
    const fullText = 'Senior React Developer\nAbout Us\nWe are a tech company...';
    const result = extractJobMetadata(sections, fullText);
    expect(result.title?.value).toBeDefined();
  });

  it('extracts department from text', () => {
    const fullText = 'Department: Engineering Team\nWe are looking for...';
    const result = extractJobMetadata([], fullText);
    expect(result.department?.value).toBeDefined();
  });
});
