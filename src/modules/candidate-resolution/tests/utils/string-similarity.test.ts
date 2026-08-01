import { describe, it, expect } from 'vitest';
import {
  normalizeForComparison,
  normalizeCompanyName,
  normalizeName,
  jaro,
  jaroWinkler,
  tokenSetRatio,
  findDuplicates,
} from '../../utils/string-similarity.js';

describe('normalizeForComparison', () => {
  it('lowercases', () => {
    expect(normalizeForComparison('Hello World')).toBe('hello world');
  });

  it('removes diacritics', () => {
    expect(normalizeForComparison('café résumé')).toBe('cafe resume');
  });

  it('removes special quotes', () => {
    expect(normalizeForComparison("it's a \"test\"")).toBe('its a test');
  });

  it('collapses whitespace', () => {
    expect(normalizeForComparison('  hello   world  ')).toBe('hello world');
  });

  it('removes non-alphanumeric chars', () => {
    expect(normalizeForComparison('hello@world.com')).toBe('hello world com');
  });
});

describe('normalizeCompanyName', () => {
  it('removes legal suffixes', () => {
    expect(normalizeCompanyName('Acme Inc')).toBe('acme');
    expect(normalizeCompanyName('Google LLC')).toBe('google');
    expect(normalizeCompanyName('Microsoft Corporation')).toBe('microsoft');
  });

  it('removes noise words', () => {
    expect(normalizeCompanyName('Bank of America')).toBe('bank america');
  });

  it('handles short tokens', () => {
    expect(normalizeCompanyName('A B')).toBe('');
  });

  it('preserves meaningful tokens', () => {
    expect(normalizeCompanyName('JP Morgan Chase')).toBe('jp morgan chase');
  });
});

describe('normalizeName', () => {
  it('title cases each word', () => {
    expect(normalizeName('john doe')).toBe('John Doe');
  });

  it('removes single-char tokens', () => {
    expect(normalizeName('a john doe')).toBe('John Doe');
  });

  it('handles already-cased input', () => {
    expect(normalizeName('John Doe')).toBe('John Doe');
  });
});

describe('jaro', () => {
  it('returns 1 for identical strings', () => {
    expect(jaro('hello', 'hello')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(jaro('', 'hello')).toBe(0);
    expect(jaro('hello', '')).toBe(0);
  });

  it('returns 0 for completely different strings', () => {
    expect(jaro('abc', 'xyz')).toBe(0);
  });

  it('returns value between 0 and 1 for similar strings', () => {
    const score = jaro('martha', 'marhta');
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThan(1);
  });

  it('is commutative', () => {
    expect(jaro('abc', 'def')).toBe(jaro('def', 'abc'));
  });
});

describe('jaroWinkler', () => {
  it('returns 1 for identical strings', () => {
    expect(jaroWinkler('hello', 'hello')).toBe(1);
  });

  it('gives higher score for common prefix', () => {
    const withPrefix = jaroWinkler('hello', 'help');
    const withoutPrefix = jaroWinkler('hello', 'world');
    expect(withPrefix).toBeGreaterThan(withoutPrefix);
  });

  it('respects prefixScale parameter', () => {
    const low = jaroWinkler('hello', 'help', 0.05);
    const high = jaroWinkler('hello', 'help', 0.2);
    expect(high).toBeGreaterThan(low);
  });
});

describe('tokenSetRatio', () => {
  it('returns 1 for identical tokens', () => {
    expect(tokenSetRatio('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for empty strings', () => {
    expect(tokenSetRatio('', '')).toBe(0);
  });

  it('handles partial overlap', () => {
    const score = tokenSetRatio('hello world test', 'hello world foo');
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });

  it('handles different orderings equally', () => {
    expect(tokenSetRatio('a b c', 'c b a')).toBe(tokenSetRatio('a b c', 'a b c'));
  });
});

describe('findDuplicates', () => {
  it('finds duplicate strings', () => {
    expect(findDuplicates(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty for no duplicates', () => {
    expect(findDuplicates(['a', 'b', 'c'])).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it('works with numbers', () => {
    expect(findDuplicates([1, 2, 1, 3])).toEqual([1]);
  });
});
