export interface RecruiterEvaluation {
  candidateId: string;

  matchScore: number;
  crossEncoderAdjustment: number;
  displayScore: number;

  confidence: {
    level: 'High' | 'Medium' | 'Low';
    score: number;
  };

  cardSummary: string;
  detailSummary: DetailSummary;
  reasoning: RecommendationReasoning;

  rerankMetadata: {
    reranker: string;
    rawScore: number;
    adjustmentApplied: number;
  };

  aiMetadata: {
    provider: string;
    model: string;
    latencyMs: number;
    tokensUsed: number;
  };
}

export interface DetailSummary {
  overallFit: string;
  whyMatched: string;
  missingRequirements: string;
  potentialRisks: string;
  keyStrengths: string;
  interviewFocus: string;
  finalRecommendation: string;
}

export interface RecommendationReasoning {
  recommendation: 'Strong Hire' | 'Good Hire' | 'Consider' | 'Maybe' | 'Not Recommended';
  explanation: string;
  matchedSkills: number;
  requiredSkills: number;
  experience: string;
  education: string;
  industry: string;
  location: string;
  summary: string;
  whyCandidateStandsOut: string[];
  potentialRisks: string[];
  careerStability: string;
  careerProgression: string;
  domainExpertise: string;
  leadershipIndicators: string;
  suggestedInterviewFocus: string[];
  learningCurve: string;
  teamFit: string;
  availabilityNoticePeriod: string;
  salaryFit: string;
}

export interface RecruiterAIOutput {
  jobId: string;
  evaluations: RecruiterEvaluation[];
  metadata: {
    provider: string;
    model: string;
    reranker: string;
    totalCandidates: number;
    processedCandidates: number;
    processingTimeMs: number;
    tokensUsed: number;
  };
}
