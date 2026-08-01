import { parseISO, differenceInDays, differenceInMonths } from 'date-fns';
import { MONTH_MAP } from '../constants/index.js';

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const lower = dateStr.toLowerCase();

  if (lower.includes('present') || lower.includes('current') || lower.includes('now')) {
    return new Date();
  }

  // "Jan 2020" or "January 2020"
  const monthMatch = lower.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{4})/);
  if (monthMatch) {
    const month = MONTH_MAP[monthMatch[1].slice(0, 3)];
    if (month !== undefined) {
      return new Date(parseInt(monthMatch[2]), month, 1);
    }
  }

  // ISO 8601: "2020-03-15"
  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  // European DD/MM/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1]), b = parseInt(slashMatch[2]), year = parseInt(slashMatch[3]);
    if (a > 12) return new Date(year, b - 1, a);
    return new Date(year, a - 1, b);
  }

  // "01/2020" (MM/YYYY)
  const mmYyyyMatch = dateStr.match(/(\d{1,2})\/(\d{4})/);
  if (mmYyyyMatch) {
    const month = parseInt(mmYyyyMatch[1]) - 1;
    return new Date(parseInt(mmYyyyMatch[2]), month, 1);
  }

  // "Q1 2022"
  const quarterMatch = dateStr.match(/q([1-4])\s+(\d{4})/);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    return new Date(parseInt(quarterMatch[2]), (quarter - 1) * 3, 1);
  }

  // Bare year: "2020"
  const yearMatch = dateStr.match(/(\d{4})/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0, 1);
  }

  return null;
}

export function normalizeDateString(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const date = parseDate(dateStr);
  if (!date) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDurationMonths(startRaw: string | null, endRaw: string | null): number {
  if (!startRaw) return 0;

  const start = parseDate(startRaw);
  const end = endRaw ? parseDate(endRaw) : new Date();

  if (!start || !end) return 0;

  return Math.max(0, differenceInMonths(end, start));
}

export function isPresentDate(dateStr: string): boolean {
  return /\b(present|current|now)\b/i.test(dateStr);
}
