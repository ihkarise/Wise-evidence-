/**
 * Sanitization for untrusted external metadata (docs/23 Phase 26). Strings are
 * control-char-stripped, whitespace-collapsed, trimmed, and length-capped. URLs
 * are validated to be http(s) only (never javascript:, data:, etc.). Nothing
 * here renders HTML — callers must also escape on output (Astro does by default).
 */

export const LIMITS = {
  title: 1000,
  name: 300,
  journal: 500,
  publisher: 300,
  url: 2048,
  identifier: 200,
} as const;

// Control characters (C0 range U+0000–U+001F and DEL U+007F). Built from escape
// sequences so no literal control byte appears in source. Matching control chars
// is the intent here (we strip them), so no-control-regex is disabled.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function sanitizeString(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.slice(0, max);
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeUrl(value: unknown): string | null {
  if (!isSafeHttpUrl(value)) return null;
  return value.slice(0, LIMITS.url);
}
