import type { ResolvedCandidateProfile } from '../../candidate-resolution/types/index.js';
import type { ResolvedField } from '../../candidate-resolution/interfaces/index.js';
import type { ValidationContext } from '../types/index.js';
import { CONFIDENCE_THRESHOLDS, AI_EXCLUDED_FIELDS } from '../constants/index.js';

interface FieldExtraction {
  fieldName: string;
  value: string;
  confidence: number;
  raw: string;
  isValid: boolean;
  validationWarnings: string[];
}

export class ConfidenceAnalyzer {
  analyze(profile: ResolvedCandidateProfile, options?: { skipFields?: string[]; forceFields?: string[] }): ValidationContext[] {
    const contexts: ValidationContext[] = [];
    const skipSet = new Set(options?.skipFields || []);
    const forceSet = new Set(options?.forceFields || []);

    const candidateName = profile.personal.name?.value || 'Unknown';
    const nearbyText = this.buildNearbyText(profile);

    const fields = this.extractAllFields(profile);

    for (const field of fields) {
      if (skipSet.has(field.fieldName)) continue;
      if (AI_EXCLUDED_FIELDS.has(field.fieldName) && !forceSet.has(field.fieldName)) continue;

      const shouldValidate = forceSet.has(field.fieldName) ||
        field.confidence < CONFIDENCE_THRESHOLDS.SKIP_AI;

      if (!shouldValidate) continue;

      const isLowConfidence = field.confidence < CONFIDENCE_THRESHOLDS.VALIDATE;

      contexts.push({
        fieldName: field.fieldName,
        currentValue: field.value,
        confidence: field.confidence,
        nearbyText: nearbyText,
        alternatives: [],
        candidateName,
      });

      if (isLowConfidence) {
        const existing = contexts.find(c => c.fieldName === field.fieldName);
        if (existing) {
          existing.confidence = field.confidence;
        }
      }
    }

    return contexts;
  }

  private extractAllFields(profile: ResolvedCandidateProfile): FieldExtraction[] {
    const fields: FieldExtraction[] = [];

    this.addField(fields, 'personal.name', profile.personal.name);
    this.addField(fields, 'personal.headline', profile.personal.headline);

    this.addField(fields, 'contact.city', profile.contact.city);
    this.addField(fields, 'contact.state', profile.contact.state);
    this.addField(fields, 'contact.country', profile.contact.country);

    for (let i = 0; i < profile.experience.length; i++) {
      const exp = profile.experience[i];
      this.addField(fields, 'experience.company', exp.company, i);
      this.addField(fields, 'experience.title', exp.title, i);
    }

    for (let i = 0; i < profile.education.length; i++) {
      const edu = profile.education[i];
      this.addField(fields, 'education.degree', edu.degree, i);
      this.addField(fields, 'education.specialization', edu.specialization, i);
      this.addField(fields, 'education.university', edu.university, i);
    }

    for (let i = 0; i < profile.projects.length; i++) {
      const proj = profile.projects[i];
      this.addField(fields, 'projects.name', proj.name, i);
      this.addField(fields, 'projects.description', proj.description, i);
    }

    for (let i = 0; i < profile.certifications.length; i++) {
      const cert = profile.certifications[i];
      this.addField(fields, 'certifications.name', cert.name, i);
      this.addField(fields, 'certifications.issuer', cert.issuer, i);
    }

    for (let i = 0; i < profile.languages.length; i++) {
      const lang = profile.languages[i];
      this.addField(fields, 'languages.name', lang.name, i);
    }

    for (let i = 0; i < profile.skills.length; i++) {
      const skill = profile.skills[i];
      this.addField(fields, 'skills', skill, i);
    }

    return fields;
  }

  private addField(
    fields: FieldExtraction[],
    fieldName: string,
    resolved: ResolvedField<unknown> | null | undefined,
    index?: number,
  ): void {
    if (!resolved || resolved.value === null || resolved.value === undefined) return;
    const name = index !== undefined ? `${fieldName}[${index}]` : fieldName;
    fields.push({
      fieldName: name,
      value: String(resolved.value),
      confidence: resolved.confidence,
      raw: resolved.raw,
      isValid: resolved.isValid,
      validationWarnings: resolved.validationWarnings,
    });
  }

  private buildNearbyText(profile: ResolvedCandidateProfile): string {
    const parts: string[] = [];

    if (profile.personal.name?.value) parts.push(`Name: ${profile.personal.name.value}`);
    if (profile.personal.headline?.value) parts.push(`Title: ${profile.personal.headline.value}`);
    if (profile.personal.summary) parts.push(`Summary: ${profile.personal.summary.substring(0, 300)}`);

    for (const exp of profile.experience.slice(0, 3)) {
      const company = exp.company?.value || '';
      const title = exp.title?.value || '';
      if (company || title) parts.push(`Experience: ${title} at ${company}`);
    }

    for (const edu of profile.education.slice(0, 2)) {
      const degree = edu.degree?.value || '';
      const uni = edu.university?.value || '';
      if (degree || uni) parts.push(`Education: ${degree} from ${uni}`);
    }

    if (profile.skills.length > 0) {
      parts.push(`Skills: ${profile.skills.map(s => String(s.value)).join(', ')}`);
    }

    return parts.join('\n').substring(0, 800);
  }
}
