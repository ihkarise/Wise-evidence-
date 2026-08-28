/**
 * Crossref discovery connector (docs/25 §source policy). Answers "what research
 * exists for this query?" via Crossref's structured works search — NOT HTML
 * scraping. Distinct from the M3 metadata provider (which fetches metadata for a
 * known DOI); they share only the DOI normalizer.
 *
 * Safety (docs/25 §security, docs/16): calls ONLY `https://api.crossref.org/works`
 * — host-pinned, https-only, bounded `rows`, timeout, response-size cap, and no
 * cross-host redirects. It never fetches arbitrary URLs found in results. All
 * output is untrusted and normalized before use.
 */
import { normalizeWork } from './normalize.js';
import type { DiscoveryCriteria, DiscoveryResult, NormalizedDiscoveryRecord, RawDiscoveryRecord, ResearchDiscoveryConnector } from './types.js';
import { LIMITS, sanitizeString } from './validation.js';

const CROSSREF_HOST = 'api.crossref.org';

export interface CrossrefDiscoveryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  maxBytes?: number;
  /** Hard cap on `rows` regardless of the caller's request. */
  maxResultsCap?: number;
}

interface CrossrefItem {
  DOI?: unknown;
}

export class CrossrefDiscoveryConnector implements ResearchDiscoveryConnector {
  readonly name = 'crossref';
  readonly maxResultsCap: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly maxBytes: number;

  constructor(options: CrossrefDiscoveryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.userAgent = options.userAgent ?? 'WiseEvidence/0.0 (+https://github.com/ihkarise/wise-evidence)';
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxResultsCap = options.maxResultsCap ?? 50;
  }

  async discover(criteria: DiscoveryCriteria): Promise<DiscoveryResult> {
    const query = criteria.query.trim();
    if (!query) return { ok: false, error: 'INVALID_CRITERIA', message: 'Query is required.' };
    const rows = Math.max(1, Math.min(Math.floor(criteria.maxResults) || 0, this.maxResultsCap));

    const params = new URLSearchParams({
      query,
      rows: String(rows),
      select: 'DOI,title,author,container-title,issued,published,URL',
    });
    const url = `https://${CROSSREF_HOST}/works?${params.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, error: 'SOURCE_ERROR', message: `Crossref returned ${res.status}.` };

      const text = await res.text();
      if (text.length > this.maxBytes) return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response exceeded size limit.' };

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response was not valid JSON.' };
      }
      const items = (parsed as { message?: { items?: unknown } })?.message?.items;
      if (!Array.isArray(items)) return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response missing message.items.' };

      const records: RawDiscoveryRecord[] = [];
      let malformed = 0;
      for (const item of items.slice(0, rows)) {
        if (!item || typeof item !== 'object') {
          malformed++;
          continue;
        }
        const doi = sanitizeString((item as CrossrefItem).DOI, LIMITS.identifier);
        records.push({ sourceRecordId: doi ?? `crossref:unknown-${records.length}`, raw: item });
      }
      return { ok: true, source: this.name, records, malformed };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { ok: false, error: 'TIMEOUT', message: 'Crossref request timed out.' };
      return { ok: false, error: 'SOURCE_ERROR', message: 'Crossref request failed.' };
    } finally {
      clearTimeout(timer);
    }
  }

  normalize(record: RawDiscoveryRecord): NormalizedDiscoveryRecord {
    return normalizeWork(record);
  }
}
