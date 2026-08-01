import type { ValidationContext } from '../types/index.js';
import { buildValidationPrompt, getPromptVersion } from '../prompts/index.js';

export class PromptBuilder {
  buildValidationPrompt(ctx: ValidationContext): string {
    return buildValidationPrompt(ctx);
  }

  getPromptVersion(fieldName: string): string {
    return getPromptVersion(fieldName);
  }

  buildSystemPrompt(): string {
    return 'You are a professional resume validation assistant. Respond only with valid JSON.';
  }

  truncateText(text: string, maxChars = 500): string {
    if (text.length <= maxChars) return text;
    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxChars - 50 ? truncated.substring(0, lastSpace) : truncated) + '...';
  }
}
