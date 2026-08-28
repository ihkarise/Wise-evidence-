// Public API of @wise-evidence/discovery (M7). Connector abstraction + a
// deterministic mock + the Crossref connector. Discovery produces review
// candidates only — no classification, no publication, no DB access here.

export type {
  DiscoveryCriteria,
  RawDiscoveryRecord,
  NormalizedDiscoveryRecord,
  DiscoveryErrorCode,
  DiscoveryResult,
  ResearchDiscoveryConnector,
} from './types.js';
export { normalizeWork } from './normalize.js';
export { LIMITS, sanitizeString, sanitizeUrl, isSafeHttpUrl, normalizeDateParts } from './validation.js';
export { MockDiscoveryConnector, MOCK_FIXTURES, type MockDiscoveryOptions } from './mock.js';
export { CrossrefDiscoveryConnector, type CrossrefDiscoveryOptions } from './crossref.js';
