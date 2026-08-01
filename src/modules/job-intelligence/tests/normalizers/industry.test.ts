import { describe, it, expect } from 'vitest';
import { classifyIndustryFromText } from '../../normalizers/industry-normalizer.js';

describe('Industry Normalizer', () => {
  it('classifies Technology', () => {
    const result = classifyIndustryFromText('We are building a SaaS platform using React, Node.js, and PostgreSQL on AWS');
    expect(result.industry).toBe('Technology');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('classifies Healthcare', () => {
    const result = classifyIndustryFromText('Join our team building EHR systems with HIPAA compliance and FHIR integration');
    expect(result.industry).toBe('Healthcare');
  });

  it('classifies Finance', () => {
    const result = classifyIndustryFromText('We need a fintech engineer for algorithmic trading and risk management');
    expect(result.industry).toBe('Finance');
  });

  it('classifies Manufacturing', () => {
    const result = classifyIndustryFromText('Lean manufacturing and supply chain management for automotive parts');
    expect(result.industry).toBe('Manufacturing');
  });

  it('returns Other for no match', () => {
    const result = classifyIndustryFromText('We need someone to help with general tasks');
    expect(result.industry).toBe('Other');
  });
});
