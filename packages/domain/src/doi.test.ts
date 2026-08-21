import { describe, it, expect } from 'vitest';
import { normalizeDoi, isValidDoi } from './doi.js';

const CANONICAL = '10.1234/abcd';

describe('normalizeDoi — accepted input forms', () => {
  it('accepts a bare DOI', () => {
    expect(normalizeDoi('10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('accepts a doi: prefixed DOI', () => {
    expect(normalizeDoi('doi:10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('accepts an https://doi.org/ URL', () => {
    expect(normalizeDoi('https://doi.org/10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('accepts an http://doi.org/ URL', () => {
    expect(normalizeDoi('http://doi.org/10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('tolerates the dx.doi.org host variant', () => {
    expect(normalizeDoi('https://dx.doi.org/10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('tolerates a scheme-less doi.org/ prefix', () => {
    expect(normalizeDoi('doi.org/10.1234/abcd')).toEqual({ ok: true, doi: CANONICAL });
  });
});

describe('normalizeDoi — canonical output (all forms converge)', () => {
  it('reduces every accepted form of the same DOI to one canonical value', () => {
    const forms = [
      '10.1234/abcd',
      'doi:10.1234/abcd',
      'https://doi.org/10.1234/abcd',
      'http://doi.org/10.1234/abcd',
      '  https://dx.doi.org/10.1234/abcd  ',
    ];
    const normalized = forms.map((f) => normalizeDoi(f));
    for (const result of normalized) {
      expect(result).toEqual({ ok: true, doi: CANONICAL });
    }
  });
});

describe('normalizeDoi — casing', () => {
  it('lowercases an uppercase DOI (DOIs are case-insensitive)', () => {
    expect(normalizeDoi('10.1234/ABCD')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('lowercases an uppercase resolver prefix and suffix', () => {
    expect(normalizeDoi('HTTPS://DOI.ORG/10.1234/ABcd')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('preserves the suffix except for case (suffix is otherwise significant)', () => {
    const r = normalizeDoi('10.1000/journal.PONE.0000000');
    expect(r).toEqual({ ok: true, doi: '10.1000/journal.pone.0000000' });
  });
});

describe('normalizeDoi — whitespace', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeDoi('   10.1234/abcd   ')).toEqual({ ok: true, doi: CANONICAL });
  });

  it('trims whitespace around a prefixed DOI', () => {
    expect(normalizeDoi('\t doi:10.1234/abcd \n')).toEqual({ ok: true, doi: CANONICAL });
  });
});

describe('normalizeDoi — empty input', () => {
  it('rejects an empty string', () => {
    expect(normalizeDoi('')).toEqual({ ok: false, error: 'EMPTY', input: '' });
  });

  it('rejects a whitespace-only string', () => {
    expect(normalizeDoi('    ')).toEqual({ ok: false, error: 'EMPTY', input: '    ' });
  });
});

describe('normalizeDoi — invalid / malformed input', () => {
  it.each([
    ['plain text', 'hello world'],
    ['missing suffix', '10.1234'],
    ['missing slash', '10.1234abcd'],
    ['registrant too short', '10.12/abcd'],
    ['wrong directory-indicator', '11.1234/abcd'],
    ['no 10. prefix', 'abcd/10.1234'],
    ['prefix only, no DOI body', 'doi:'],
    ['url without a DOI', 'https://example.com/not-a-doi'],
    ['whitespace inside the suffix', '10.1234/ab cd'],
  ])('rejects %s', (_label, value) => {
    expect(normalizeDoi(value)).toEqual({ ok: false, error: 'INVALID_FORMAT', input: value });
  });
});

describe('isValidDoi', () => {
  it('is true for a valid DOI in any accepted form', () => {
    expect(isValidDoi('https://doi.org/10.1234/abcd')).toBe(true);
    expect(isValidDoi('10.1234/abcd')).toBe(true);
  });

  it('is false for empty or malformed input', () => {
    expect(isValidDoi('')).toBe(false);
    expect(isValidDoi('not-a-doi')).toBe(false);
  });
});
