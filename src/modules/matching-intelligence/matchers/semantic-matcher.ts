export function matchSemantic(qdrantScore: number): number {
  return Math.round(Math.max(0, Math.min(1, qdrantScore)) * 100);
}
