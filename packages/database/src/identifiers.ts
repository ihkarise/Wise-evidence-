import { normalizeDoi } from '@wise-evidence/domain';
import type { IdentifierType } from './types.js';

/**
 * Canonicalize an external identifier for storage/deduplication.
 *
 * DOIs are normalized via the portable domain normalizer (`@wise-evidence/domain`)
 * — this is the intended dependency direction (domain ← database). Other
 * identifier types are trimmed and lowercased. Returns `null` when a DOI is
 * malformed, so callers route it to review rather than storing garbage.
 */
export interface CanonicalIdentifier {
  id_type: IdentifierType;
  value_raw: string;
  value_canonical: string;
}

export function toCanonicalIdentifier(
  type: IdentifierType,
  raw: string
): CanonicalIdentifier | null {
  if (type === 'DOI') {
    const result = normalizeDoi(raw);
    if (!result.ok) return null;
    return { id_type: 'DOI', value_raw: raw, value_canonical: result.doi };
  }
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  return { id_type: type, value_raw: raw, value_canonical: trimmed.toLowerCase() };
}
