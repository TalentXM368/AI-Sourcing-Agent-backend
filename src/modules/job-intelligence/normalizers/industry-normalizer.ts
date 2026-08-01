import { INDUSTRY_KEYWORDS, type Industry } from '../constants/index.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function classifyIndustryFromText(text: string): { industry: Industry; confidence: number } {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const industry of Object.keys(INDUSTRY_KEYWORDS)) {
    scores[industry] = 0;
  }

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    for (const [keyword, weight] of Object.entries(keywords)) {
      const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'i');
      if (pattern.test(lower)) {
        scores[industry] += weight;
      }
    }
  }

  let best: Industry = 'Other';
  let bestScore = 0;
  for (const [industry, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = industry as Industry;
    }
  }

  return {
    industry: best,
    confidence: Math.min(bestScore / 15, 1.0),
  };
}
