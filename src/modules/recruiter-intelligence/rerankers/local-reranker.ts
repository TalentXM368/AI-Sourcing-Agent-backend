import { BaseReranker } from './base-reranker.js';
import type { RerankerResult } from '../types/provider.types.js';
import { RERANKER_CONFIG } from '../constants/index.js';

export class LocalReranker extends BaseReranker {
  private model: string;

  constructor(model?: string) {
    super('local');
    this.model = model || RERANKER_CONFIG.localModel;
  }

  async rerank(query: string, documents: string[], topN: number): Promise<RerankerResult[]> {
    return this.withRetry(async () => {
      const pairs = documents.map(doc => [query, doc]);

      const scores = await this.callCrossEncoder(pairs);

      const results: RerankerResult[] = scores
        .map((score, index) => ({
          index,
          score,
          document: documents[index],
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);

      return results;
    });
  }

  private async callCrossEncoder(pairs: string[][]): Promise<number[]> {
    const pythonScript = `
import sys
import json
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

model_name = "${this.model}"
pairs = json.loads(sys.argv[1])

tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSequenceClassification.from_pretrained(model_name)
model.eval()

with torch.no_grad():
    inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=512)
    logits = model(**inputs, return_dict=True).logits.view(-1,).float()
    scores = torch.sigmoid(logits).tolist()

print(json.dumps(scores))
`;

    const pairsJson = JSON.stringify(pairs);

    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile('python', ['-c', pythonScript, pairsJson], {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(`Cross-encoder failed: ${error.message}\n${stderr}`));
          return;
        }
        try {
          const scores = JSON.parse(stdout.trim()) as number[];
          resolve(scores);
        } catch (e) {
          reject(new Error(`Failed to parse cross-encoder output: ${stdout}`));
        }
      });
    });
  }
}
