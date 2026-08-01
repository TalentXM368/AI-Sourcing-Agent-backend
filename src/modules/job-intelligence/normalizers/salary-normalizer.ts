import {
  CURRENCY_SYMBOLS,
  SALARY_PERIOD_KEYWORDS,
  type SalaryPeriod,
} from '../constants/index.js';

export interface NormalizedSalary {
  currency: string | null;
  minimum: number | null;
  maximum: number | null;
  period: SalaryPeriod;
  raw: string;
}

const SALARY_PATTERNS = [
  /([\$€£¥₹])\s*([\d,]+(?:\.\d{2})?)\s*k?\s*[-–to]+\s*([\$€£¥₹])?\s*([\d,]+(?:\.\d{2})?)\s*k?/i,
  /([\d,]+(?:\.\d{2})?)\s*k?\s*[-–to]+\s*([\d,]+(?:\.\d{2})?)\s*k?\s*(usd|eur|gbp|inr|cad|aud|cny|jpy|sgd)/i,
  /([\$€£¥₹])\s*([\d,]+(?:\.\d{2})?)\s*k?/i,
  /([\d,]+(?:\.\d{2})?)\s*k?\s*(usd|eur|gbp|inr|cad|aud|cny|jpy|sgd)/i,
];

export function normalizeSalary(raw: string): NormalizedSalary {
  const lower = raw.toLowerCase().trim();
  const result: NormalizedSalary = {
    currency: null,
    minimum: null,
    maximum: null,
    period: 'yearly',
    raw,
  };

  result.currency = detectCurrency(lower);
  result.period = detectPeriod(lower);

  for (const pattern of SALARY_PATTERNS) {
    const match = raw.match(pattern);
    if (match) {
      if (match[2] && match[4]) {
        result.minimum = parseSalaryNumber(match[2]);
        result.maximum = parseSalaryNumber(match[4]);
        if (!result.currency && match[1]) result.currency = detectCurrency(match[1]);
      } else if (match[2]) {
        result.minimum = parseSalaryNumber(match[2]);
        result.maximum = null;
      }
      break;
    }
  }

  if (lower.includes('k') && result.minimum !== null) {
    if (result.minimum < 1000) result.minimum = result.minimum * 1000;
    if (result.maximum !== null && result.maximum < 1000) result.maximum = result.maximum * 1000;
  }

  return result;
}

function detectCurrency(text: string): string | null {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

function detectPeriod(text: string): SalaryPeriod {
  for (const [period, keywords] of Object.entries(SALARY_PERIOD_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) return period as SalaryPeriod;
    }
  }
  return 'yearly';
}

function parseSalaryNumber(raw: string): number {
  const cleaned = raw.replace(/[,.\s]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}
