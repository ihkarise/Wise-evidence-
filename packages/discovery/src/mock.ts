/**
 * Deterministic mock discovery connector (docs/25 §mock). Returns fixed, clearly
 * test-labelled records so the whole pipeline (discover → normalize → dedup →
 * candidate → review → draft) runs in CI with no network and no spend. Fixtures
 * cover the required scenarios: new DOI, existing DOI, missing DOI, duplicate
 * candidate, malformed metadata, multiple results, empty result, source failure,
 * timeout/error. Fixtures are never real research.
 *
 * The `query` selects a scenario so tests can exercise each path:
 *   'empty' → no results          'fail' → source failure
 *   'timeout' → timeout error     (anything else) → the standard multi-result set
 */
import { normalizeWork } from './normalize.js';
import type { DiscoveryCriteria, DiscoveryResult, NormalizedDiscoveryRecord, RawDiscoveryRecord, ResearchDiscoveryConnector } from './types.js';

/** Build a Crossref-shaped work (the mock simulates a Crossref response). */
function work(doi: string | null, title: string, extra: Record<string, unknown> = {}): RawDiscoveryRecord {
  return {
    sourceRecordId: doi ?? `mock:${title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
    raw: {
      DOI: doi ?? undefined,
      title: [title],
      author: [{ given: 'Test', family: 'Author' }],
      'container-title': ['Journal of Mock Homeopathy Research'],
      issued: { 'date-parts': [[2021, 5]] },
      URL: doi ? `https://doi.org/${doi}` : undefined,
      ...extra,
    },
  };
}

/**
 * The standard fixture set. DOIs are clearly fake test values (10.9999/...), not
 * real papers. `[mockdemo]` title prefix labels them as test data everywhere.
 */
export const MOCK_FIXTURES: RawDiscoveryRecord[] = [
  // 1. New DOI (not in the DB) — should become a NEW candidate.
  work('10.9999/mockdemo.new.001', '[mockdemo] new homeopathy trial for eczema'),
  // 2. Existing DOI — matches a seeded study; should be flagged EXISTING.
  //    (Tests seed a study with this DOI to exercise dedup.)
  work('10.9999/mockdemo.existing.002', '[mockdemo] already-indexed homeopathy study'),
  // 3. Missing DOI — no identifier; source id preserved; routed to review.
  work(null, '[mockdemo] homeopathy case series with no DOI'),
  // 4. Duplicate candidate — same DOI as fixture 1 (a within-batch duplicate).
  work('10.9999/mockdemo.new.001', '[mockdemo] new homeopathy trial for eczema (reprint)'),
  // 5. Malformed metadata — raw is not an object; normalization yields empties.
  { sourceRecordId: 'mock:malformed', raw: 'not-an-object' },
  // 6. Another distinct result (multiple results).
  work('10.9999/mockdemo.multi.006', '[mockdemo] observational homeopathy cohort'),
  // 7. A result whose DOI is malformed text — DOI normalizes to null, kept as source id.
  { sourceRecordId: 'mock:baddoi', raw: { DOI: 'not a doi', title: ['[mockdemo] bad-doi record'] } },
];

export interface MockDiscoveryOptions {
  /** Override the fixture set (tests may supply their own). */
  fixtures?: RawDiscoveryRecord[];
}

export class MockDiscoveryConnector implements ResearchDiscoveryConnector {
  readonly name = 'mock';
  readonly maxResultsCap = 50;
  private readonly fixtures: RawDiscoveryRecord[];

  constructor(options: MockDiscoveryOptions = {}) {
    this.fixtures = options.fixtures ?? MOCK_FIXTURES;
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const q = criteria.query.trim().toLowerCase();
    if (!q) return { ok: false, error: 'INVALID_CRITERIA', message: 'Query is required.' };
    if (q === 'empty') return { ok: true, source: this.name, records: [], malformed: 0 };
    if (q === 'fail') return { ok: false, error: 'SOURCE_ERROR', message: 'Mock source failure.' };
    if (q === 'timeout') return { ok: false, error: 'TIMEOUT', message: 'Mock source timed out.' };
    const max = Math.max(0, Math.min(criteria.maxResults, this.maxResultsCap));
    return { ok: true, source: this.name, records: this.fixtures.slice(0, max), malformed: 0 };
  }

  normalize(record: RawDiscoveryRecord): NormalizedDiscoveryRecord {
    return normalizeWork(record);
  }
}
