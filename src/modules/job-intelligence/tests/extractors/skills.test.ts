import { describe, it, expect } from 'vitest';
import { extractJobSkills } from '../../extractors/skills-extractor.js';
import type { ProcessedSection } from '../../types/index.js';

function makeSection(name: string, content: string): ProcessedSection {
  return { originalName: name, normalizedName: name, content, level: 1 };
}

describe('Skills Extractor', () => {
  it('extracts required skills from requirements section', () => {
    const sections = [makeSection('requirements', 'Required Skills:\n- JavaScript\n- React\n- Node.js')];
    const result = extractJobSkills(sections, '');
    expect(result.requiredSkills.length).toBeGreaterThan(0);
    const names = result.requiredSkills.map(s => s.canonical);
    expect(names).toContain('javascript');
    expect(names).toContain('react');
    expect(names).toContain('node.js');
  });

  it('extracts preferred skills from preferred section', () => {
    const sections = [makeSection('preferred', 'Nice to have:\n- TypeScript\n- GraphQL')];
    const result = extractJobSkills(sections, '');
    expect(result.preferredSkills.length).toBeGreaterThan(0);
  });

  it('extracts skills from full text keywords', () => {
    const fullText = 'We need someone with Python, Docker, and Kubernetes experience';
    const result = extractJobSkills([], fullText);
    expect(result.requiredSkills.length).toBeGreaterThan(0);
  });

  it('deduplicates required from preferred', () => {
    const sections = [
      makeSection('requirements', 'Required:\n- JavaScript\n- React'),
      makeSection('preferred', 'Nice to have:\n- JavaScript\n- TypeScript'),
    ];
    const result = extractJobSkills(sections, '');
    const requiredNames = result.requiredSkills.map(s => s.canonical);
    const preferredNames = result.preferredSkills.map(s => s.canonical);
    expect(preferredNames).not.toContain('javascript');
  });

  it('extracts technologies', () => {
    const fullText = 'Tech stack: React, Node.js, PostgreSQL, Redis';
    const result = extractJobSkills([], fullText);
    expect(result.technologies.length).toBeGreaterThan(0);
  });
});
