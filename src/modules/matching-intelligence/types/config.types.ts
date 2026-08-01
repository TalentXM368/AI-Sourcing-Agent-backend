export interface MatchingWeights {
  requiredSkills: number;
  semanticSimilarity: number;
  experience: number;
  education: number;
  industry: number;
  location: number;
  employment: number;
  salary: number;
}

export interface MatchingConfig {
  topK: number;
  weights: MatchingWeights;
  qualityBonusEnabled: boolean;
}
