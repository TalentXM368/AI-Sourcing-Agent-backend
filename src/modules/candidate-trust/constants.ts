/** Bump when any rule's logic changes, so stored signals can be traced to the rules that made them. */
export const TRUST_RULE_VERSION = 'trust-rules-1.0.0';

/** Timeline checks only run on resumes the parser read well; below this, flags are mostly parser misses. */
export const MIN_QUALITY_FOR_TIMELINE = 75;
/** Experience-claim check needs an even cleaner parse, since missed roles shrink the computed total. */
export const MIN_QUALITY_FOR_EXPERIENCE_CLAIM = 85;

/** A contact shared by this many different people is treated as an agency/vendor contact. */
export const VENDOR_CONTACT_MIN_PEOPLE = 4;

/** Overlap between two roles must exceed this many months to be flagged. */
export const MIN_OVERLAP_MONTHS = 6;
/** Same, when either role only has years (e.g. "2019 - 2020"), which overlap by construction. */
export const MIN_OVERLAP_MONTHS_YEAR_PRECISION = 13;
export const MIN_GAP_MONTHS = 12;

/** Claimed years must exceed computed years by both of these to be flagged. */
export const CLAIM_EXCESS_YEARS = 3;
export const CLAIM_EXCESS_RATIO = 1.5;

/** Content lines shorter than this are too generic to compare. */
export const MIN_CONTENT_LINE_LENGTH = 60;
/** Lines found in more resumes than this are boilerplate, not copying. */
export const MAX_CONTENT_LINE_SPREAD = 15;
export const COPIED_LINES_MEDIUM = 4;
export const COPIED_LINES_HIGH = 10;

/** Titles where holding another job at the same time is normal. */
export const CONCURRENT_OK_TITLE = /\b(freelanc|consult|contract|part[\s-]?time|intern|volunteer|adjunct|teach|tutor|mentor|advis|board|founder|co-?founder|owner|self[\s-]?employed|research assistant|teaching assistant|student)/i;
