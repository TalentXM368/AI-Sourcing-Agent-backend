import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchingService } from '../services/matching-service.js';

const mockEmbeddingService = {
  searchCandidates: vi.fn().mockResolvedValue([
    { entityId: 'cand-1', score: 0.9, vector: [] },
    { entityId: 'cand-2', score: 0.7, vector: [] },
  ]),
  searchJobs: vi.fn().mockResolvedValue([
    { entityId: 'job-1', score: 0.85, vector: [] },
    { entityId: 'job-2', score: 0.6, vector: [] },
  ]),
};

vi.mock('../../../db/index.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../../db/index.js';
const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

function mockJobRow(id: string) {
  return {
    id,
    role: 'Software Engineer',
    company: 'ACME',
    location: 'San Francisco, CA',
    required_skills: ['javascript', 'react'],
    nice_to_have_skills: ['node.js'],
    avoid_skills: [],
    experience_min: 2,
    experience_max: 5,
    description: 'Build great software',
    raw_text: '',
    industry: 'technology',
    region: 'US',
    status: 'open',
  };
}

function mockCandidateRow(id: string) {
  return {
    id,
    name: 'John Doe',
    email: 'john@example.com',
    phone: null,
    headline: 'Software Engineer',
    location: 'San Francisco, CA',
    summary: 'Experienced software engineer',
    skills: [{ name: 'javascript' }, { name: 'react' }],
    experience_years: 3,
    education: [{ degree: 'B.S. Computer Science', school: 'MIT', field: 'Computer Science' }],
    work_history: [{
      title: 'Software Engineer',
      company: 'ACME',
      from: '2020-01-01',
      to: '2023-01-01',
      is_current: true,
    }],
    data_quality_score: 0.8,
    missing_fields: [],
  };
}

describe('MatchingService', () => {
  let service: MatchingService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    mockPool.query.mockResolvedValue({ rows: [] });
    service = new MatchingService(mockEmbeddingService as any);
  });

  describe('matchJobToCandidates', () => {
    it('returns results with metadata', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockJobRow('job-1')] })
        .mockResolvedValueOnce({ rows: [mockCandidateRow('cand-1'), mockCandidateRow('cand-2')] });

      const result = await service.matchJobToCandidates('job-1');

      expect(result.results).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.candidatesRetrieved).toBe(2);
      expect(result.metadata.candidatesRanked).toBeGreaterThanOrEqual(0);
      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('throws when job not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.matchJobToCandidates('nonexistent')).rejects.toThrow('Job nonexistent not found');
    });

    it('sorts results by overallScore descending', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockJobRow('job-1')] })
        .mockResolvedValueOnce({ rows: [mockCandidateRow('cand-1'), mockCandidateRow('cand-2')] });

      const result = await service.matchJobToCandidates('job-1');

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].overallScore).toBeGreaterThanOrEqual(result.results[i].overallScore);
      }
    });

    it('returns match results with all scores', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockJobRow('job-1')] })
        .mockResolvedValueOnce({ rows: [mockCandidateRow('cand-1')] });

      const result = await service.matchJobToCandidates('job-1');

      if (result.results.length > 0) {
        const match = result.results[0];
        expect(match.overallScore).toBeGreaterThanOrEqual(0);
        expect(match.overallScore).toBeLessThanOrEqual(100);
        expect(match.semanticScore).toBeGreaterThanOrEqual(0);
        expect(match.skillScore).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeLessThanOrEqual(1);
        expect(match.candidateId).toBe('cand-1');
        expect(match.jobId).toBe('job-1');
      }
    });
  });

  describe('matchCandidateToJobs', () => {
    it('returns results with metadata', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockCandidateRow('cand-1')] })
        .mockResolvedValueOnce({ rows: [mockJobRow('job-1'), mockJobRow('job-2')] });

      const result = await service.matchCandidateToJobs('cand-1');

      expect(result.results).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.candidatesRetrieved).toBe(2);
    });

    it('throws when candidate not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.matchCandidateToJobs('nonexistent')).rejects.toThrow('Candidate nonexistent not found');
    });

    it('sorts results by overallScore descending', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [mockCandidateRow('cand-1')] })
        .mockResolvedValueOnce({ rows: [mockJobRow('job-1'), mockJobRow('job-2')] });

      const result = await service.matchCandidateToJobs('cand-1');

      for (let i = 1; i < result.results.length; i++) {
        expect(result.results[i - 1].overallScore).toBeGreaterThanOrEqual(result.results[i].overallScore);
      }
    });
  });
});
