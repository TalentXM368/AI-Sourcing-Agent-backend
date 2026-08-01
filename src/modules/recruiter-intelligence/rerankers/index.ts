import type { RerankerProvider } from '../types/provider.types.js';
import { CohereReranker } from './cohere-reranker.js';
import { LocalReranker } from './local-reranker.js';
import { RERANKER_CONFIG } from '../constants/index.js';

export { BaseReranker } from './base-reranker.js';
export { CohereReranker } from './cohere-reranker.js';
export { LocalReranker } from './local-reranker.js';

export function createReranker(type?: 'cohere' | 'local-bge' | 'local-jina' | 'none'): RerankerProvider | null {
  const effectiveType = type || RERANKER_CONFIG.default;

  switch (effectiveType) {
    case 'cohere': {
      const reranker = new CohereReranker();
      return reranker.available ? reranker : null;
    }
    case 'local-bge': {
      return new LocalReranker('BAAI/bge-reranker-v2-m3');
    }
    case 'local-jina': {
      return new LocalReranker('jinaai/jina-reranker-v2-base-multilingual');
    }
    case 'none':
      return null;
    default:
      return null;
  }
}
