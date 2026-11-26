import { classifyRegion, type Region } from '../../../../services/region-classifier.js';
import { githubUser, linkedinSlug, normalizePhone } from '../../utils/normalize.js';
import type { TrustCandidate, TrustSignal } from '../../types.js';

/** Calling code → region, using the same region names as region-classifier. */
const CALLING_CODE_REGION: Record<string, Region> = {
  '1': 'USA', '91': 'India',
  '44': 'Europe', '49': 'Europe', '33': 'Europe', '34': 'Europe', '39': 'Europe', '31': 'Europe', '32': 'Europe',
  '41': 'Europe', '43': 'Europe', '46': 'Europe', '47': 'Europe', '45': 'Europe', '48': 'Europe', '351': 'Europe',
  '353': 'Europe', '358': 'Europe', '30': 'Europe', '40': 'Europe', '36': 'Europe', '380': 'Europe', '420': 'Europe',
  '52': 'LATAM', '55': 'LATAM', '54': 'LATAM', '56': 'LATAM', '57': 'LATAM', '51': 'LATAM', '58': 'LATAM',
  '593': 'LATAM', '598': 'LATAM', '506': 'LATAM', '507': 'LATAM',
  '971': 'Middle East', '966': 'Middle East', '974': 'Middle East', '965': 'Middle East', '968': 'Middle East',
  '973': 'Middle East', '972': 'Middle East',
  '234': 'Africa', '27': 'Africa', '254': 'Africa', '20': 'Africa', '233': 'Africa', '212': 'Africa',
  '61': 'Asia-Pacific', '64': 'Asia-Pacific', '65': 'Asia-Pacific', '60': 'Asia-Pacific', '63': 'Asia-Pacific',
  '62': 'Asia-Pacific', '66': 'Asia-Pacific', '84': 'Asia-Pacific', '81': 'Asia-Pacific', '82': 'Asia-Pacific',
  '86': 'Asia-Pacific', '852': 'Asia-Pacific', '92': 'Asia-Pacific', '880': 'Asia-Pacific', '94': 'Asia-Pacific',
  '977': 'Asia-Pacific',
};

export function profileLinkChecks(c: TrustCandidate): TrustSignal[] {
  const problems: Array<{ field: string; value: string; reason: string }> = [];
  if (c.linkedinUrl && !linkedinSlug(c.linkedinUrl)) {
    problems.push({ field: 'linkedin', value: c.linkedinUrl, reason: 'not a personal LinkedIn profile URL (linkedin.com/in/...)' });
  }
  if (c.githubUrl && !githubUser(c.githubUrl)) {
    problems.push({ field: 'github', value: c.githubUrl, reason: 'not a GitHub user or repository URL' });
  }
  if (!problems.length) return [];
  return [{
    section: 'fake', signalType: 'invalid_profile_link', severity: 'info',
    fingerprint: `invalid_profile_link:${problems.map(p => p.field).join(',')}`,
    title: 'Profile link does not point to a personal profile',
    explanation: problems.map(p => `${p.field === 'linkedin' ? 'LinkedIn' : 'GitHub'} link "${p.value}" is ${p.reason}.`).join(' ')
      + ' Ask the candidate for the correct link.',
    evidence: { problems }, relatedCandidateIds: [],
  }];
}

/**
 * Only trust a parsed location that looks like "City, State/Country". The parser
 * sometimes stores an email, the candidate's name or a university here, and the
 * region classifier matches substrings ("uk" inside "Shukla").
 */
function usableLocation(c: TrustCandidate): boolean {
  const loc = c.location?.trim() ?? '';
  if (!loc || loc.length > 60 || !loc.includes(',')) return false;
  if (/[@\d]/.test(loc) || /\b(universit|college|institute|school)/i.test(loc)) return false;
  const nameTokens = c.name.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const lower = loc.toLowerCase();
  return !nameTokens.some(t => lower.includes(t));
}

export function locationPhoneCheck(c: TrustCandidate): TrustSignal[] {
  const phone = normalizePhone(c.phone);
  if (!phone?.countryCode || !usableLocation(c)) return [];
  const phoneRegion = CALLING_CODE_REGION[phone.countryCode];
  const locationRegion = classifyRegion(c.location!);
  if (!phoneRegion || locationRegion === 'Unknown/Global' || phoneRegion === locationRegion) return [];
  return [{
    section: 'fake', signalType: 'location_phone_mismatch', severity: 'info',
    fingerprint: `location_phone_mismatch:${phone.countryCode}:${locationRegion}`,
    title: 'Phone country does not match stated location',
    explanation: `The resume gives the location as "${c.location!}" (${locationRegion}) but the phone number has country code +${phone.countryCode} (${phoneRegion}). Often just a recent move; confirm where the candidate is based and their work authorization.`,
    evidence: { location: c.location!, locationRegion, countryCode: phone.countryCode, phoneRegion },
    relatedCandidateIds: [],
  }];
}
