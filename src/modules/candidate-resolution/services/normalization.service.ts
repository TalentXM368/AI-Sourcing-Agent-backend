import { KnowledgeService } from '../knowledge/index.js';

export class NormalizationService {
  constructor(private knowledge: KnowledgeService) {}

  normalizeField(fieldName: string, value: string): string {
    switch (fieldName) {
      case 'company': return this.knowledge.resolveCompany(value) || value;
      case 'skill': return value.toLowerCase().trim();
      case 'jobTitle': return this.knowledge.resolveJobTitle(value) || value;
      case 'degree': return this.knowledge.resolveDegree(value) || value;
      case 'location': return value;
      default: return value;
    }
  }
}
