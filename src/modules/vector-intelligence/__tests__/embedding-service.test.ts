// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CandidateProfile } from '../../candidate-intelligence/types/profile.types.js';
import type { JobProfile } from '../../job-intelligence/types/profile.types.js';

vi.mock('@qdrant/js-client-rest', () => {
  const MockQdrantClient = vi.fn(function MockQdrantClientImpl() {
    this.getCollections = vi.fn().mockResolvedValue({ collections: [] });
    this.createCollection = vi.fn().mockResolvedValue(true);
    this.createPayloadIndex = vi.fn().mockResolvedValue(true);
    this.getCollection = vi.fn().mockResolvedValue({
      status: 'green', optimizer_status: 'ok', vectors_count: 0,
      indexed_vectors_count: 0, points_count: 0, segments_count: 0,
      config: {}, payload_schema: {},
    });
    this.upsert = vi.fn().mockResolvedValue(true);
    this.search = vi.fn().mockResolvedValue([]);
  });
  return { QdrantClient: MockQdrantClient };
});

vi.mock('openai', () => {
  const MockOpenAI = vi.fn(function MockOpenAIObj() {
    this.embeddings = {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }],
      }),
    };
  });
  return { default: MockOpenAI };
});

function createMockCandidateProfile(): CandidateProfile {
  return {
    schemaVersion: '1.0',
    candidateId: 'test-candidate-123',
    personal: {
      name: { raw: 'John Smith', value: 'John Smith', extractor: 'test', sourceSection: 'header', confidence: { score: 0.95, reasons: [] } },
      headline: { raw: 'Engineer', value: 'Engineer', extractor: 'test', sourceSection: 'header', confidence: { score: 0.9, reasons: [] } },
      summary: 'Experienced engineer.',
    },
    contact: {
      email: null, phone: null, linkedin: null, github: null, portfolio: null, website: null,
      city: null, state: null, country: null,
    },
    skills: [{ canonical: 'TypeScript', raw: 'TypeScript', category: 'language', confidence: { score: 0.95, reasons: [] } }],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    languages: [],
    socialLinks: { linkedin: null, github: null, portfolio: null, website: null },
    timeline: [],
    rawDocument: { referenceId: 'ref-1', markdownLength: 100, plainTextLength: 80, sectionsCount: 2 },
    metadata: { resumeLanguage: 'en', pages: 1, hasTables: false, hasImages: false, sectionCount: 2, sourceFileName: 'r.pdf', sourceFileSize: 1000, mimeType: 'application/pdf' },
    processing: { parser: 'test', parserVersion: '1.0', pipelineVersion: '1.0', processingTimeMs: 50, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [], resolversRun: [] },
    validation: { warnings: [], isValid: true },
    completeness: { score: 0.5, missingFields: [], presentFields: [] },
  };
}

function createMockJobProfile(): JobProfile {
  return {
    schemaVersion: '1.0',
    jobId: 'test-job-456',
    title: { raw: 'Developer', value: 'Developer', extractor: 'test', sourceSection: 'title', confidence: { score: 0.95, reasons: [] } },
    summary: { raw: 'Job summary', value: 'Job summary', extractor: 'test', sourceSection: 'summary', confidence: { score: 0.8, reasons: [] } },
    company: { raw: 'TestCo', value: 'TestCo', extractor: 'test', sourceSection: 'company', confidence: { score: 0.9, reasons: [] } },
    industry: { raw: 'Tech', value: 'Tech', extractor: 'test', sourceSection: 'industry', confidence: { score: 0.7, reasons: [] } },
    domain: null, department: null,
    employmentType: { raw: 'full-time', value: 'full-time', extractor: 'test', sourceSection: 'type', confidence: { score: 0.9, reasons: [] } },
    workMode: { raw: 'remote', value: 'remote', extractor: 'test', sourceSection: 'mode', confidence: { score: 0.8, reasons: [] } },
    seniority: { raw: 'mid', value: 'mid', extractor: 'test', sourceSection: 'seniority', confidence: { score: 0.85, reasons: [] } },
    experience: { minimumYears: null, maximumYears: null, preferredYears: null },
    education: { degree: null, specialization: null, educationLevel: null },
    salary: { currency: null, minimum: null, maximum: null, period: null, raw: null },
    location: { city: null, state: null, country: null, raw: null },
    requiredSkills: [{ canonical: 'Python', raw: 'Python', category: 'language', confidence: 0.95 }],
    preferredSkills: [], certifications: [], languages: [],
    responsibilities: ['Build things'], benefits: [], technologies: [], tools: [],
    workAuthorization: null, visaSponsorship: null, travelRequirements: null, shift: null,
    metadata: { sourceFileName: null, sourceFileSize: null, mimeType: null, pages: null, hasTables: false, sectionCount: 0 },
    processing: { pipelineVersion: '3.0.0', processingTimeMs: 30, processedAt: new Date().toISOString(), warnings: [], errors: [], extractorsRun: [], normalizersRun: [] },
    validation: { warnings: [], isValid: true },
    quality: { overall: 0.7, completeness: 0.6, fieldConfidence: 0.8, missingFields: [], suggestions: [] },
  };
}

describe('EmbeddingService', () => {
  let EmbeddingService: typeof import('../services/embedding-service.js').EmbeddingService;
  let QdrantManager: typeof import('../qdrant/qdrant-manager.js').QdrantManager;
  let QdrantIndexer: typeof import('../qdrant/qdrant-indexer.js').QdrantIndexer;
  let QdrantSearcher: typeof import('../qdrant/qdrant-searcher.js').QdrantSearcher;
  let getDefaultEmbeddingProvider: typeof import('../providers/index.js').getDefaultEmbeddingProvider;
  let getGlobalQueue: typeof import('../queue/index.js').getGlobalQueue;

  beforeEach(async () => {
    vi.clearAllMocks();
    const svcMod = await import('../services/embedding-service.js');
    EmbeddingService = svcMod.EmbeddingService;
    const mgrMod = await import('../qdrant/qdrant-manager.js');
    QdrantManager = mgrMod.QdrantManager;
    const idxMod = await import('../qdrant/qdrant-indexer.js');
    QdrantIndexer = idxMod.QdrantIndexer;
    const srchMod = await import('../qdrant/qdrant-searcher.js');
    QdrantSearcher = srchMod.QdrantSearcher;
    const provMod = await import('../providers/index.js');
    getDefaultEmbeddingProvider = provMod.getDefaultEmbeddingProvider;
    const queueMod = await import('../queue/index.js');
    getGlobalQueue = queueMod.getGlobalQueue;
  });

  function createService() {
    const provider = getDefaultEmbeddingProvider();
    const manager = new QdrantManager();
    const indexer = new QdrantIndexer(manager);
    const searcher = new QdrantSearcher(manager);
    const queue = getGlobalQueue();
    return new EmbeddingService(provider, queue, indexer, searcher, manager);
  }

  it('creates service', () => {
    const service = createService();
    expect(service).toBeDefined();
  });

  it('queues candidate profile for indexing', () => {
    const service = createService();
    const profile = createMockCandidateProfile();
    const jobId = service.indexCandidateProfile(profile);
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');
  });

  it('queues job profile for indexing', () => {
    const service = createService();
    const profile = createMockJobProfile();
    const jobId = service.indexJobProfile(profile);
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');
  });

  it('indexes candidate profile synchronously', async () => {
    const service = createService();
    const profile = createMockCandidateProfile();
    await service.indexCandidateProfileSync(profile);
    // If no error thrown, upsert was called
  });

  it('indexes job profile synchronously', async () => {
    const service = createService();
    const profile = createMockJobProfile();
    await service.indexJobProfileSync(profile);
    // If no error thrown, upsert was called
  });

  it('health check returns status', async () => {
    const service = createService();
    const health = await service.health();

    expect(health.provider).toBe(true);
    expect(health.qdrant).toBe(true);
    expect(health.queue).toEqual({ pending: 0, processing: 0 });
  });
});
