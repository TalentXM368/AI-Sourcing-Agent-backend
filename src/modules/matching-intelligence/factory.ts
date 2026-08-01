import type { EmbeddingService } from '../vector-intelligence/services/embedding-service.js';
import { MatchingService } from './services/matching-service.js';
import { createMatchingRouter } from './routes/matching.routes.js';

let matchingService: MatchingService | null = null;

export function createMatchingServices(embeddingService: EmbeddingService) {
  matchingService = new MatchingService(embeddingService);
  return { matchingService };
}

export function getMatchingRouter(embeddingService: EmbeddingService) {
  const { matchingService: ms } = createMatchingServices(embeddingService);
  return createMatchingRouter(ms);
}

export function getMatchingService(): MatchingService | null {
  return matchingService;
}
