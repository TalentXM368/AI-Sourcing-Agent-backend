import type { MatchingWeights } from '../types/index.js';

export const MATCHING_CONSTANTS = {
  VERSION: '1.0.0',
  DEFAULT_TOP_K: parseInt(process.env.VECTOR_SEARCH_TOP_K || '100', 10),
  MAX_TOP_K: 500,

  WEIGHTS: {
    requiredSkills: 0.35,
    semanticSimilarity: 0.25,
    experience: 0.15,
    education: 0.05,
    industry: 0.05,
    location: 0.05,
    employment: 0.03,
    salary: 0.02,
  } satisfies MatchingWeights,

  QUALITY_BONUS: {
    MIN_MULTIPLIER: 0.95,
    MAX_MULTIPLIER: 1.05,
    MAX_BONUS_RANGE: 0.10,
  },

  THRESHOLDS: {
    STRONG_MATCH: 85,
    GOOD_MATCH: 70,
    POTENTIAL_MATCH: 50,
    WEAK_MATCH: 0,
  },

  SKILL_MATCH: {
    EXACT_WEIGHT: 1.0,
    ALIAS_WEIGHT: 0.9,
    RELATED_WEIGHT: 0.7,
  },

  CONFIDENCE_FACTORS: {
    COMPLETENESS_WEIGHT: 0.25,
    VALIDATION_WEIGHT: 0.25,
    PARSING_WEIGHT: 0.20,
    SKILL_COVERAGE_WEIGHT: 0.20,
    TIMELINE_WEIGHT: 0.10,
  },

  INDUSTRY_GROUPS: {
    technology: ['technology', 'software', 'it', 'computer', 'saas', 'fintech', 'edtech', 'healthtech'],
    healthcare: ['healthcare', 'medical', 'pharmaceutical', 'biotech', 'health'],
    finance: ['finance', 'banking', 'insurance', 'investment', 'fintech', 'accounting'],
    retail: ['retail', 'ecommerce', 'e-commerce', 'consumer', 'fashion'],
    manufacturing: ['manufacturing', 'industrial', 'automotive', 'aerospace'],
    education: ['education', 'edtech', 'learning', 'academic'],
    energy: ['energy', 'oil', 'gas', 'renewable', 'utilities'],
    media: ['media', 'entertainment', 'gaming', 'publishing'],
    consulting: ['consulting', 'professional services', 'advisory'],
    logistics: ['logistics', 'supply chain', 'transportation', 'shipping'],
  },

  SENIORITY_LEVELS: [
    'intern', 'junior', 'mid', 'senior', 'lead', 'principal',
    'staff', 'director', 'vp', 'c-level', 'executive',
  ],

  EMPLOYMENT_TYPES: ['full-time', 'part-time', 'contract', 'internship', 'freelance'],
  WORK_MODES: ['remote', 'hybrid', 'onsite', 'flexible'],
} as const;
