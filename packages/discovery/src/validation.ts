/**
 * Sanitization for untrusted external discovery data (docs/25 §security, docs/16).
 * Strings are control-char-stripped, whitespace-collapsed, trimmed, length-capped.
 * URLs are validated to http(s) only. Nothing here renders HTML — callers escape
 * on output (Astro escapes by default). Kept local to this package so discovery
 * stays decoupled from the metadata provider (they answer different questions).
 */

export const LIMITS = {
  title: 1000,
  name: 300,
  journal: 500,
  url: 2048,
  identifier: 200,
  abstract: 20000,
} as const;

// Control chars (C0 range U+0000–U+001F and DEL U+007F). Built from escapes so no
// literal control byte appears in source; matching them is the intent.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

export function sanitizeString(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, max);
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
  return isSafeHttpUrl(value) ? value.slice(0, LIMITS.url) : null;
}

/** Normalize a partial date to 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' from numeric parts. */
export function normalizeDateParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const [y, m, d] = parts as unknown[];
  if (typeof y !== 'number' || !Number.isFinite(y)) return null;
  const yyyy = String(y).padStart(4, '0');
  if (typeof m !== 'number' || !Number.isFinite(m)) return yyyy;
  const mm = String(m).padStart(2, '0');
  if (typeof d !== 'number' || !Number.isFinite(d)) return `${yyyy}-${mm}`;
  return `${yyyy}-${mm}-${String(d).padStart(2, '0')}`;
}
