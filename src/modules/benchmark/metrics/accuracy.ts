export interface PrecisionRecallResult {
  precision: number;
  recall: number;
  f1: number;
}

export function calculatePrecisionRecall(
  retrieved: string[],
  relevant: string[],
): PrecisionRecallResult {
  const relevantSet = new Set(relevant);
  const retrievedSet = new Set(retrieved);

  let truePositives = 0;
  for (const item of retrieved) {
    if (relevantSet.has(item)) truePositives++;
  }

  const precision = retrieved.length > 0 ? truePositives / retrieved.length : 0;
  const recall = relevant.length > 0 ? truePositives / relevant.length : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1 };
}

export function calculateNDCG(
  scores: number[],
  idealScores: number[],
): number {
  if (scores.length === 0 || idealScores.length === 0) return 0;

  const dcg = scores.reduce((sum, score, i) => sum + score / Math.log2(i + 2), 0);
  const idcg = idealScores.reduce((sum, score, i) => sum + score / Math.log2(i + 2), 0);

  return idcg > 0 ? dcg / idcg : 0;
}

export function calculateMAP(
  rankedLists: string[][],
  groundTruth: string[][],
): number {
  if (rankedLists.length === 0) return 0;

  let sumAP = 0;
  for (let i = 0; i < rankedLists.length; i++) {
    const ranked = rankedLists[i];
    const truth = new Set(groundTruth[i] || []);
    let relevantCount = 0;
    let sumPrecision = 0;

    for (let j = 0; j < ranked.length; j++) {
      if (truth.has(ranked[j])) {
        relevantCount++;
        sumPrecision += relevantCount / (j + 1);
      }
    }

    const ap = relevantCount > 0 ? sumPrecision / relevantCount : 0;
    sumAP += ap;
  }

  return sumAP / rankedLists.length;
}

export function calculateAccuracy(
  predicted: string[],
  actual: string[],
): { exactMatch: number; overlap: number } {
  const predictedSet = new Set(predicted);
  const actualSet = new Set(actual);

  let matches = 0;
  for (const item of predicted) {
    if (actualSet.has(item)) matches++;
  }

  const exactMatch = predicted.length === actual.length && matches === predicted.length ? 1 : 0;
  const overlap = predictedSet.size + actualSet.size > 0
    ? matches / (predictedSet.size + actualSet.size - matches)
    : 0;

  return { exactMatch, overlap };
}
