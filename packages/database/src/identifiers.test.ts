import { describe, it, expect } from 'vitest';
import { toCanonicalIdentifier } from './identifiers.js';

describe('toCanonicalIdentifier', () => {
  it('canonicalizes a DOI via the domain normalizer', () => {
    expect(toCanonicalIdentifier('DOI', 'https://doi.org/10.5555/DEMO.0001')).toEqual({
      id_type: 'DOI',
      value_raw: 'https://doi.org/10.5555/DEMO.0001',
      value_canonical: '10.5555/demo.0001',
    });
  });

  it('returns null for a malformed DOI (routed to review, not stored)', () => {
    expect(toCanonicalIdentifier('DOI', 'not-a-doi')).toBeNull();
  });

  it('trims and lowercases non-DOI identifiers', () => {
    expect(toCanonicalIdentifier('PMID', '  12345678 ')).toEqual({
      id_type: 'PMID',
      value_raw: '  12345678 ',
      value_canonical: '12345678',
    });
  });

  it('returns null for empty input', () => {
    expect(toCanonicalIdentifier('URL', '   ')).toBeNull();
  });
});
