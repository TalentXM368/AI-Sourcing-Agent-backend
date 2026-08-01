import { describe, it, expect } from 'vitest';
import { calculateDisplayScore, deriveRecommendation, deriveConfidenceLevel } from '../../services/score-adjustment.js';

describe('score-adjustment', () => {
  describe('calculateDisplayScore', () => {
    it('should return no adjustment when cross-encoder score is at baseline (0.5)', () => {
      const result = calculateDisplayScore(80, 0.5);
      expect(result.crossEncoderAdjustment).toBe(0);
      expect(result.displayScore).toBe(80);
    });

    it('should return positive adjustment when cross-encoder score is above baseline', () => {
      const result = calculateDisplayScore(80, 0.7);
      expect(result.crossEncoderAdjustment).toBe(4);
      expect(result.displayScore).toBe(84);
    });

    it('should return negative adjustment when cross-encoder score is below baseline', () => {
      const result = calculateDisplayScore(80, 0.3);
      expect(result.crossEncoderAdjustment).toBe(-4);
      expect(result.displayScore).toBe(76);
    });

    it('should clamp adjustment to max +10', () => {
      const result = calculateDisplayScore(80, 1.0);
      expect(result.crossEncoderAdjustment).toBe(10);
      expect(result.displayScore).toBe(90);
    });

    it('should clamp adjustment to min -10', () => {
      const result = calculateDisplayScore(80, 0.0);
      expect(result.crossEncoderAdjustment).toBe(-10);
      expect(result.displayScore).toBe(70);
    });

    it('should clamp display score to max 100', () => {
      const result = calculateDisplayScore(95, 0.9);
      expect(result.displayScore).toBe(100);
    });

    it('should clamp display score to min 0', () => {
      const result = calculateDisplayScore(5, 0.1);
      expect(result.displayScore).toBe(0);
    });

    it('should handle edge case match score of 0', () => {
      const result = calculateDisplayScore(0, 0.5);
      expect(result.crossEncoderAdjustment).toBe(0);
      expect(result.displayScore).toBe(0);
    });
  });

  describe('deriveRecommendation', () => {
    it('should return Strong Hire for high scores', () => {
      expect(deriveRecommendation(95, 0.95)).toBe('Strong Hire');
    });

    it('should return Good Hire for good scores with high confidence', () => {
      // 85 * 0.95 = 80.75 >= 75
      expect(deriveRecommendation(85, 0.95)).toBe('Good Hire');
    });

    it('should return Consider for moderate scores', () => {
      // 70 * 0.95 = 66.5 >= 60
      expect(deriveRecommendation(70, 0.95)).toBe('Consider');
    });

    it('should return Maybe for lower scores', () => {
      // 55 * 0.95 = 52.25 >= 45
      expect(deriveRecommendation(55, 0.95)).toBe('Maybe');
    });

    it('should return Not Recommended for low scores', () => {
      expect(deriveRecommendation(30, 0.5)).toBe('Not Recommended');
    });

    it('should factor in confidence', () => {
      // 85 * 0.8 = 68, which is Consider range
      expect(deriveRecommendation(85, 0.8)).toBe('Consider');
      // 85 * 0.95 = 80.75, which is Good Hire range
      expect(deriveRecommendation(85, 0.95)).toBe('Good Hire');
    });
  });

  describe('deriveConfidenceLevel', () => {
    it('should return High for confidence >= 0.85', () => {
      expect(deriveConfidenceLevel(0.9)).toEqual({ level: 'High', score: 0.9 });
      expect(deriveConfidenceLevel(0.85)).toEqual({ level: 'High', score: 0.85 });
    });

    it('should return Medium for confidence >= 0.60', () => {
      expect(deriveConfidenceLevel(0.7)).toEqual({ level: 'Medium', score: 0.7 });
      expect(deriveConfidenceLevel(0.6)).toEqual({ level: 'Medium', score: 0.6 });
    });

    it('should return Low for confidence < 0.60', () => {
      expect(deriveConfidenceLevel(0.5)).toEqual({ level: 'Low', score: 0.5 });
      expect(deriveConfidenceLevel(0.0)).toEqual({ level: 'Low', score: 0 });
    });
  });
});
