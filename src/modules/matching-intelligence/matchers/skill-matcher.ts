import type { SkillMatchResult } from '../types/index.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import { SKILL_ALIASES } from '../../candidate-intelligence/constants/skill-aliases.js';
import { MATCHING_CONSTANTS } from '../constants/index.js';
import { getAliasesForCanonical } from '../constants/skill-lookup.js';

const SKILL_RELATIONSHIPS: Record<string, string[]> = {
  'javascript': ['typescript', 'react', 'angular', 'vue', 'node.js', 'nodejs'],
  'typescript': ['javascript', 'react', 'angular', 'vue', 'node.js'],
  'react': ['javascript', 'typescript', 'next.js', 'nextjs', 'vue', 'angular'],
  'python': ['django', 'flask', 'fastapi', 'pandas', 'numpy', 'scipy'],
  'java': ['spring', 'spring boot', 'kotlin'],
  'node.js': ['javascript', 'typescript', 'express', 'nest.js'],
  'postgresql': ['sql', 'postgres', 'database', 'mysql'],
  'mysql': ['sql', 'database', 'postgresql'],
  'mongodb': ['nosql', 'database', 'dynamodb'],
  'aws': ['ec2', 's3', 'lambda', 'cloud', 'ecs', 'eks'],
  'gcp': ['google cloud', 'cloud', 'bigquery', 'gke'],
  'azure': ['cloud', 'azure devops', 'aks'],
  'docker': ['kubernetes', 'k8s', 'containers', 'containerization'],
  'kubernetes': ['docker', 'k8s', 'containers', 'helm'],
  'machine learning': ['ml', 'ai', 'deep learning', 'neural networks', 'pytorch', 'tensorflow'],
  'deep learning': ['machine learning', 'ml', 'ai', 'pytorch', 'tensorflow', 'neural networks'],
  'data science': ['machine learning', 'ml', 'statistics', 'python', 'r'],
  'devops': ['ci/cd', 'jenkins', 'github actions', 'terraform', 'infrastructure'],
  'ci/cd': ['devops', 'jenkins', 'github actions', 'gitlab ci'],
  'terraform': ['infrastructure', 'iac', 'devops', 'aws', 'cloud'],
  'agile': ['scrum', 'kanban', 'project management'],
  'rest api': ['rest', 'api', 'graphql', 'http'],
  'graphql': ['rest api', 'api', 'apollo'],
  'git': ['github', 'gitlab', 'bitbucket', 'version control'],
  'css': ['html', 'sass', 'scss', 'tailwind', 'bootstrap'],
  'html': ['css', 'javascript', 'web development'],
  'vue': ['javascript', 'typescript', 'react', 'nuxt'],
  'angular': ['javascript', 'typescript', 'react', 'rxjs'],
  'swift': ['ios', 'xcode', 'objective-c'],
  'kotlin': ['android', 'java', 'spring boot'],
  'rust': ['systems programming', 'wasm', 'webassembly'],
  'go': ['golang', 'microservices', 'docker', 'kubernetes'],
  'ruby': ['rails', 'ruby on rails', 'sinatra'],
  'php': ['laravel', 'symfony', 'wordpress'],
  'scala': ['spark', 'akka', 'functional programming'],
};

function normalizeSkill(skill: string): string {
  const lower = skill.toLowerCase().trim();
  return SKILL_ALIASES[lower as keyof typeof SKILL_ALIASES] || lower;
}

function getRelatedSkills(skill: string): string[] {
  const normalized = normalizeSkill(skill);
  const related = SKILL_RELATIONSHIPS[normalized] || [];
  const expanded: string[] = [];
  for (const r of related) {
    const nr = normalizeSkill(r);
    expanded.push(nr);
    for (const rr of (SKILL_RELATIONSHIPS[nr] || [])) {
      expanded.push(normalizeSkill(rr));
    }
  }
  return [...new Set(expanded)];
}

export function matchSkills(
  job: JobProfile,
  candidate: CandidateProfile,
): SkillMatchResult {
  const requiredSkills = job.requiredSkills.map(s => normalizeSkill(s.canonical));
  const preferredSkills = job.preferredSkills.map(s => normalizeSkill(s.canonical));
  const candidateSkills = candidate.skills.map(s => normalizeSkill(s.canonical));

  const candidateSkillSet = new Set(candidateSkills);
  const jobSkillSet = new Set([...requiredSkills, ...preferredSkills]);

  const matched: string[] = [];
  const aliasMatched: string[] = [];
  const relatedMatched: string[] = [];
  const missing: string[] = [];

  for (const req of requiredSkills) {
    if (candidateSkillSet.has(req)) {
      matched.push(req);
    } else {
      const aliases = getAliasesForCanonical(req);
      const foundAlias = aliases.find(a => candidateSkillSet.has(a));
      if (foundAlias) {
        aliasMatched.push(req);
      } else {
        const related = getRelatedSkills(req);
        const foundRelated = related.find(r => candidateSkillSet.has(r));
        if (foundRelated) {
          relatedMatched.push(req);
        } else {
          missing.push(req);
        }
      }
    }
  }

  const additional = candidateSkills.filter(s => !jobSkillSet.has(s));

  const totalRequired = requiredSkills.length;
  if (totalRequired === 0) return {
    matched: [], missing: [], additional, aliasMatched: [], relatedMatched: [], score: 100,
  };

  const weightedSum =
    matched.length * MATCHING_CONSTANTS.SKILL_MATCH.EXACT_WEIGHT +
    aliasMatched.length * MATCHING_CONSTANTS.SKILL_MATCH.ALIAS_WEIGHT +
    relatedMatched.length * MATCHING_CONSTANTS.SKILL_MATCH.RELATED_WEIGHT;

  const score = Math.round((weightedSum / totalRequired) * 100);

  return {
    matched: [...matched, ...aliasMatched],
    missing,
    additional,
    aliasMatched,
    relatedMatched,
    score: Math.min(score, 100),
  };
}
