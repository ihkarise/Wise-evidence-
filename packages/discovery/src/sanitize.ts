/**
 * Sanitization for UNTRUSTED source metadata (M7.1; docs/16 §8).
 *
 * Every string that comes from a discovery source passes through here before it
 * is stored on a `SourceItem` or carried into a `NormalizedSourceItem`: control
 * characters are stripped, whitespace collapsed, length hard-capped, and any
 * embedded markup removed as text. This module renders nothing and trusts
 * nothing; source HTML is NEVER emitted as markup.
 *
 * Discovery keeps its own small sanitizer (rather than importing the metadata
 * package) so the discovery boundary stays narrow: it depends only on
 * @wise-evidence/domain. The rules mirror docs/26 §12.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports; no I/O.
 */

/** Default caps. Titles/abstracts can be long; identity fields are short. */
export const DISCOVERY_LIMITS = {
  title: 1000,
  abstract: 20000,
  authorName: 300,
  journal: 500,
  identifier: 500,
  url: 2000,
  date: 10,
  maxAuthors: 200,
  maxIdentifiers: 50,
} as const;

// C0 + C1 control characters and the Unicode line/paragraph separators. Kept as
// an explicit escaped class so this source file contains no literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * Strip control characters, collapse runs of whitespace, trim, and hard-cap
 * length. Returns null for input that is not a string, or is empty/whitespace
 * after cleaning.
 */
export function sanitizeText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const cleaned = input.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return null;
  }
  return cleaned.slice(0, maxLength);
}

/**
 * Remove HTML/JATS-ish tags and decode a small set of common entities, then
 * sanitize as text. Source abstracts frequently contain markup; we keep only
 * the text content.
 */
export function sanitizeMarkupToText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const stripped = input
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return sanitizeText(stripped, maxLength);
}

/**
 * Accept a URL only if it is a well-formed http(s) URL; otherwise null. This is
 * a display/provenance value, NEVER a fetch target — host allow-listing for
 * fetching lives in host-policy.ts.
 */
export function sanitizeHttpUrl(input: unknown): string | null {
  const text = sanitizeText(input, DISCOVERY_LIMITS.url);
  if (text === null) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.toString().slice(0, DISCOVERY_LIMITS.url);
}
