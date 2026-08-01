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
} from '../../candidate-intelligence/utils/text-utils.js';

export {
  highConfidence,
  mediumConfidence,
  lowConfidence,
  noConfidence,
  mergeConfidence,
  boostConfidence,
  confidenceFromCount,
  confidenceFromLength,
} from '../../candidate-intelligence/utils/confidence.js';

export {
  nullSourceTracking,
  mergeSourceTracking,
} from '../../candidate-intelligence/utils/source-tracking.js';

export type { SourceTracking, Confidence } from '../../candidate-intelligence/types/common.types.js';
export { createConfidence, createSourceTracking } from '../../candidate-intelligence/types/common.types.js';

import type { SourceTracking, Confidence } from '../../candidate-intelligence/types/common.types.js';
import { createConfidence, createSourceTracking } from '../../candidate-intelligence/types/common.types.js';

export function st(
  raw: string,
  extractor: string,
  sourceSection: string,
  confidenceScore: number,
  reason: string = 'extracted',
): SourceTracking {
  return createSourceTracking(raw, extractor, sourceSection, createConfidence(confidenceScore, reason));
}

export function stNull(): null {
  return null;
}
