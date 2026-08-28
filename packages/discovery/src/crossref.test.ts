import { describe, expect, it } from 'vitest';
import { CrossrefDiscoveryConnector } from './crossref.js';

function fakeFetch(body: string, status = 200): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const items = [
  { DOI: '10.1234/a', title: ['Paper A'], issued: { 'date-parts': [[2020]] } },
  { DOI: '10.1234/b', title: ['Paper B'] },
];

describe('CrossrefDiscoveryConnector', () => {
  it('queries only api.crossref.org/works with a bounded rows param', async () => {
    const { impl, urls } = fakeFetch(JSON.stringify({ message: { items } }));
    const c = new CrossrefDiscoveryConnector({ fetchImpl: impl });
    const r = await c.discover({ query: 'homeopathy allergic rhinitis', maxResults: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.records).toHaveLength(2);
    expect(urls[0]!.startsWith('https://api.crossref.org/works?')).toBe(true);
    expect(urls[0]).toContain('rows=5');
  });

  it('clamps rows to the connector cap', async () => {
    const { impl, urls } = fakeFetch(JSON.stringify({ message: { items: [] } }));
    const c = new CrossrefDiscoveryConnector({ fetchImpl: impl, maxResultsCap: 10 });
    await c.discover({ query: 'x', maxResults: 9999 });
    expect(urls[0]).toContain('rows=10');
  });

  it('reports a non-2xx as SOURCE_ERROR', async () => {
    const { impl } = fakeFetch('{}', 500);
    const c = new CrossrefDiscoveryConnector({ fetchImpl: impl });
    expect(await c.discover({ query: 'x', maxResults: 3 })).toMatchObject({ ok: false, error: 'SOURCE_ERROR' });
  });

  it('reports non-JSON and missing items as MALFORMED_RESPONSE', async () => {
    const bad = new CrossrefDiscoveryConnector({ fetchImpl: fakeFetch('not json').impl });
    expect(await bad.discover({ query: 'x', maxResults: 3 })).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
    const noItems = new CrossrefDiscoveryConnector({ fetchImpl: fakeFetch(JSON.stringify({ message: {} })).impl });
    expect(await noItems.discover({ query: 'x', maxResults: 3 })).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
  });

  it('counts malformed items honestly instead of hiding them', async () => {
    const { impl } = fakeFetch(JSON.stringify({ message: { items: [items[0], 'garbage', null] } }));
    const c = new CrossrefDiscoveryConnector({ fetchImpl: impl });
    const r = await c.discover({ query: 'x', maxResults: 10 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.records).toHaveLength(1);
      expect(r.malformed).toBe(2);
    }
  });

  it('enforces a response-size cap', async () => {
    const big = JSON.stringify({ message: { items } }) + ' '.repeat(10);
    const c = new CrossrefDiscoveryConnector({ fetchImpl: fakeFetch(big).impl, maxBytes: 10 });
    expect(await c.discover({ query: 'x', maxResults: 3 })).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
  });
});
