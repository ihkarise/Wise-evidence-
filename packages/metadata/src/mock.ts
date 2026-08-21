import { normalizeDoi } from '@wise-evidence/domain';
import type { BibliographicMetadata, MetadataProvider, MetadataResult } from './types.js';
import { MOCK_METADATA } from './fixtures.js';

/**
 * Deterministic metadata provider for development and CI (docs/23 Phase 22). Never
 * touches the network. Returns fixtures keyed by canonical DOI; unknown DOIs
 * resolve to NOT_FOUND. This is the default provider unless Crossref is enabled.
 */
export class MockMetadataProvider implements MetadataProvider {
  readonly name = 'mock';
  private readonly data: Record<string, BibliographicMetadata>;

  constructor(data: Record<string, BibliographicMetadata> = MOCK_METADATA) {
    this.data = data;
  }

  async fetchByDoi(rawDoi: string): Promise<MetadataResult> {
    const normalized = normalizeDoi(rawDoi);
    if (!normalized.ok) return { ok: false, error: 'INVALID_DOI', message: 'DOI is not valid.' };
    const hit = this.data[normalized.doi];
    if (!hit) return { ok: false, error: 'NOT_FOUND', message: 'No fixture for this DOI.' };
    return { ok: true, source: this.name, metadata: hit };
  }
}
