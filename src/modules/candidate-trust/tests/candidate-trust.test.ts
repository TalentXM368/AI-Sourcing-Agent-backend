import { describe, expect, it } from 'vitest';
import { IdentityIndex } from '../engine/identity-index.js';
import { evaluateCandidate } from '../engine/run-checks.js';
import { experienceClaimCheck, timelineChecks } from '../checks/resume/timeline.js';
import { locationPhoneCheck, profileLinkChecks } from '../checks/fake/profile-checks.js';
import { compareNames, extractClaimedYears, githubUser, linkedinSlug, normalizeEmail, normalizePhone } from '../utils/normalize.js';
import { parseResumeDate } from '../utils/dates.js';
import type { TrustCandidate } from '../types.js';
import type { WorkHistoryEntry } from '../../../types.js';

const NOW = new Date(2026, 10, 25);

function cand(id: string, over: Partial<TrustCandidate> = {}): TrustCandidate {
  return {
    id, organizationId: 'org1', name: 'Priya Sharma', email: null, phone: null, linkedinUrl: null, githubUrl: null,
    location: null, workHistory: [], dataQualityScore: 90, textHash: null, claimedYears: null, contentHashes: [], templatePhrases: [],
    ...over,
  };
}

function job(title: string, company: string, from: string, to: string): WorkHistoryEntry {
  return { title, company, from, to };
}

function indexOf(...cs: TrustCandidate[]): IdentityIndex {
  const idx = new IdentityIndex();
  cs.forEach(c => idx.add(c));
  return idx;
}

describe('normalizers', () => {
  it('rejects junk emails and keeps real ones', () => {
    expect(normalizeEmail('2002@gmail.com')).toBeNull();
    expect(normalizeEmail('ab@x.com')).toBeNull();
    expect(normalizeEmail('noreply@company.com')).toBeNull();
    expect(normalizeEmail(' Priya.S@Gmail.com ')).toBe('priya.s@gmail.com');
  });

  it('keys phones on the last 10 digits and keeps explicit country codes', () => {
    expect(normalizePhone('+91-98731 11738')).toEqual({ key: '9873111738', countryCode: '91' });
    expect(normalizePhone('(774) 525-7008')).toEqual({ key: '7745257008', countryCode: null });
    expect(normalizePhone('0000000000')).toBeNull();
    expect(normalizePhone('12345')).toBeNull();
  });

  it('extracts LinkedIn slugs and GitHub users', () => {
    expect(linkedinSlug('https://www.linkedin.com/in/Priya-Sharma-12/')).toBe('priya-sharma-12');
    expect(linkedinSlug('https://linkedin.com/company/acme')).toBeNull();
    expect(githubUser('github.com/priyas/repo')).toBe('priyas');
    expect(githubUser('https://github.com/orgs/acme')).toBeNull();
  });

  it('compares names', () => {
    expect(compareNames('Priya Sharma', 'Sharma Priya')).toBe('same');
    expect(compareNames('Priya Sharma', 'P Sharma')).toBe('same');
    expect(compareNames('Priya Sharma', 'Rahul Verma')).toBe('different');
    expect(compareNames('Priya Sharma', 'PROFESSIONAL SUMMARY')).toBe('unknown');
  });

  it('parses resume dates', () => {
    expect(parseResumeDate('Jun 2024')).toMatchObject({ month: 2024 * 12 + 5, precision: 'month' });
    expect(parseResumeDate('06/2020')).toMatchObject({ month: 2020 * 12 + 5 });
    expect(parseResumeDate('2019')).toMatchObject({ precision: 'year' });
    expect(parseResumeDate('Present', NOW)).toMatchObject({ isPresent: true });
    expect(parseResumeDate('soon')).toBeNull();
  });

  it('finds the largest experience claim', () => {
    expect(extractClaimedYears('Over 8+ years of IT experience. 3 years experience in AWS.')).toBe(8);
    expect(extractClaimedYears('Worked 2019-2023')).toBeNull();
  });
});

describe('fake candidate checks', () => {
  it('flags the same phone under a different name as high', () => {
    const a = cand('a', { name: 'Priya Sharma', phone: '+1 774 525 7008' });
    const b = cand('b', { name: 'Rahul Verma', phone: '(774) 525-7008' });
    const r = evaluateCandidate(a, indexOf(a, b), ['fake'], NOW);
    const s = r.signals.find(x => x.signalType === 'shared_phone');
    expect(s?.severity).toBe('high');
    expect(s?.relatedCandidateIds).toEqual(['b']);
  });

  it('treats the same person twice as a duplicate record, not fraud', () => {
    const a = cand('a', { name: 'Priya Sharma', email: 'priya.s@gmail.com' });
    const b = cand('b', { name: 'Sharma Priya', email: 'priya.s@gmail.com' });
    const r = evaluateCandidate(a, indexOf(a, b), ['fake'], NOW);
    expect(r.signals.map(s => s.signalType)).toEqual(['duplicate_record']);
    expect(r.signals[0].severity).toBe('info');
  });

  it('labels a contact shared by many people as a vendor contact', () => {
    const names = ['Priya Sharma', 'Rahul Verma', 'Anita Desai', 'Karan Mehta'];
    const cs = names.map((n, i) => cand(`c${i}`, { name: n, email: 'bench.sales@vendor.com' }));
    const r = evaluateCandidate(cs[0], indexOf(...cs), ['fake'], NOW);
    expect(r.signals.find(s => s.signalType === 'shared_vendor_contact')?.severity).toBe('medium');
    expect(r.signals.some(s => s.signalType === 'shared_email')).toBe(false);
  });

  it('only compares candidates within the same organization', () => {
    const a = cand('a', { name: 'Priya Sharma', phone: '7745257008' });
    const b = cand('b', { name: 'Rahul Verma', phone: '7745257008', organizationId: 'org2' });
    expect(evaluateCandidate(a, indexOf(a, b), ['fake'], NOW).signals).toEqual([]);
  });

  it('flags the same work history under a different identity', () => {
    const work = [job('Engineer', 'Infosys', 'Jan 2018', 'Dec 2020'), job('Senior Engineer', 'TCS', 'Jan 2021', 'Present')];
    const a = cand('a', { name: 'Priya Sharma', email: 'priya.s@gmail.com', workHistory: work });
    const b = cand('b', { name: 'Rahul Verma', email: 'rahul.v@gmail.com', workHistory: work });
    const r = evaluateCandidate(a, indexOf(a, b), ['fake'], NOW);
    expect(r.signals.find(s => s.signalType === 'duplicate_work_history')?.severity).toBe('high');
  });

  it('flags copied resume lines but ignores boilerplate shared by many resumes', () => {
    const copied = ['h1', 'h2', 'h3', 'h4', 'h5'];
    const a = cand('a', { name: 'Priya Sharma', contentHashes: [...copied, 'boiler'] });
    const b = cand('b', { name: 'Rahul Verma', contentHashes: copied });
    const crowd = Array.from({ length: 20 }, (_, i) => cand(`x${i}`, { name: `Person Number${i}`, contentHashes: ['boiler'] }));
    const r = evaluateCandidate(a, indexOf(a, b, ...crowd), ['fake'], NOW);
    const s = r.signals.find(x => x.signalType === 'copied_resume_content');
    expect(s?.severity).toBe('medium');
    expect(s?.relatedCandidateIds).toEqual(['b']);
  });

  it('flags non-profile links and phone/location mismatches', () => {
    expect(profileLinkChecks(cand('a', { linkedinUrl: 'https://linkedin.com/company/acme' }))[0]?.signalType).toBe('invalid_profile_link');
    expect(locationPhoneCheck(cand('a', { phone: '+91 98731 11738', location: 'Austin, Texas' }))[0]?.severity).toBe('info');
    expect(locationPhoneCheck(cand('a', { phone: '+91 98731 11738', location: 'Pune, India' }))).toEqual([]);
    expect(locationPhoneCheck(cand('a', { phone: '9873111738', location: 'Austin, Texas' }))).toEqual([]);
  });

  it('ignores locations that are really a name, an email or a university', () => {
    const phone = '+91 98731 11738';
    expect(locationPhoneCheck(cand('a', { name: 'Karan Anand Shukla', phone, location: 'KARAN ANAND SHUKLA' }))).toEqual([]);
    expect(locationPhoneCheck(cand('a', { phone: '+1 774 525 7008', location: 'battukrishna.reddy 9964@gmail.com' }))).toEqual([]);
    expect(locationPhoneCheck(cand('a', { phone: '+1 774 525 7008', location: 'Technical University Lucknow, India' }))).toEqual([]);
  });

  it('treats a name with credentials as the same person', () => {
    expect(compareNames('Mark Sivilich MBA --', 'Mark Sivilich')).toBe('same');
    const a = cand('a', { name: 'Mark Sivilich MBA --', email: 'msivilich@msn.com', phone: '302-588-8365' });
    const b = cand('b', { name: 'Mark Sivilich', email: 'msivilich@msn.com', phone: '302-588-8365' });
    expect(evaluateCandidate(a, indexOf(a, b), ['fake'], NOW).signals.map(s => s.signalType)).toEqual(['duplicate_record']);
  });

  it('treats unreadable names that share two contact details as the same person', () => {
    const a = cand('a', { name: 'RESUME', email: 'priya.s@gmail.com', phone: '7745257008' });
    const b = cand('b', { name: 'CURRICULUM VITAE', email: 'priya.s@gmail.com', phone: '7745257008' });
    expect(evaluateCandidate(a, indexOf(a, b), ['fake'], NOW).signals.map(s => s.signalType)).toEqual(['duplicate_record']);
  });
});

describe('resume checks', () => {
  it('flags overlapping full-time jobs at different employers', () => {
    const c = cand('a', { workHistory: [job('Engineer', 'Infosys', 'Jan 2018', 'Dec 2021'), job('Engineer', 'Wipro', 'Jan 2020', 'Dec 2022')] });
    const s = timelineChecks(c, NOW).find(x => x.signalType === 'overlapping_roles');
    expect(s?.severity).toBe('low');
    expect(s?.evidence.longestMonths).toBe(23);
  });

  it('ignores overlaps for promotions, side roles and short notice periods', () => {
    const c = cand('a', {
      workHistory: [
        job('Engineer', 'Infosys Ltd', 'Jan 2018', 'Jun 2020'),
        job('Senior Engineer', 'Infosys', 'Jan 2020', 'Dec 2022'),
        job('Freelance Consultant', 'Self', 'Jan 2019', 'Dec 2022'),
        job('Lead', 'TCS', 'Oct 2022', 'Present'),
      ],
    });
    expect(timelineChecks(c, NOW).some(s => s.signalType === 'overlapping_roles')).toBe(false);
  });

  it('ignores the same job listed twice and education programs', () => {
    const c = cand('a', {
      workHistory: [
        job('Supply Planning Lead', 'Capgemini Technology Services Ltd', 'Sep 2022', 'Present'),
        job('Career Timeline', 'Capgemini Technology Services Ltd as Team Lead', 'Sep 2022', 'Present'),
        job('Executive Management Development Program', 'University of California Santa Cruz', 'Jan 2024', 'Aug 2024'),
        job('Analyst', 'Ford Motors', 'May 2019', 'Sep 2022'),
      ],
    });
    expect(timelineChecks(c, NOW).some(s => s.signalType === 'overlapping_roles')).toBe(false);
  });

  it('flags two current jobs at different companies (dual employment)', () => {
    const c = cand('a', {
      workHistory: [job('Senior Salesforce QA Lead', 'Areya Technologies', '05/2021', 'Present'), job('Senior Salesforce QA', 'Solutionzhere Software Consulting', '12/2022', 'Present')],
    });
    expect(timelineChecks(c, NOW).find(s => s.signalType === 'overlapping_roles')?.severity).toBe('low');
  });

  it('marks 3 simultaneous employers as medium', () => {
    const c = cand('a', {
      workHistory: [job('Dev', 'A Corp', 'Jan 2020', 'Dec 2022'), job('Dev', 'B Corp', 'Jan 2020', 'Dec 2022'), job('Dev', 'C Corp', 'Jan 2020', 'Dec 2022')],
    });
    expect(timelineChecks(c, NOW).find(s => s.signalType === 'overlapping_roles')?.severity).toBe('medium');
  });

  it('does not treat year-only ranges that touch as overlaps', () => {
    const c = cand('a', { workHistory: [job('Dev', 'A Corp', '2018', '2020'), job('Dev', 'B Corp', '2020', '2022')] });
    expect(timelineChecks(c, NOW).some(s => s.signalType === 'overlapping_roles')).toBe(false);
  });

  it('reports gaps as info', () => {
    const c = cand('a', { workHistory: [job('Dev', 'A Corp', 'Jan 2015', 'Dec 2016'), job('Dev', 'B Corp', 'Jan 2019', 'Present')] });
    const s = timelineChecks(c, NOW).find(x => x.signalType === 'employment_gap');
    expect(s?.severity).toBe('info');
    expect(s?.evidence).toEqual({ gaps: [{ afterRole: 0, beforeRole: 1, months: 25 }] });
  });

  it('skips timeline checks on low-quality parses', () => {
    const c = cand('a', { dataQualityScore: 60, workHistory: [job('Dev', 'A', 'Jan 2018', 'Dec 2021'), job('Dev', 'B', 'Jan 2019', 'Dec 2022')] });
    expect(timelineChecks(c, NOW)).toEqual([]);
  });

  it('flags a claimed total much longer than the dated roles, only when all roles are dated', () => {
    const work = [job('Dev', 'A Corp', 'Jan 2021', 'Dec 2022'), job('Dev', 'B Corp', 'Jan 2023', 'Present')];
    expect(experienceClaimCheck(cand('a', { claimedYears: 12, workHistory: work }), NOW)[0]?.signalType).toBe('experience_claim_mismatch');
    expect(experienceClaimCheck(cand('a', { claimedYears: 6, workHistory: work }), NOW)).toEqual([]);
    const withUndated = [...work, job('Dev', 'C Corp', '', '')];
    expect(experienceClaimCheck(cand('a', { claimedYears: 12, workHistory: withUndated }), NOW)).toEqual([]);
  });

  it('reports impossible dates', () => {
    const c = cand('a', { workHistory: [job('Dev', 'A Corp', 'Jan 2022', 'Dec 2020'), job('Dev', 'B Corp', 'Jan 2023', 'Present')] });
    expect(timelineChecks(c, NOW).find(s => s.signalType === 'invalid_role_dates')?.severity).toBe('info');
  });
});

describe('checklist', () => {
  it('lists passed, flagged and could-not-run checks in plain language', () => {
    const a = cand('a', {
      name: 'Priya Sharma', email: 'priya.s@gmail.com', phone: '+1 774 525 7008',
      workHistory: [job('Engineer', 'Infosys', 'Jan 2018', 'Dec 2021'), job('Engineer', 'Wipro', 'Jan 2020', 'Dec 2022')],
    });
    const b = cand('b', { name: 'Rahul Verma', phone: '(774) 525-7008' });
    const r = evaluateCandidate(a, indexOf(a, b), ['fake', 'resume'], NOW, 11032);
    const byId = Object.fromEntries(r.checklist.map(i => [i.id, i]));
    expect(byId.name.status).toBe('passed');
    expect(byId.email).toMatchObject({ status: 'passed', detail: 'Not used by any of 11,031 other candidates' });
    expect(byId.phone).toMatchObject({ status: 'flagged', severity: 'high' });
    expect(byId.linkedin).toMatchObject({ status: 'skipped', detail: 'No LinkedIn link on the resume' });
    expect(byId.overlaps).toMatchObject({ status: 'flagged', severity: 'low' });
    expect(byId.gaps.status).toBe('passed');
    expect(byId.experience).toMatchObject({ status: 'skipped' });
  });

  it('explains why resume checks could not run on an unclear resume', () => {
    const c = cand('a', { dataQualityScore: 50, workHistory: [job('Dev', 'A', 'Jan 2018', 'Dec 2021')] });
    const r = evaluateCandidate(c, indexOf(c), ['resume'], NOW);
    expect(r.checklist.every(i => i.status === 'skipped')).toBe(true);
    expect(r.checklist.find(i => i.id === 'overlaps')?.detail).toMatch(/not read clearly/);
  });
});

describe('placeholder / template details', () => {
  it('flags a filled-in resume template as high', () => {
    const c = cand('a', {
      name: 'Maple Dr.', email: 'email@email.com', phone: '617-555-1234', location: 'Anywhere, MA',
      templatePhrases: ['Describe the tasks…'],
    });
    const r = evaluateCandidate(c, indexOf(c), ['fake'], NOW);
    expect(r.signals.find(s => s.signalType === 'placeholder_details')?.severity).toBe('high');
    const byId = Object.fromEntries(r.checklist.map(i => [i.id, i]));
    expect(byId.name).toMatchObject({ status: 'flagged', severity: 'high' });
    expect(byId.email).toMatchObject({ status: 'flagged', severity: 'high' });
    expect(byId.phone.detail).toMatch(/555/);
    expect(byId.template.status).toBe('flagged');
  });

  it('marks a single sample detail as medium', () => {
    const c = cand('a', { email: 'priya@example.com' });
    expect(evaluateCandidate(c, indexOf(c), ['fake'], NOW).signals.find(s => s.signalType === 'placeholder_details')?.severity).toBe('medium');
  });

  it('does not flag common innocent cases', async () => {
    const { placeholderEmail } = await import('../utils/placeholders.js');
    expect(placeholderEmail('kalpeshwani@email.com')).toBeNull(); // email.com is a real provider
    for (const c of [
      cand('a', { name: 'Priyanka Sharma', phone: '8285555242' }),          // Indian mobile containing 555
      cand('b', { name: 'Delhi High Court' }),                              // heading read as the name
      cand('c', { name: 'Safronia Fife', location: 'Anywhere, USA' }),      // "open to relocate"
    ]) {
      expect(evaluateCandidate(c, indexOf(c), ['fake'], NOW).signals.some(s => s.signalType === 'placeholder_details')).toBe(false);
    }
  });

  it('leaves real details alone', () => {
    const c = cand('a', { name: 'Priya Sharma', email: 'priya.s@gmail.com', phone: '+91 98731 11738', location: 'Pune, India' });
    const r = evaluateCandidate(c, indexOf(c), ['fake'], NOW);
    expect(r.signals.some(s => s.signalType === 'placeholder_details')).toBe(false);
    expect(r.checklist.find(i => i.id === 'template')?.status).toBe('passed');
  });

  it('detects common template phrases', async () => {
    const { findTemplatePhrases, fictionalPhone } = await import('../utils/placeholders.js');
    expect(findTemplatePhrases('Describe the tasks and responsibilities of the job; be specific and use numbers')).toHaveLength(2);
    expect(findTemplatePhrases('Led a team of 5 engineers delivering payments APIs')).toEqual([]);
    expect(fictionalPhone('(212) 555-0147')?.strong).toBe(true);
    expect(fictionalPhone('+1 617 555 1234')?.strong).toBe(true);
    expect(fictionalPhone('8285555242')?.strong).toBe(false);
    expect(fictionalPhone('+91 98555 12345')).toBeNull();
  });
});
