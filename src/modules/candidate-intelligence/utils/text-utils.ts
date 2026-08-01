export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeText(text: string): string {
  return normalizeWhitespace(text).toLowerCase();
}

export function normalizeName(name: string): string {
  return normalizeWhitespace(name)
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .trim();
}

export function extractYear(text: string): string | null {
  const m = text.match(/\b(20\d{2}|19\d{2})\b/);
  return m ? m[1] : null;
}

export function extractDateRange(text: string): { startRaw: string; endRaw: string } | null {
  for (const pattern of [
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4})\s*(?:[-–—]|to)+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{4}|present|current|now)/i,
    /(\d{4})\s*(?:[-–—]|to)+\s*(\d{4}|present|current|now)/i,
    /(\d{1,2}\/\d{4})\s*(?:[-–—]|to)+\s*(\d{1,2}\/\d{4}|present|current|now)/i,
  ]) {
    const m = text.match(pattern);
    if (m) return { startRaw: m[1], endRaw: m[2] };
  }
  return null;
}

export function isPresentOrCurrent(text: string): boolean {
  return /\b(present|current|now)\b/i.test(text);
}

export function collapseSpacedLetters(text: string): string {
  const tokens = text.split(/\s+/);
  const allSingle = tokens.length >= 3 && tokens.every(t => t.length === 1);
  if (allSingle) return tokens.join('');
  return text;
}

export function cleanFileName(text: string): string {
  return text.replace(/\.(?:pdf|docx?|txt)$/i, '').trim();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
