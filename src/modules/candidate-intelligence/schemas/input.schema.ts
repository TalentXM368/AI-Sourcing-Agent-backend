import { z } from 'zod';

export const DoclingSectionSchema = z.object({
  name: z.string(),
  content: z.string(),
  level: z.number().optional(),
  pageNumber: z.number().optional(),
});

export const DoclingTableSchema = z.object({
  markdown: z.string(),
  pageNumber: z.number().optional(),
});

export const DoclingImageSchema = z.object({
  caption: z.string().optional(),
  pageNumber: z.number().optional(),
});

export const DoclingMetadataSchema = z.object({
  pages: z.number().optional(),
  language: z.string().optional(),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
});

export const DoclingBlockSchema = z.object({
  type: z.string(),
  text: z.string(),
  pageNumber: z.number().optional(),
});

export const DoclingASTSchema = z.object({
  totalPages: z.number().optional(),
  totalBlocks: z.number().optional(),
  pages: z.array(z.unknown()).optional(),
  blocks: z.array(DoclingBlockSchema).optional(),
});

export const StructuredDocumentSchema = z.object({
  markdown: z.string().default(''),
  plainText: z.string().default(''),
  sections: z.array(DoclingSectionSchema).default([]),
  tables: z.array(DoclingTableSchema).optional().default([]),
  images: z.array(DoclingImageSchema).optional().default([]),
  metadata: DoclingMetadataSchema.optional(),
  ast: DoclingASTSchema.optional(),
});

export type StructuredDocumentInput = z.infer<typeof StructuredDocumentSchema>;
