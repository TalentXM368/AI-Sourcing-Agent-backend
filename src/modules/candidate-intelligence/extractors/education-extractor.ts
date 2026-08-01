import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedEducation } from '../types/extracted.types.js';
import { DEGREE_ALIASES, EDUCATION_LEVEL_MAP } from '../constants/degree-aliases.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';
import { extractYear } from '../utils/text-utils.js';

const SCHOOL_KEYWORDS = [
  'university', 'college', 'institute', 'school', 'academy', 'polytechnic',
  'iit', 'nit', 'iiit', 'bits', 'vit', 'amity', 'anna', 'mumbai', 'delhi',
  'bangalore', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad',
  'bootcamp', 'codecamp', 'code academy', 'general assembly', 'le wagon',
  'springboard', 'flatiron', 'app academy', 'hack reactor', 'devmountain',
  'thinkful', 'nucamp', 'ironhack', 'epicodus', 'techtonic',
  'coursera', 'udemy', 'edx', 'udacity', 'pluralsight', 'linkedin learning',
  'codecademy', 'khan academy', 'nanodegree', 'datacamp', 'treehouse',
  'skillshare', 'brilliant', 'freecodecamp',
];

const DEGREE_KEYWORDS = [
  'b.tech', 'm.tech', 'bachelor', 'master', 'phd', 'mba', 'bca', 'mca',
  'bsc', 'msc', 'be ', 'me ', 'b.e.', 'm.e.', 'b.s.', 'm.s.',
  'associate', 'diploma', 'certificate', 'professional certificate',
  'nanodegree', 'specialization', 'executive', 'fellowship', 'doctorate',
  'bachelor of', 'master of', 'ph.d', 'postgraduate', 'undergraduate',
  'bba', 'b.com', 'm.com', 'b.arch', 'm.arch', 'b.farm', 'm.farm',
  'llb', 'llm', 'b.des', 'm.des', 'bfa', 'mfa', 'bhm', 'mhsm',
  'b.ed', 'm.ed', 'bps', 'mps',
];

function extractSchool(line: string): string | null {
  const schoolMatch = line.match(/([A-Z][A-Za-z\s]*(?:University|College|Institute|School|Academy|Polytechnic|Point|Bootcamp|Coursera|Udemy|edX|Udacity|Pluralsight|LinkedIn Learning|Codecademy|General Assembly|Le Wagon|Springboard|Flatiron|App Academy|Hack Reactor|DevMountain|Thinkful|Nucamp|Ironhack|Epicodus|Techtonic)[A-Za-z\s]*)/i);
  return schoolMatch ? schoolMatch[1].trim() : null;
}

function extractDegree(line: string): { degree: string | null; specialization: string | null } {
  const degreePatterns = [
    /(?:Bachelor|B\.?Tech|B\.?E\.|B\.?Sc|B\.?CA|B\.?Com|B\.?BA|B\.?BS)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
    /(?:Master|M\.?Tech|M\.?E\.|M\.?Sc|M\.?CA|M\.?Com|M\.?BA|M\.?BS|MBA)[^\s,]*(?:\s*(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
    /(?:PhD|Ph\.?D)[^\s,]*(?:\s+in\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
    /(?:Diploma|Class\s*(?:X|XI|XII|10|11|12))[^\s,]*(?:\s+(?:of|in)\s+[A-Za-z\s]+?)?(?:\s*[,–|]|$)/i,
  ];

  for (const pattern of degreePatterns) {
    const m = line.match(pattern);
    if (m) {
      const degreeStr = m[0].trim();
      const specMatch = line.match(/(?:in|of)\s+([A-Za-z\s]+?)(?:\s*[,–|\(]|$)/i);
      const specialization = specMatch && !specMatch[1].trim().includes('University')
        ? specMatch[1].trim() : null;
      return { degree: degreeStr, specialization };
    }
  }

  // Check degree keywords
  for (const keyword of DEGREE_KEYWORDS) {
    if (line.toLowerCase().includes(keyword)) {
      return { degree: keyword, specialization: null };
    }
  }

  return { degree: null, specialization: null };
}

function getEducationLevel(degree: string | null): string | null {
  if (!degree) return null;
  const lower = degree.toLowerCase();
  for (const [keyword, level] of Object.entries(EDUCATION_LEVEL_MAP)) {
    if (lower.includes(keyword)) return level;
  }
  return null;
}

function extractGraduationYear(line: string): string | null {
  return extractYear(line);
}

export function extractEducation(sections: ProcessedSection[]): ExtractedEducation[] {
  const eduSection = sections.find(s => s.normalizedName === 'education');
  if (!eduSection) return [];

  const entries: ExtractedEducation[] = [];
  const lines = eduSection.content.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.length < 3) continue;

    const hasInstitutionKeyword = SCHOOL_KEYWORDS.some(kw =>
      line.toLowerCase().includes(kw.toLowerCase())
    );
    const hasDegreeKeyword = DEGREE_KEYWORDS.some(kw =>
      line.toLowerCase().includes(kw.toLowerCase())
    );

    if (!hasInstitutionKeyword && !hasDegreeKeyword) continue;
    if (!hasInstitutionKeyword && hasDegreeKeyword) {
      const hasYear = /\b(20\d{2}|19\d{2})\b/.test(line);
      if (!hasYear) continue;
    }

    const school = extractSchool(line);
    if (!school) continue;

    const { degree, specialization } = extractDegree(line);
    const graduationYearRaw = extractGraduationYear(line);
    const educationLevel = getEducationLevel(degree);

    entries.push({
      degree: degree || 'Unknown',
      specialization,
      university: school,
      graduationYearRaw,
      sourceSection: 'education',
      confidence: mediumConfidence('Education section match'),
    });
  }

  return entries.slice(0, 5);
}
