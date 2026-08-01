import { z } from 'zod';

export const EnrichmentResultSchema = z.object({
  industry: z.string().nullable(),
  domain: z.string().nullable(),
  seniority: z.enum(['entry', 'mid', 'senior', 'lead', 'executive', 'unknown']).nullable(),
  primaryRole: z.string().nullable(),
  secondaryRoles: z.array(z.string()),
  technologyStack: z.array(z.string()),
  functionalArea: z.string().nullable(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  reason: z.string().min(1),
});
export type EnrichmentResult = z.infer<typeof EnrichmentResultSchema>;

export const ENRICHMENT_SCHEMA = EnrichmentResultSchema;
