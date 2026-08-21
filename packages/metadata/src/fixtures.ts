import type { BibliographicMetadata } from './types.js';

/**
 * Deterministic fixtures for tests and the MockMetadataProvider. These are
 * illustrative, clearly non-authoritative samples (test DOIs under 10.5555) —
 * not real bibliographic records.
 */

/** A Crossref-shaped `works` response body, as returned by the API. */
export const CROSSREF_SAMPLE_RESPONSE = {
  status: 'ok',
  'message-type': 'work',
  message: {
    DOI: '10.5555/demo.crossref.1',
    title: ['Individualized homeopathy for allergic rhinitis: a demo record'],
    author: [
      { given: 'Ada', family: 'Researcher' },
      { given: 'Ben', family: 'Analyst' },
    ],
    'container-title': ['Demo Journal of Homeopathy Research'],
    publisher: 'Demo Publisher',
    URL: 'https://doi.org/10.5555/demo.crossref.1',
    published: { 'date-parts': [[2022, 5, 17]] },
  },
} as const;

/** Expected normalized metadata for the sample response above. */
export const CROSSREF_SAMPLE_EXPECTED: BibliographicMetadata = {
  doi: '10.5555/demo.crossref.1',
  title: 'Individualized homeopathy for allergic rhinitis: a demo record',
  authors: ['Ada Researcher', 'Ben Analyst'],
  journal: 'Demo Journal of Homeopathy Research',
  publicationDate: '2022-05-17',
  publisher: 'Demo Publisher',
  url: 'https://doi.org/10.5555/demo.crossref.1',
  identifiers: [{ type: 'DOI', value: '10.5555/demo.crossref.1' }],
};

/** Keyed by canonical DOI, used by MockMetadataProvider. */
export const MOCK_METADATA: Record<string, BibliographicMetadata> = {
  '10.5555/demo.crossref.1': CROSSREF_SAMPLE_EXPECTED,
  '10.1234/demo.mock.1': {
    doi: '10.1234/demo.mock.1',
    title: 'Homeopathic arnica for recovery: a demo record',
    authors: ['Cara Clinician'],
    journal: 'Demo Journal of Homeopathy Research',
    publicationDate: '2021',
    publisher: 'Demo Publisher',
    url: 'https://doi.org/10.1234/demo.mock.1',
    identifiers: [{ type: 'DOI', value: '10.1234/demo.mock.1' }],
  },
};
