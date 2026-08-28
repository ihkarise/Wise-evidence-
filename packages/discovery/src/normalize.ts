/**
 * Normalize a Crossref-shaped "work" record into a candidate. Both the Crossref
 * connector and the deterministic mock produce this shape, so one normalizer
 * serves both (docs/25 §normalization). DOI normalization reuses the domain
 * package — never a second algorithm. Missing values stay null; nothing is
 * fabricated.
 */
import { normalizeDoi } from '@wise-evidence/domain';
import type { NormalizedDiscoveryRecord, RawDiscoveryRecord } from './types.js';
import { LIMITS, normalizeDateParts, sanitizeString, sanitizeUrl } from './validation.js';

interface CrossrefWork {
  DOI?: unknown;
  title?: unknown;
  author?: unknown;
  'container-title'?: unknown;
  URL?: unknown;
  abstract?: unknown;
  published?: { 'date-parts'?: unknown };
  issued?: { 'date-parts'?: unknown };
}

function authors(author: unknown): string[] {
  if (!Array.isArray(author)) return [];
  const names: string[] = [];
  for (const a of author) {
    if (a && typeof a === 'object') {
      const rec = a as Record<string, unknown>;
      const composed =
        typeof rec.name === 'string' ? rec.name : [rec.given, rec.family].filter((p) => typeof p === 'string').join(' ');
      const clean = sanitizeString(composed, LIMITS.name);
      if (clean) names.push(clean);
    }
  }
  return names.slice(0, 100);
}

export function normalizeWork(record: RawDiscoveryRecord): NormalizedDiscoveryRecord {
  const work = (record.raw && typeof record.raw === 'object' ? record.raw : {}) as CrossrefWork;

  const doiResult = typeof work.DOI === 'string' ? normalizeDoi(work.DOI) : { ok: false as const };
  const doi = doiResult.ok ? doiResult.doi : null;

  const title = Array.isArray(work.title) ? sanitizeString(work.title[0], LIMITS.title) : sanitizeString(work.title, LIMITS.title);
  const journal = Array.isArray(work['container-title'])
    ? sanitizeString(work['container-title'][0], LIMITS.journal)
    : sanitizeString(work['container-title'], LIMITS.journal);
  const dateParts = work.published?.['date-parts'] ?? work.issued?.['date-parts'];
  const publicationDate = normalizeDateParts(Array.isArray(dateParts) ? dateParts[0] : null);

  return {
    doi,
    sourceRecordId: sanitizeString(record.sourceRecordId, LIMITS.identifier) ?? (doi ?? ''),
    title,
    authors: authors(work.author),
    journal,
    publicationDate,
    url: sanitizeUrl(work.URL),
    abstract: sanitizeString(work.abstract, LIMITS.abstract),
  };
}
