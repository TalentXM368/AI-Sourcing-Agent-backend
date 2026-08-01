import { describe, it, expect } from 'vitest';
import { normalizeSalary } from '../../normalizers/salary-normalizer.js';

describe('Salary Normalizer', () => {
  it('parses $120K-$150K', () => {
    const result = normalizeSalary('$120K-$150K');
    expect(result.currency).toBe('USD');
    expect(result.minimum).toBe(120000);
    expect(result.maximum).toBe(150000);
    expect(result.period).toBe('yearly');
  });

  it('parses $80,000 - $100,000', () => {
    const result = normalizeSalary('$80,000 - $100,000');
    expect(result.currency).toBe('USD');
    expect(result.minimum).toBe(80000);
    expect(result.maximum).toBe(100000);
  });

  it('parses €70K-€90K/year', () => {
    const result = normalizeSalary('€70K-€90K/year');
    expect(result.currency).toBe('EUR');
    expect(result.minimum).toBe(70000);
    expect(result.maximum).toBe(90000);
    expect(result.period).toBe('yearly');
  });

  it('parses $50/hr', () => {
    const result = normalizeSalary('$50/hr');
    expect(result.currency).toBe('USD');
    expect(result.period).toBe('hourly');
  });

  it('parses £45,000-£55,000 p.a.', () => {
    const result = normalizeSalary('£45,000-£55,000 p.a.');
    expect(result.currency).toBe('GBP');
    expect(result.minimum).toBe(45000);
    expect(result.maximum).toBe(55000);
    expect(result.period).toBe('yearly');
  });

  it('returns raw text when no match', () => {
    const result = normalizeSalary('Competitive salary');
    expect(result.raw).toBe('Competitive salary');
    expect(result.minimum).toBeNull();
    expect(result.maximum).toBeNull();
  });

  it('handles INR', () => {
    const result = normalizeSalary('₹15,00,000 - ₹25,00,000 per annum');
    expect(result.currency).toBe('INR');
  });
});
