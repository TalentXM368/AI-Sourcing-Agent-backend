import { describe, it, expect } from 'vitest';
import { EmailResolver } from '../../resolvers/email.resolver.js';
import { PhoneResolver } from '../../resolvers/phone.resolver.js';
import { NameResolver } from '../../resolvers/name.resolver.js';
import { LinkedinResolver } from '../../resolvers/linkedin.resolver.js';
import { CompanyResolver } from '../../resolvers/company.resolver.js';
import { JobTitleResolver } from '../../resolvers/job-title.resolver.js';
import { KnowledgeService } from '../../knowledge/index.js';
import type { FieldCandidate } from '../../interfaces/index.js';

const knowledge = new KnowledgeService();

function makeCandidate<T>(value: T, source = 'test', confidence = 0.9, priority = 3): FieldCandidate<T> {
  return { value, source, sourceSection: source, confidence, priority };
}

describe('EmailResolver', () => {
  const resolver = new EmailResolver(knowledge);

  it('normalizes email to lowercase', () => {
    expect(resolver.normalize('John.Doe@Gmail.COM')).toBe('john.doe@gmail.com');
  });

  it('validates correct email', () => {
    const result = resolver.validate('john@example.com');
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('rejects invalid email', () => {
    const result = resolver.validate('not-an-email');
    expect(result.isValid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('resolves single candidate', () => {
    const result = resolver.resolve([makeCandidate('john@example.com', 'contact', 0.95, 3)]);
    expect(result.normalized).toBe('john@example.com');
  });
});

describe('PhoneResolver', () => {
  const resolver = new PhoneResolver(knowledge);

  it('normalizes 10-digit US number to E.164', () => {
    expect(resolver.normalize('5551234567')).toBe('+15551234567');
  });

  it('normalizes +1 prefixed number', () => {
    expect(resolver.normalize('+15551234567')).toBe('+15551234567');
  });

  it('returns raw for short numbers', () => {
    expect(resolver.normalize('123')).toBe('123');
  });

  it('validates phone with enough digits', () => {
    const result = resolver.validate('+15551234567');
    expect(result.isValid).toBe(true);
  });

  it('rejects phone with too few digits', () => {
    const result = resolver.validate('123');
    expect(result.isValid).toBe(false);
  });
});

describe('NameResolver', () => {
  const resolver = new NameResolver(knowledge);

  it('normalizes name', () => {
    const result = resolver.normalize('  john doe  ');
    expect(result).toBe('John Doe');
  });

  it('validates non-empty name', () => {
    const result = resolver.validate('John Doe');
    expect(result.isValid).toBe(true);
  });

  it('rejects empty name', () => {
    const result = resolver.validate('');
    expect(result.isValid).toBe(false);
  });
});

describe('LinkedinResolver', () => {
  const resolver = new LinkedinResolver(knowledge);

  it('normalizes linkedin URL', () => {
    expect(resolver.normalize('https://linkedin.com/in/johndoe')).toBe('https://linkedin.com/in/johndoe');
  });

  it('validates correct linkedin URL', () => {
    const result = resolver.validate('https://linkedin.com/in/johndoe');
    expect(result.isValid).toBe(true);
  });

  it('rejects non-linkedin URL', () => {
    const result = resolver.validate('https://twitter.com/johndoe');
    expect(result.isValid).toBe(false);
  });
});

describe('CompanyResolver', () => {
  const resolver = new CompanyResolver(knowledge);

  it('resolves known company alias', () => {
    const result = resolver.resolve([makeCandidate('goog', 'experience', 0.9, 4)]);
    expect(result.normalized).toBe('Google');
  });

  it('normalizes company name', () => {
    const result = resolver.normalize('google inc');
    expect(result).toBe('Google');
  });
});

describe('JobTitleResolver', () => {
  const resolver = new JobTitleResolver(knowledge);

  it('resolves known title alias', () => {
    const result = resolver.resolve([makeCandidate('swe', 'experience', 0.9, 4)]);
    expect(result.normalized).toBe('Software Engineer');
  });

  it('returns raw title for unrecognized abbreviations', () => {
    expect(resolver.normalize('sw engineer')).toBe('sw engineer');
  });
});
