import { describe, it, expect } from 'vitest';
import { getSourcePriority, getFieldNamePrefix } from '../../engines/source-priority.engine.js';

describe('getSourcePriority', () => {
  it('returns high priority for preferred source', () => {
    const priority = getSourcePriority('personal.name', 'header');
    expect(priority).toBeGreaterThan(0);
  });

  it('returns 0 for unknown field', () => {
    expect(getSourcePriority('unknown.field', 'header')).toBe(0);
  });

  it('returns 0 for unknown source section', () => {
    expect(getSourcePriority('personal.name', 'nonexistent')).toBe(0);
  });

  it('gives header higher priority than contact for name', () => {
    const headerPri = getSourcePriority('personal.name', 'header');
    const contactPri = getSourcePriority('personal.name', 'contact');
    expect(headerPri).toBeGreaterThan(contactPri);
  });

  it('gives contact higher priority than header for email', () => {
    const contactPri = getSourcePriority('contact.email', 'contact');
    const headerPri = getSourcePriority('contact.email', 'header');
    expect(contactPri).toBeGreaterThan(headerPri);
  });
});

describe('getFieldNamePrefix', () => {
  it('returns correct prefix for known categories', () => {
    expect(getFieldNamePrefix('personal')).toBe('personal.');
    expect(getFieldNamePrefix('contact')).toBe('contact.');
    expect(getFieldNamePrefix('experience')).toBe('experience.');
    expect(getFieldNamePrefix('skills')).toBe('skills');
  });

  it('returns raw category for unknown', () => {
    expect(getFieldNamePrefix('unknown')).toBe('unknown');
  });
});
