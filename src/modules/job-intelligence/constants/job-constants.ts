export const JOB_PIPELINE_VERSION = '3.0.0';

export const SENIORITY_LEVELS = [
  'intern', 'junior', 'mid', 'senior', 'lead', 'staff',
  'principal', 'architect', 'director', 'vp', 'executive',
] as const;

export type SeniorityLevel = typeof SENIORITY_LEVELS[number];

export const SENIORITY_KEYWORDS: Record<SeniorityLevel, string[]> = {
  intern: ['intern', 'internship', 'trainee', 'co-op', 'coop'],
  junior: ['junior', 'jr', 'entry level', 'entry-level', 'associate', 'graduate'],
  mid: ['mid level', 'mid-level', 'intermediate', 'standard'],
  senior: ['senior', 'sr', 'sr.', 'experienced', 'seasoned'],
  lead: ['lead', 'team lead', 'tech lead', 'technical lead'],
  staff: ['staff', 'staff engineer'],
  principal: ['principal', 'distinguished', 'fellow'],
  architect: ['architect', 'solution architect', 'solutions architect', 'systems architect'],
  director: ['director', 'head of', 'dept head'],
  vp: ['vice president', 'vp', 'svp', 'evp'],
  executive: ['executive', 'c-level', 'cto', 'ceo', 'cfo', 'coo', 'cpo', 'cio', 'cmo'],
};

export const EMPLOYMENT_TYPES = [
  'full-time', 'part-time', 'contract', 'internship',
  'temporary', 'freelance', 'consultant', 'temporary-to-hire',
] as const;

export type EmploymentType = typeof EMPLOYMENT_TYPES[number];

export const EMPLOYMENT_TYPE_KEYWORDS: Record<EmploymentType, string[]> = {
  'full-time': ['full-time', 'full time', 'permanent', 'fte'],
  'part-time': ['part-time', 'part time'],
  'contract': ['contract', 'contractor', '1099', 'w2'],
  'internship': ['intern', 'internship', 'co-op', 'trainee'],
  'temporary': ['temporary', 'temp', 'seasonal'],
  'freelance': ['freelance', 'freelancer', 'self-employed'],
  'consultant': ['consultant', 'consulting'],
  'temporary-to-hire': ['temp-to-hire', 'temporary to hire', 'contract to hire', 'contract-to-hire'],
};

export const WORK_MODES = ['remote', 'hybrid', 'onsite', 'flexible'] as const;

export type WorkMode = typeof WORK_MODES[number];

export const WORK_MODE_KEYWORDS: Record<WorkMode, string[]> = {
  remote: ['remote', 'work from home', 'wfh', 'distributed', 'anywhere', 'work from anywhere', 'fully remote', '100% remote'],
  hybrid: ['hybrid', 'flexible location', 'partial remote', '2 days in office', '3 days in office'],
  onsite: ['onsite', 'on-site', 'in-office', 'in office', 'on site', 'on campus'],
  flexible: ['flexible', 'flex', 'either remote or onsite'],
};

export const INDUSTRIES = [
  'Technology', 'Healthcare', 'Finance', 'Retail', 'Manufacturing',
  'Education', 'Government', 'Construction', 'Telecom', 'Insurance',
  'Legal', 'Automotive', 'Energy', 'Media', 'Agriculture', 'Other',
] as const;

export type Industry = typeof INDUSTRIES[number];

export const SALARY_PERIODS = ['hourly', 'monthly', 'yearly'] as const;

export type SalaryPeriod = typeof SALARY_PERIODS[number];

export const SALARY_PERIOD_KEYWORDS: Record<SalaryPeriod, string[]> = {
  hourly: ['/hr', '/hour', 'per hour', 'hourly', '/h'],
  monthly: ['/month', '/mo', 'per month', 'monthly', '/m'],
  yearly: ['/year', '/yr', 'per year', 'annually', 'per annum', 'p.a.', 'yearly', 'annual', '/y'],
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  'usd': 'USD',
  'us$': 'USD',
  '€': 'EUR',
  'eur': 'EUR',
  '£': 'GBP',
  'gbp': 'GBP',
  '¥': 'JPY',
  'jpy': 'JPY',
  '₹': 'INR',
  'inr': 'INR',
  'cny': 'CNY',
  'rmb': 'CNY',
  'cad': 'CAD',
  'aud': 'AUD',
  'chf': 'CHF',
  'kr': 'SEK',
  'sek': 'SEK',
  'nok': 'NOK',
  'sgd': 'SGD',
  'hkd': 'HKD',
};

export const PIPELINE_VERSION = JOB_PIPELINE_VERSION;
