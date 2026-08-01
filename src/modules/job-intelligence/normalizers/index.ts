export { normalizeSeniority, detectSeniorityFromTitle, detectSeniorityFromText, getSeniorityOrder } from './seniority-normalizer.js';
export type { SeniorityLevel } from '../constants/index.js';

export { normalizeSalary } from './salary-normalizer.js';
export type { NormalizedSalary } from './salary-normalizer.js';

export { normalizeEmploymentType, normalizeWorkMode, detectEmploymentTypeFromSections } from './employment-normalizer.js';
export type { EmploymentType, WorkMode } from '../constants/index.js';

export { classifyIndustryFromText } from './industry-normalizer.js';
export type { Industry } from '../constants/index.js';

export { normalizeSkills } from '../../candidate-intelligence/normalizers/skill-normalizer.js';
export { normalizeDateString, calculateDurationMonths, isPresentDate } from '../../candidate-intelligence/normalizers/date-normalizer.js';
export { normalizeDegree, normalizeEducationLevel } from '../../candidate-intelligence/normalizers/degree-normalizer.js';
export { normalizeCity, normalizeState, normalizeCountry } from '../../candidate-intelligence/normalizers/location-normalizer.js';
