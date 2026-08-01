import type { FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { BaseResolver } from './base.resolver.js';
import type { KnowledgeService } from '../knowledge/index.js';

interface ProjectInput {
  name: string;
  description: string | null;
  technologies: string[];
  url: string | null;
  sourceSection: string;
  confidence: number;
}

export class ProjectResolver extends BaseResolver<ProjectInput, ProjectInput> {
  constructor(knowledge: KnowledgeService) {
    super(knowledge);
  }

  resolve(candidates: FieldCandidate<ProjectInput>[]): ConsensusResult<ProjectInput> {
    if (candidates.length === 0) {
      return {
        selected: null as unknown as ProjectInput,
        normalized: null as unknown as ProjectInput,
        alternatives: [],
        confidence: 0,
        confidenceLevel: 'low',
        reasons: ['No project candidates'],
        sources: [],
        conflictDetected: false,
      };
    }

    const selected = candidates.reduce((best, curr) =>
      curr.confidence > best.confidence ? curr : best
    );

    return {
      selected: selected.value,
      normalized: this.normalize(selected.value),
      alternatives: candidates.filter(c => c !== selected).map(c => c.value),
      confidence: selected.confidence,
      confidenceLevel: '',
      reasons: ['Project resolved by confidence'],
      sources: candidates.map(c => c.source),
      conflictDetected: false,
    };
  }

  normalize(value: ProjectInput): ProjectInput {
    return {
      ...value,
      name: value.name.trim(),
    };
  }

  validate(value: ProjectInput): ValidationResult {
    const warnings: string[] = [];
    if (!value.name || value.name.length < 3) warnings.push('Project name too short');
    return { isValid: warnings.length === 0, warnings };
  }
}
