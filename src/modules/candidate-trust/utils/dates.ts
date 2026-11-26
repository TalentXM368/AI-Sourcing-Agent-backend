const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const PRESENT = /^(present|current|currently|now|till date|to date|today|ongoing|date)$/i;

export interface ResumeDate {
  /** Months since year 0 (year * 12 + month), so differences are in months. */
  month: number;
  precision: 'month' | 'year';
  isPresent: boolean;
}

function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export function nowMonth(now: Date = new Date()): number {
  return monthIndex(now.getFullYear(), now.getMonth());
}

/** Parses the date strings the resume parser stores ("Jun 2024", "06/2020", "2019", "Present"). */
export function parseResumeDate(raw: string | null | undefined, now: Date = new Date()): ResumeDate | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  if (PRESENT.test(s)) return { month: nowMonth(now), precision: 'month', isPresent: true };

  let m = s.match(/^([a-z]{3,4})[a-z]*\.?\s*[,'’/-]?\s*(\d{2}|\d{4})$/);
  if (m && m[1] in MONTHS) return { month: monthIndex(expandYear(m[2]), MONTHS[m[1]]), precision: 'month', isPresent: false };
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { month: monthIndex(+m[2], +m[1] - 1), precision: 'month', isPresent: false };
  m = s.match(/^(\d{4})[/.-](\d{1,2})(?:[/.-]\d{1,2})?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { month: monthIndex(+m[1], +m[2] - 1), precision: 'month', isPresent: false };
  m = s.match(/^\d{1,2}[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return { month: monthIndex(+m[2], +m[1] - 1), precision: 'month', isPresent: false };
  m = s.match(/^((?:19|20)\d{2})$/);
  if (m) return { month: monthIndex(+m[1], 0), precision: 'year', isPresent: false };
  return null;
}

function expandYear(y: string): number {
  const n = parseInt(y, 10);
  if (y.length === 4) return n;
  return n > 50 ? 1900 + n : 2000 + n;
}

export function formatMonth(month: number): string {
  const y = Math.floor(month / 12);
  const mo = month % 12;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo]} ${y}`;
}
