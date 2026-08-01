import type { ProcessedSection } from '../types/input.types.js';
import type { ExtractedProject } from '../types/extracted.types.js';
import { mediumConfidence, lowConfidence } from '../utils/confidence.js';

const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'node', 'python', 'java', 'typescript', 'javascript',
  'django', 'flask', 'fastapi', 'express', 'spring', 'aws', 'azure', 'gcp', 'docker',
  'kubernetes', 'postgresql', 'mysql', 'mongodb', 'redis', 'graphql', 'rest', 'html', 'css',
  'pytorch', 'tensorflow', 'pandas', 'numpy', 'kafka', 'spark', 'airflow', 'llm', 'rag',
];

function extractTechFromLine(line: string): string[] {
  const tech: string[] = [];
  const lower = line.toLowerCase();
  for (const kw of TECH_KEYWORDS) {
    if (lower.includes(kw)) tech.push(kw);
  }
  return tech;
}

function extractUrl(line: string): string | null {
  const m = line.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.(?:com|dev|io|net|org)(?:\/[^\s]*)?/i);
  return m?.[0] || null;
}

export function extractProjects(sections: ProcessedSection[]): ExtractedProject[] {
  const projSection = sections.find(s => s.normalizedName === 'projects');
  if (!projSection) return [];

  const entries: ExtractedProject[] = [];
  const lines = projSection.content.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.length < 5) continue;

    const dashMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)/);
    if (dashMatch) {
      entries.push({
        name: dashMatch[1].trim(),
        description: dashMatch[2].trim(),
        technologies: extractTechFromLine(line),
        url: extractUrl(line),
        sourceSection: 'projects',
        confidence: mediumConfidence('Project dash pattern'),
      });
    } else if (line.length > 10 && line.length < 200) {
      entries.push({
        name: line.slice(0, 60),
        description: line,
        technologies: extractTechFromLine(line),
        url: extractUrl(line),
        sourceSection: 'projects',
        confidence: lowConfidence('Project line heuristic'),
      });
    }
  }

  return entries.slice(0, 10);
}
