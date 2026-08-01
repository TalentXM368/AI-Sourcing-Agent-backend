import { describe, it, expect } from 'vitest';
import { runJobPipeline } from '../../pipeline.js';
import type { StructuredDocument } from '../../types/index.js';

function makeDoc(overrides: Partial<StructuredDocument> = {}): StructuredDocument {
  return {
    markdown: '',
    plainText: '',
    sections: [],
    tables: [],
    images: [],
    metadata: { pages: 1, fileName: 'test.pdf', fileSize: 1000, mimeType: 'application/pdf' },
    ...overrides,
  };
}

describe('Job Intelligence Pipeline', () => {
  it('processes a minimal JD', async () => {
    const doc = makeDoc({
      sections: [
        { name: 'Job Title', content: 'Senior Software Engineer', level: 1 },
        { name: 'About Us', content: 'We are a tech company', level: 1 },
        { name: 'Requirements', content: '- JavaScript\n- React\n- 3-5 years experience', level: 1 },
        { name: 'Responsibilities', content: '- Build web applications\n- Code review', level: 1 },
      ],
    });

    const profile = await runJobPipeline(doc, 'test-1');

    expect(profile.schemaVersion).toBe('1.0');
    expect(profile.jobId).toBe('test-1');
    expect(profile.title?.value).toBeDefined();
    expect(profile.requiredSkills.length).toBeGreaterThan(0);
    expect(profile.responsibilities.length).toBeGreaterThan(0);
    expect(profile.quality.overall).toBeGreaterThan(0);
  });

  it('handles empty document gracefully', async () => {
    const doc = makeDoc({
      plainText: 'Software Engineer at Google',
    });

    const profile = await runJobPipeline(doc, 'test-2');
    expect(profile.schemaVersion).toBe('1.0');
    expect(profile.jobId).toBe('test-2');
  });

  it('detects remote work mode', async () => {
    const doc = makeDoc({
      sections: [
        { name: 'Location', content: 'Remote - Work from anywhere', level: 1 },
      ],
    });

    const profile = await runJobPipeline(doc, 'test-3');
    expect(profile.workMode?.value).toBe('remote');
  });

  it('extracts salary', async () => {
    const doc = makeDoc({
      sections: [
        { name: 'Compensation', content: '$120K-$150K/year', level: 1 },
      ],
    });

    const profile = await runJobPipeline(doc, 'test-4');
    expect(profile.salary.minimum?.value).toBe('120000');
    expect(profile.salary.maximum?.value).toBe('150000');
  });

  it('detects seniority from title', async () => {
    const doc = makeDoc({
      sections: [
        { name: 'Job Title', content: 'Junior Developer', level: 1 },
      ],
    });

    const profile = await runJobPipeline(doc, 'test-5');
    expect(profile.seniority?.value).toBe('junior');
  });
});
