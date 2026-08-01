import type { SourceTracking } from './common.types.js';

export interface DoclingSection {
  name: string;
  content: string;
  level?: number;
  pageNumber?: number;
}

export interface DoclingTable {
  markdown: string;
  pageNumber?: number;
}

export interface DoclingMetadata {
  pages?: number;
  language?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
}

export interface DoclingImage {
  caption?: string;
  pageNumber?: number;
}

export interface DoclingBlock {
  type: string;
  text: string;
  pageNumber?: number;
}

export interface DoclingAST {
  totalPages?: number;
  totalBlocks?: number;
  pages?: unknown[];
  blocks?: DoclingBlock[];
}

export interface StructuredDocument {
  markdown: string;
  plainText: string;
  sections: DoclingSection[];
  tables?: DoclingTable[];
  images?: DoclingImage[];
  metadata?: DoclingMetadata;
  ast?: DoclingAST;
}

export interface ProcessedSection {
  originalName: string;
  normalizedName: string;
  content: string;
  level?: number;
  pageNumber?: number;
}
