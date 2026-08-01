export interface FieldCandidate<T> {
  value: T;
  source: string;
  sourceSection: string;
  confidence: number;
  priority: number;
}

export interface ResolvedField<T> {
  value: T;
  raw: string;
  confidence: number;
  confidenceLevel: 'very_high' | 'high' | 'medium' | 'low';
  reasons: string[];
  sources: string[];
  isValid: boolean;
  validationWarnings: string[];
}

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
}
