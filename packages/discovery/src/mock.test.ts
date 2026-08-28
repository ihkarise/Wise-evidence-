import { describe, expect, it } from 'vitest';
import { MockDiscoveryConnector } from './mock.js';

const c = new MockDiscoveryConnector();

describe('MockDiscoveryConnector', () => {
  it('returns the standard multi-result fixture set, bounded by maxResults', async () => {
    const r = await c.discover({ query: 'homeopathy', maxResults: 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.records).toHaveLength(3);
  });

  it('clamps maxResults to the connector cap', async () => {
    const r = await c.discover({ query: 'homeopathy', maxResults: 9999 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.records.length).toBeLessThanOrEqual(c.maxResultsCap);
  });

  it('models empty / failure / timeout scenarios deterministically', async () => {
    expect(await c.discover({ query: 'empty', maxResults: 5 })).toMatchObject({ ok: true, records: [] });
    expect(await c.discover({ query: 'fail', maxResults: 5 })).toMatchObject({ ok: false, error: 'SOURCE_ERROR' });
    expect(await c.discover({ query: 'timeout', maxResults: 5 })).toMatchObject({ ok: false, error: 'TIMEOUT' });
  });

  it('rejects an empty query', async () => {
    expect(await c.discover({ query: '   ', maxResults: 5 })).toMatchObject({ ok: false, error: 'INVALID_CRITERIA' });
  });

  it('normalizes fixtures: within-batch duplicate DOIs are visible for dedup, missing DOIs kept as source ids', async () => {
    const r = await c.discover({ query: 'homeopathy', maxResults: 50 });
    if (!r.ok) throw new Error('expected ok');
    const norm = r.records.map((rec) => c.normalize(rec));
    const dois = norm.map((n) => n.doi).filter(Boolean);
    // fixture 1 and 4 share a DOI → a within-batch duplicate is present.
    expect(new Set(dois).size).toBeLessThan(dois.length);
    // a fixture with no DOI keeps a non-empty source id.
    expect(norm.some((n) => n.doi === null && n.sourceRecordId.length > 0)).toBe(true);
    // fixtures are clearly labelled test data.
    expect(norm.every((n) => n.title === null || n.title.includes('[mockdemo]') || n.title === '')).toBe(true);
  });
});
