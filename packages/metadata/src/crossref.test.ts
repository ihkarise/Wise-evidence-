import { describe, it, expect } from 'vitest';
import { CrossrefMetadataProvider } from './crossref.js';
import { CROSSREF_SAMPLE_RESPONSE, CROSSREF_SAMPLE_EXPECTED } from './fixtures.js';

function provider(fetchImpl: typeof fetch, timeoutMs = 8000, maxBytes = 1_000_000) {
  return new CrossrefMetadataProvider({ fetchImpl, timeoutMs, maxBytes });
}

const okFetch: typeof fetch = async () =>
  new Response(JSON.stringify(CROSSREF_SAMPLE_RESPONSE), { status: 200 });

describe('CrossrefMetadataProvider (no network — injected fetch)', () => {
  it('maps a successful response to normalized metadata', async () => {
    const res = await provider(okFetch).fetchByDoi('https://doi.org/10.5555/DEMO.crossref.1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.metadata).toEqual(CROSSREF_SAMPLE_EXPECTED);
  });

  it('rejects an invalid DOI without any request', async () => {
    let called = false;
    const spy: typeof fetch = async () => {
      called = true;
      return new Response('', { status: 200 });
    };
    const res = await provider(spy).fetchByDoi('not-a-doi');
    expect(res).toMatchObject({ ok: false, error: 'INVALID_DOI' });
    expect(called).toBe(false);
  });

  it('maps 404 to NOT_FOUND', async () => {
    const res = await provider(async () => new Response('', { status: 404 })).fetchByDoi('10.5555/x.404');
    expect(res).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });

  it('maps other non-2xx to PROVIDER_ERROR', async () => {
    const res = await provider(async () => new Response('', { status: 500 })).fetchByDoi('10.5555/x.500');
    expect(res).toMatchObject({ ok: false, error: 'PROVIDER_ERROR' });
  });

  it('maps malformed JSON to MALFORMED_RESPONSE', async () => {
    const res = await provider(async () => new Response('not json', { status: 200 })).fetchByDoi('10.5555/x.bad');
    expect(res).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
  });

  it('maps a missing message object to MALFORMED_RESPONSE', async () => {
    const res = await provider(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })).fetchByDoi(
      '10.5555/x.nomsg'
    );
    expect(res).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
  });

  it('enforces the response-size cap', async () => {
    const huge = JSON.stringify({ message: { title: ['x'.repeat(50_000)] } });
    const res = await provider(async () => new Response(huge, { status: 200 }), 8000, 100).fetchByDoi('10.5555/x.big');
    expect(res).toMatchObject({ ok: false, error: 'MALFORMED_RESPONSE' });
  });

  it('maps an aborted request to TIMEOUT', async () => {
    const abortFetch: typeof fetch = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const res = await provider(abortFetch).fetchByDoi('10.5555/x.timeout');
    expect(res).toMatchObject({ ok: false, error: 'TIMEOUT' });
  });

  it('maps a network failure to PROVIDER_ERROR', async () => {
    const failFetch: typeof fetch = async () => {
      throw new Error('ECONNRESET');
    };
    const res = await provider(failFetch).fetchByDoi('10.5555/x.neterr');
    expect(res).toMatchObject({ ok: false, error: 'PROVIDER_ERROR' });
  });
});
