/**
 * Detects sample / placeholder details left in a resume template ("email@email.com",
 * "617-555-1234", "Anywhere, MA", "Describe the tasks and responsibilities…").
 *
 * Each finding is either `strong` (real resumes essentially never have it) or
 * supporting (has innocent explanations on its own, e.g. a parser reading a heading
 * as the name, or an Indian mobile number that happens to contain 555). Supporting
 * findings only count when they appear together with others.
 */

export interface PlaceholderFinding {
  field: 'name' | 'email' | 'phone' | 'location' | 'text';
  reason: string;
  strong: boolean;
}

// email.com / mail.com are real providers, so only clearly fake domains here.
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  'example.com', 'example.org', 'example.net', 'domain.com', 'yourdomain.com', 'youremail.com',
  'test.com', 'sample.com', 'website.com',
]);
const PLACEHOLDER_EMAIL_LOCALS = new Set([
  'email', 'name', 'yourname', 'your.name', 'your_name', 'youremail', 'firstname.lastname', 'firstnamelastname',
  'first.last', 'firstlast', 'test', 'sample', 'someone', 'username', 'johndoe', 'john.doe', 'janedoe', 'jane.doe',
]);

export function placeholderEmail(raw: string | null | undefined): PlaceholderFinding | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  const [, local, domain] = m;
  if (PLACEHOLDER_EMAIL_LOCALS.has(local)) return { field: 'email', reason: `"${raw.trim()}" is a sample email address`, strong: true };
  if (PLACEHOLDER_EMAIL_DOMAINS.has(domain)) return { field: 'email', reason: `"${raw.trim()}" uses a sample email domain`, strong: true };
  return null;
}

/** Explicitly North American formatting: +1 prefix or "(617) 555-1234". */
const NANP_FORMAT = /^\s*(\+\s?1[\s.-]?\(?\d{3}\)?|\(\d{3}\))[\s.-]?\d{3}[\s.-]?\d{4}\s*$/;

export function fictionalPhone(raw: string | null | undefined): PlaceholderFinding | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  if (/^(\d)\1{9}$/.test(ten) || ['1234567890', '0123456789', '9876543210', '1231231234'].includes(ten)) {
    return { field: 'phone', reason: `"${raw.trim()}" is a sample phone number`, strong: true };
  }
  if (ten.slice(3, 6) !== '555') return null;
  // 555-0100..0199 is officially reserved for fiction; other 555 numbers are only
  // suspicious when the number is clearly North American (Indian mobiles contain 555 too).
  const officiallyFictional = /^01\d\d$/.test(ten.slice(6));
  const clearlyNorthAmerican = NANP_FORMAT.test(raw) || (digits.length === 11 && digits.startsWith('1'));
  return {
    field: 'phone',
    reason: `"${raw.trim()}" uses the 555 exchange that resume templates and films use`,
    strong: officiallyFictional || clearlyNorthAmerican,
  };
}

const PLACEHOLDER_LOCATION = /\b(anywhere|anytown|any town|your city|city,\s*state|city,\s*country|address line)\b/i;

export function placeholderLocation(raw: string | null | undefined): PlaceholderFinding | null {
  if (!raw || !PLACEHOLDER_LOCATION.test(raw)) return null;
  // "Anywhere" can mean "open to relocate", so it only supports other findings.
  return { field: 'location', reason: `"${raw.trim()}" is a sample location`, strong: false };
}

const PLACEHOLDER_NAMES = /^(your name|first name last name|firstname lastname|first last|john doe|jane doe|name surname|full name|candidate name)$/i;
const STREET_SUFFIX = /\b(st|street|dr|drive|ave|avenue|rd|road|ln|lane|blvd|boulevard|pkwy|hwy|apt)\.?$/i;

export function placeholderName(raw: string | null | undefined): PlaceholderFinding | null {
  if (!raw) return null;
  const name = raw.trim();
  if (PLACEHOLDER_NAMES.test(name)) return { field: 'name', reason: `"${name}" is a sample name`, strong: true };
  // Usually the parser reading an address line as the name: suspicious only alongside other findings.
  if (STREET_SUFFIX.test(name) || /^\d+\s/.test(name)) return { field: 'name', reason: `"${name}" looks like a street address, not a name`, strong: false };
  return null;
}

/** Instruction text that resume templates contain and real resumes don't. */
const TEMPLATE_PHRASES: Array<[RegExp, string]> = [
  [/describe (the|your) (tasks|duties|responsibilities)/i, 'Describe the tasks…'],
  [/lorem ipsum/i, 'Lorem ipsum'],
  [/be specific and use numbers/i, 'Be specific and use numbers…'],
  [/\[\s*your [a-z ]{2,20}\]|\(\s*your [a-z ]{2,20}\)|<\s*your [a-z ]{2,20}>/i, '[Your …]'],
  [/\b(insert|enter|type|add) your (name|email|phone|address|title|experience|skills)\b/i, 'Insert your …'],
  [/\breplace (this|the) (text|placeholder)/i, 'Replace this text'],
  [/\bclick here to (add|edit|type|enter)/i, 'Click here to …'],
  [/\b(company name|job title|school name|degree name) here\b/i, '… here'],
  [/\b(month|mm)\s*\/?\s*(year|yyyy)\s*[-–]\s*(month|mm|present)/i, 'Month Year – Month Year'],
  [/\bresume template\b|\bsample resume\b/i, 'Resume template'],
  [/\byour (accomplishments|achievements) during your time\b/i, 'Your accomplishments during your time…'],
];

/** Template phrases found in the text (deduplicated labels). */
export function findTemplatePhrases(text: string | null | undefined): string[] {
  if (!text) return [];
  const sample = text.slice(0, 12000);
  return TEMPLATE_PHRASES.filter(([re]) => re.test(sample)).map(([, label]) => label);
}
