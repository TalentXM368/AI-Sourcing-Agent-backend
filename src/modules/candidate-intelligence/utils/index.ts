export {
  normalizeWhitespace,
  normalizeText,
  normalizeName,
  extractYear,
  extractDateRange,
  isPresentOrCurrent,
  collapseSpacedLetters,
  cleanFileName,
  truncate,
} from './text-utils.js';

export {
  highConfidence,
  mediumConfidence,
  lowConfidence,
  noConfidence,
  mergeConfidence,
  boostConfidence,
  confidenceFromCount,
  confidenceFromLength,
} from './confidence.js';

export {
  sourceTracking,
  nullSourceTracking,
  mergeSourceTracking,
} from './source-tracking.js';
