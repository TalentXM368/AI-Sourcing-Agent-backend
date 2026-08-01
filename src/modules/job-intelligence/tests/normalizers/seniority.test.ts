import { describe, it, expect } from 'vitest';
import { normalizeSeniority, detectSeniorityFromTitle, detectSeniorityFromText, getSeniorityOrder } from '../../normalizers/seniority-normalizer.js';

describe('Seniority Normalizer', () => {
  describe('detectSeniorityFromTitle', () => {
    it('detects junior from title', () => {
      expect(detectSeniorityFromTitle('Junior Software Engineer')).toBe('junior');
      expect(detectSeniorityFromTitle('Jr. Developer')).toBe('junior');
    });

    it('detects senior from title', () => {
      expect(detectSeniorityFromTitle('Senior Software Engineer')).toBe('senior');
      expect(detectSeniorityFromTitle('Sr. Backend Developer')).toBe('senior');
    });

    it('detects lead from title', () => {
      expect(detectSeniorityFromTitle('Tech Lead')).toBe('lead');
      expect(detectSeniorityFromTitle('Team Lead Engineer')).toBe('lead');
    });

    it('detects principal from title', () => {
      expect(detectSeniorityFromTitle('Principal Engineer')).toBe('principal');
    });

    it('detects director from title', () => {
      expect(detectSeniorityFromTitle('Director of Engineering')).toBe('director');
    });

    it('detects intern from title', () => {
      expect(detectSeniorityFromTitle('Software Engineering Intern')).toBe('intern');
    });

    it('returns null for unknown', () => {
      expect(detectSeniorityFromTitle('Software Engineer')).toBeNull();
    });
  });

  describe('detectSeniorityFromText', () => {
    it('detects senior from text', () => {
      expect(detectSeniorityFromText('Looking for a senior developer with 5+ years')).toBe('senior');
    });

    it('detects entry level from text', () => {
      expect(detectSeniorityFromText('Entry level position for recent graduates')).toBe('junior');
    });

    it('returns null for no match', () => {
      expect(detectSeniorityFromText('We need a developer')).toBeNull();
    });
  });

  describe('normalizeSeniority', () => {
    it('normalizes title to seniority', () => {
      expect(normalizeSeniority('Senior Software Engineer')).toBe('senior');
      expect(normalizeSeniority('Junior Developer')).toBe('junior');
    });

    it('defaults to mid', () => {
      expect(normalizeSeniority('Software Engineer')).toBe('mid');
    });
  });

  describe('getSeniorityOrder', () => {
    it('returns correct order', () => {
      expect(getSeniorityOrder('intern')).toBe(0);
      expect(getSeniorityOrder('junior')).toBe(1);
      expect(getSeniorityOrder('senior')).toBe(3);
      expect(getSeniorityOrder('director')).toBe(8);
    });
  });
});
