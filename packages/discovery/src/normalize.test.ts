import { describe, expect, it } from 'vitest';
import { normalizeWork } from './normalize.js';

describe('normalizeWork', () => {
  it('normalizes a full Crossref-shaped work and canonicalizes the DOI', () => {
    const n = normalizeWork({
      sourceRecordId: '10.1234/AbC',
      raw: {
        DOI: 'https://doi.org/10.1234/AbC',
        title: ['A Homeopathy Study'],
        author: [{ given: 'Jane', family: 'Doe' }, { name: 'R. Roe' }],
        'container-title': ['Journal of Example'],
        issued: { 'date-parts': [[2020, 3, 15]] },
        URL: 'https://example.org/x',
      },
    });
    expect(n.doi).toBe('10.1234/abc'); // reuses domain normalizeDoi (lowercased)
    expect(n.title).toBe('A Homeopathy Study');
    expect(n.authors).toEqual(['Jane Doe', 'R. Roe']);
    expect(n.journal).toBe('Journal of Example');
    expect(n.publicationDate).toBe('2020-03-15');
    expect(n.url).toBe('https://example.org/x');
  });

  it('keeps DOI null (never fabricated) when absent or malformed, preserving the source id', () => {
    const missing = normalizeWork({ sourceRecordId: 'src:1', raw: { title: ['No DOI'] } });
    expect(missing.doi).toBeNull();
    expect(missing.sourceRecordId).toBe('src:1');

    const bad = normalizeWork({ sourceRecordId: 'src:2', raw: { DOI: 'not a doi', title: ['Bad DOI'] } });
    expect(bad.doi).toBeNull();
  });

  it('drops an unsafe URL (non-http(s))', () => {
    const n = normalizeWork({ sourceRecordId: 'src:3', raw: { DOI: '10.1/x', URL: 'javascript:alert(1)' } });
    expect(n.url).toBeNull();
  });

  it('tolerates a malformed (non-object) raw payload without throwing', () => {
    const n = normalizeWork({ sourceRecordId: 'src:4', raw: 'garbage' });
    expect(n.title).toBeNull();
    expect(n.authors).toEqual([]);
    expect(n.doi).toBeNull();
    expect(n.sourceRecordId).toBe('src:4');
  });

  it('gives partial dates from partial date-parts', () => {
    expect(normalizeWork({ sourceRecordId: 'a', raw: { issued: { 'date-parts': [[2019]] } } }).publicationDate).toBe('2019');
    expect(normalizeWork({ sourceRecordId: 'a', raw: { issued: { 'date-parts': [[2019, 6]] } } }).publicationDate).toBe('2019-06');
  });
});
