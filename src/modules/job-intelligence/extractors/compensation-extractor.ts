import type { SourceTracking, ProcessedSection, ExtractedJobCompensation } from '../types/index.js';
import { st } from '../utils/index.js';
import { normalizeSalary, type NormalizedSalary } from '../normalizers/salary-normalizer.js';

export function extractJobCompensation(
  sections: ProcessedSection[],
  fullText: string,
): ExtractedJobCompensation {
  const salarySection = sections.find(s => s.normalizedName === 'salary');
  const benefitsSection = sections.find(s => s.normalizedName === 'benefits');

  const salaryText = salarySection?.content || '';
  const salaryNormalized = salaryText ? normalizeSalary(salaryText) : null;

  const benefits = benefitsSection ? extractBenefits(benefitsSection.content) : [];

  return {
    salaryCurrency: salaryNormalized?.currency
      ? st(salaryNormalized.currency, 'compensation-extractor', 'salary', 0.8)
      : null,
    salaryMinimum: salaryNormalized?.minimum
      ? st(String(salaryNormalized.minimum), 'compensation-extractor', 'salary', 0.8)
      : null,
    salaryMaximum: salaryNormalized?.maximum
      ? st(String(salaryNormalized.maximum), 'compensation-extractor', 'salary', 0.8)
      : null,
    salaryPeriod: salaryNormalized?.period
      ? st(salaryNormalized.period, 'compensation-extractor', 'salary', 0.8)
      : null,
    salaryRaw: salaryText
      ? st(salaryText, 'compensation-extractor', 'salary', 0.9)
      : null,
    benefits,
  };
}

function extractBenefits(content: string): string[] {
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const benefits: string[] = [];

  for (const line of lines) {
    const cleaned = line.replace(/^[-•*▪▸→]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
    if (cleaned.length > 3 && cleaned.length < 150) {
      benefits.push(cleaned);
    }
  }

  return benefits.slice(0, 20);
}
