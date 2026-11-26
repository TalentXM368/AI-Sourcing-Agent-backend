import { looksLikePersonName } from '../../../parsers/deterministic-resume-parser.js';
import { MIN_QUALITY_FOR_EXPERIENCE_CLAIM, MIN_QUALITY_FOR_TIMELINE } from '../constants.js';
import { parseTimeline, totalMonths } from '../checks/resume/timeline.js';
import { cleanPersonName, githubUser, linkedinSlug, normalizeEmail, normalizePhone } from '../utils/normalize.js';
import { identityKeys } from './identity-index.js';
import type { ChecklistItem, TrustCandidate, TrustSection, TrustSeverity, TrustSignal, TrustSignalType } from '../types.js';

const RANK: Record<TrustSeverity, number> = { info: 0, low: 1, medium: 2, high: 3 };

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Turns the signals for one candidate into a readable checklist that also lists
 * the checks that passed and the ones that could not run (and why).
 */
export function buildChecklist(
  c: TrustCandidate,
  signals: TrustSignal[],
  sections: TrustSection[],
  comparedAgainst: number,
  now: Date = new Date(),
): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const pool = comparedAgainst > 1 ? `${fmtCount(comparedAgainst - 1)} other candidates` : 'other candidates';

  /** Adds an item that is flagged when any of `types` fired, otherwise passed (or skipped). */
  const add = (
    section: TrustSection, id: string, label: string, types: TrustSignalType[],
    passed: string, skipped: string | null,
  ) => {
    const hits = signals.filter(s => types.includes(s.signalType));
    if (hits.length) {
      const top = hits.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a));
      items.push({ id, section, label, status: 'flagged', detail: top.title, severity: top.severity, signalTypes: [...new Set(hits.map(h => h.signalType))] });
    } else if (skipped) {
      items.push({ id, section, label, status: 'skipped', detail: skipped });
    } else {
      items.push({ id, section, label, status: 'passed', detail: passed });
    }
  };

  if (sections.includes('fake')) {
    const keys = identityKeys(c);
    // Sample/template findings only show as red when the combined placeholder check fired.
    const placeholder = signals.find(s => s.signalType === 'placeholder_details');
    const placeholderSeverity = placeholder?.severity ?? 'medium';
    const foundByField = new Map<string, string>(
      ((placeholder?.evidence.found as Array<{ field: string; reason: string }> | undefined) ?? []).map(f => [f.field, f.reason]),
    );
    const fakeField = (field: string, label: string, id: string): boolean => {
      const reason = foundByField.get(field);
      if (!reason) return false;
      items.push({ id, section: 'fake', label, status: 'flagged', severity: placeholderSeverity, signalTypes: ['placeholder_details'], detail: reason.charAt(0).toUpperCase() + reason.slice(1) });
      return true;
    };

    if (!fakeField('name', 'Name', 'name')) {
      const nameOk = looksLikePersonName(cleanPersonName(c.name || ''));
      items.push(nameOk
        ? { id: 'name', section: 'fake', label: 'Name', status: 'passed', detail: `Read as "${cleanPersonName(c.name)}"` }
        : { id: 'name', section: 'fake', label: 'Name', status: 'skipped', detail: 'The name could not be read clearly, so name comparisons are limited' });
    }
    if (!fakeField('email', 'Email address', 'email')) {
      add('fake', 'email', 'Email address', ['shared_email', 'shared_vendor_contact'],
        `Not used by any of ${pool}`, normalizeEmail(c.email) ? null : (c.email ? 'The email on the resume looks incomplete' : 'No email on the resume'));
    }
    if (!fakeField('phone', 'Phone number', 'phone')) {
      add('fake', 'phone', 'Phone number', ['shared_phone', 'shared_vendor_contact'],
        `Not used by any of ${pool}`, normalizePhone(c.phone) ? null : (c.phone ? 'The phone number looks incomplete' : 'No phone number on the resume'));
    }
    // Location and template text have no other check, so they get their own line.
    const templateReasons = [foundByField.get('location'), foundByField.get('text')].filter(Boolean) as string[];
    if (templateReasons.length) {
      items.push({ id: 'template', section: 'fake', label: 'Template or sample text', status: 'flagged', severity: placeholderSeverity, signalTypes: ['placeholder_details'], detail: templateReasons.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join('. ') });
    } else {
      items.push({ id: 'template', section: 'fake', label: 'Template or sample text', status: 'passed', detail: 'No sample details or template instructions found' });
    }
    if (c.linkedinUrl && !linkedinSlug(c.linkedinUrl)) {
      items.push({ id: 'linkedin', section: 'fake', label: 'LinkedIn profile', status: 'flagged', severity: 'info', signalTypes: ['invalid_profile_link'], detail: 'The LinkedIn link is not a personal profile link' });
    } else {
      add('fake', 'linkedin', 'LinkedIn profile', ['shared_linkedin'], `Not used by any of ${pool}`, c.linkedinUrl ? null : 'No LinkedIn link on the resume');
    }
    if (c.githubUrl && !githubUser(c.githubUrl)) {
      items.push({ id: 'github', section: 'fake', label: 'GitHub account', status: 'flagged', severity: 'info', signalTypes: ['invalid_profile_link'], detail: 'The GitHub link is not a profile link' });
    } else {
      add('fake', 'github', 'GitHub account', ['shared_github'], `Not used by any of ${pool}`, c.githubUrl ? null : 'No GitHub link on the resume');
    }
    add('fake', 'resume_file', 'Same resume under another name', ['duplicate_resume_file'],
      'No identical resume found under a different name', keys.text ? null : 'Resume text not available to compare');
    add('fake', 'work_history', 'Same jobs under another name', ['duplicate_work_history'],
      'No one else lists the same employers with the same dates', keys.work ? null : 'Fewer than 2 jobs with dates, so this could not be compared');
    add('fake', 'copied_text', 'Copied resume text', ['copied_resume_content'],
      'No word-for-word copied lines from other resumes', c.contentHashes.length ? null : 'No job descriptions to compare');
    add('fake', 'duplicates', 'Duplicate records', ['duplicate_record'],
      'Only one record for this person', null);
  }

  if (sections.includes('resume')) {
    const lowQuality = (c.dataQualityScore ?? 0) < MIN_QUALITY_FOR_TIMELINE;
    const { dated, undated, invalid } = parseTimeline(c, now);
    const unreadable = lowQuality ? 'The resume was not read clearly enough to check dates reliably' : null;
    const noJobs = c.workHistory.length === 0 ? 'No work history found on the resume' : null;

    add('resume', 'role_dates', 'Job dates present', ['missing_role_dates', 'invalid_role_dates'],
      `All ${c.workHistory.length} job${c.workHistory.length === 1 ? '' : 's'} have usable dates`, unreadable ?? noJobs);
    const fewDated = dated.length < 2 ? 'Fewer than 2 jobs with dates' : null;
    add('resume', 'overlaps', 'Overlapping jobs', ['overlapping_roles'],
      'No full-time jobs held at the same time', unreadable ?? noJobs ?? fewDated);
    add('resume', 'gaps', 'Employment gaps', ['employment_gap'],
      'No gaps longer than 12 months', unreadable ?? noJobs ?? fewDated);

    const computed = Math.round((totalMonths(dated) / 12) * 10) / 10;
    let claimSkip: string | null = null;
    if (c.claimedYears === null) claimSkip = 'The resume does not state a total years of experience';
    else if ((c.dataQualityScore ?? 0) < MIN_QUALITY_FOR_EXPERIENCE_CLAIM) claimSkip = 'The resume was not read clearly enough to compare';
    else if (dated.length < 2 || undated > 0 || invalid.length > 0) claimSkip = 'Not every job has dates, so the total cannot be compared';
    add('resume', 'experience', 'Experience claim', ['experience_claim_mismatch'],
      `Claims ${c.claimedYears} years; the listed jobs add up to about ${computed} years`, claimSkip);
  }

  return items;
}
