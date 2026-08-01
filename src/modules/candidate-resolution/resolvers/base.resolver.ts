import type { IResolver, FieldCandidate, ConsensusResult, ValidationResult } from '../interfaces/index.js';
import { runConsensus } from '../engines/consensus.engine.js';
import { computeConfidence } from '../engines/confidence.engine.js';
import type { KnowledgeService } from '../knowledge/index.js';

export abstract class BaseResolver<TInput, TOutput> implements IResolver<TInput, TOutput> {
  constructor(protected knowledge: KnowledgeService) {}

  abstract resolve(candidates: FieldCandidate<TInput>[]): ConsensusResult<TOutput>;
  abstract normalize(value: TInput): TOutput;
  abstract validate(value: TOutput): ValidationResult;

  calculateConfidence(result: ConsensusResult<TOutput>): number {
    return computeConfidence(result as ConsensusResult<unknown>, []).confidence;
  }

  protected runConsensusWithConfidence(
    candidates: FieldCandidate<TInput>[],
    normalizer: (value: TInput) => TOutput,
  ): { consensus: ConsensusResult<TOutput>; confidence: number; level: string; reasons: string[] } {
    const consensus = runConsensus(candidates as FieldCandidate<unknown>[], normalizer as (v: unknown) => unknown);
    const { confidence, level, reasons } = computeConfidence(consensus, candidates as FieldCandidate<unknown>[]);
    return { consensus: consensus as ConsensusResult<TOutput>, confidence, level, reasons };
  }
}
