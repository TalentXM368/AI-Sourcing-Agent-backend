import type { FieldCandidate } from './resolved-field.type.js';
import type { ConsensusResult } from './consensus-result.type.js';
import type { ValidationResult } from './resolved-field.type.js';

export interface IResolver<TInput, TOutput> {
  resolve(candidates: FieldCandidate<TInput>[]): ConsensusResult<TOutput>;
  normalize(value: TInput): TOutput;
  validate(value: TOutput): ValidationResult;
  calculateConfidence(result: ConsensusResult<TOutput>): number;
}
