import type { WorkHistoryEntry } from '../../types.js';

export type TrustSection = 'fake' | 'resume';
export type TrustSeverity = 'info' | 'low' | 'medium' | 'high';

export type TrustSignalType =
  // Fake candidate check
  | 'shared_email'
  | 'shared_phone'
  | 'shared_linkedin'
  | 'shared_github'
  | 'shared_vendor_contact'
  | 'duplicate_resume_file'
  | 'duplicate_work_history'
  | 'copied_resume_content'
  | 'duplicate_record'
  | 'invalid_profile_link'
  | 'location_phone_mismatch'
  | 'placeholder_details'
  // Resume check
  | 'overlapping_roles'
  | 'employment_gap'
  | 'missing_role_dates'
  | 'invalid_role_dates'
  | 'experience_claim_mismatch';

/** The compact view of a candidate that every check works on. Built once per candidate. */
export interface TrustCandidate {
  id: string;
  organizationId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  location: string | null;
  workHistory: WorkHistoryEntry[];
  dataQualityScore: number | null;
  /** md5 of the full resume text, if any. */
  textHash: string | null;
  /** Largest "N years of experience" claim found in the resume text. */
  claimedYears: number | null;
  /** Hashes of long, distinctive resume lines (achievements/descriptions). */
  contentHashes: string[];
  /** Resume-template instruction text found in the resume ("Describe the tasks…"). */
  templatePhrases: string[];
}

export interface TrustSignal {
  section: TrustSection;
  signalType: TrustSignalType;
  severity: TrustSeverity;
  /** Stable key for this finding on this candidate (survives re-runs). */
  fingerprint: string;
  title: string;
  explanation: string;
  evidence: Record<string, unknown>;
  relatedCandidateIds: string[];
}

/** One line of the per-candidate checklist: every check, including the ones that passed. */
export interface ChecklistItem {
  id: string;
  section: TrustSection;
  label: string;
  status: 'passed' | 'flagged' | 'skipped';
  /** Plain-language result ("No other candidate uses this email"). */
  detail: string;
  /** Highest severity of the signals behind a flagged item. */
  severity?: TrustSeverity;
  signalTypes?: TrustSignalType[];
}

export interface CandidateTrustResult {
  candidateId: string;
  sections: TrustSection[];
  signals: TrustSignal[];
  checklist: ChecklistItem[];
}
