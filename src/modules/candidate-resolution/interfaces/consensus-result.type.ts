export interface ConsensusResult<T> {
  selected: T;
  normalized: T;
  alternatives: T[];
  confidence: number;
  confidenceLevel: string;
  reasons: string[];
  sources: string[];
  conflictDetected: boolean;
  conflictDetails?: string;
}
