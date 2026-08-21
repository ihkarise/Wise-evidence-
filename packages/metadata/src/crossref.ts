import { normalizeDoi } from '@wise-evidence/domain';
import type { BibliographicMetadata, MetadataProvider, MetadataResult } from './types.js';
import { LIMITS, sanitizeString, sanitizeUrl } from './validation.js';

/**
 * Crossref bibliographic metadata provider (docs/23 Phase 6).
 *
 * Calls ONLY `https://api.crossref.org/works/{doi}` — server-side, host-pinned,
 * https-only, with a timeout, a response-size cap, and no cross-host redirects.
 * All output is untrusted and sanitized before returning. Metadata is a
 * suggestion; it never determines the final scientific classification.
 */
export interface CrossrefOptions {
  /** Inject a fetch implementation (tests supply a fake; default = global fetch). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Polite-pool contact per Crossref etiquette. */
  userAgent?: string;
  maxBytes?: number;
}

const CROSSREF_HOST = 'api.crossref.org';

// Minimal shape we read from Crossref's `message` object (all fields optional).
interface CrossrefMessage {
  title?: unknown;
  author?: unknown;
  'container-title'?: unknown;
  publisher?: unknown;
  URL?: unknown;
  DOI?: unknown;
  published?: { 'date-parts'?: unknown };
  issued?: { 'date-parts'?: unknown };
}

function mapAuthors(author: unknown): string[] {
  if (!Array.isArray(author)) return [];
  const names: string[] = [];
  for (const a of author) {
    if (a && typeof a === 'object') {
      const rec = a as Record<string, unknown>;
      const composed =
        typeof rec.name === 'string'
          ? rec.name
          : [rec.given, rec.family].filter((p) => typeof p === 'string').join(' ');
      const clean = sanitizeString(composed, LIMITS.name);
      if (clean) names.push(clean);
    }
  }
  return names.slice(0, 100);
}

function mapDate(message: CrossrefMessage): string | null {
  const parts = (message.published?.['date-parts'] ?? message.issued?.['date-parts']) as unknown;
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [y, m, d] = parts[0] as unknown[];
  if (typeof y !== 'number') return null;
  const yyyy = String(y).padStart(4, '0');
  if (typeof m !== 'number') return yyyy;
  const mm = String(m).padStart(2, '0');
  if (typeof d !== 'number') return `${yyyy}-${mm}`;
  return `${yyyy}-${mm}-${String(d).padStart(2, '0')}`;
}

function mapMessage(message: CrossrefMessage, canonicalDoi: string): BibliographicMetadata {
  const title = Array.isArray(message.title) ? sanitizeString(message.title[0], LIMITS.title) : null;
  const journal = Array.isArray(message['container-title'])
    ? sanitizeString(message['container-title'][0], LIMITS.journal)
    : null;
  const url = sanitizeUrl(message.URL);
  const identifiers: BibliographicMetadata['identifiers'] = [{ type: 'DOI', value: canonicalDoi }];
  return {
    doi: canonicalDoi,
    title,
    authors: mapAuthors(message.author),
    journal,
    publicationDate: mapDate(message),
    publisher: sanitizeString(message.publisher, LIMITS.publisher),
    url,
    identifiers,
  };
}

export class CrossrefMetadataProvider implements MetadataProvider {
  readonly name = 'crossref';
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly maxBytes: number;

  constructor(options: CrossrefOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.userAgent = options.userAgent ?? 'WiseEvidence/0.0 (+https://github.com/ihkarise/wise-evidence)';
    this.maxBytes = options.maxBytes ?? 1_000_000;
  }

  async fetchByDoi(rawDoi: string): Promise<MetadataResult> {
    const normalized = normalizeDoi(rawDoi);
    if (!normalized.ok) return { ok: false, error: 'INVALID_DOI', message: 'DOI is not valid.' };

    const url = `https://${CROSSREF_HOST}/works/${encodeURIComponent(normalized.doi)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
        redirect: 'error', // never follow a redirect to another host
        signal: controller.signal,
      });
      if (res.status === 404) return { ok: false, error: 'NOT_FOUND', message: 'DOI not found at Crossref.' };
      if (!res.ok) return { ok: false, error: 'PROVIDER_ERROR', message: `Crossref returned ${res.status}.` };

      const text = await res.text();
      if (text.length > this.maxBytes) {
        return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response exceeded size limit.' };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response was not valid JSON.' };
      }
      const message = (parsed as { message?: unknown })?.message;
      if (!message || typeof message !== 'object') {
        return { ok: false, error: 'MALFORMED_RESPONSE', message: 'Response missing message object.' };
      }
      return { ok: true, source: this.name, metadata: mapMessage(message as CrossrefMessage, normalized.doi) };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'TIMEOUT', message: 'Crossref request timed out.' };
      }
      return { ok: false, error: 'PROVIDER_ERROR', message: 'Crossref request failed.' };
    } finally {
      clearTimeout(timer);
    }
  }
}
