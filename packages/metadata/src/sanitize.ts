/**
 * Sanitization for UNTRUSTED provider output (docs/16 §8, docs/26 §12).
 *
 * Every string that comes from an external metadata provider passes through
 * here before it can be stored or shown: control characters are stripped, length
 * is capped, and whitespace is collapsed. This module renders nothing and trusts
 * nothing; provider HTML is never emitted as markup.
 */

/** Default caps. Titles/abstracts can be long; everything else is short. */
export const LIMITS = {
  title: 1000,
  abstract: 20000,
  authorName: 300,
  journalTitle: 500,
  publisher: 500,
  url: 2000,
  maxAuthors: 200,
} as const;

// C0 + C1 control characters and the Unicode line/paragraph separators. Kept as
// an explicit escaped class so the source file contains no literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

/**
 * Strip control characters (even tab/newline are normalized to a space),
 * collapse runs of whitespace, trim, and hard-cap length. Returns null for
 * input that is null/empty/whitespace-only after cleaning.
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
 * sanitize as text. Crossref abstracts frequently contain JATS markup; we keep
 * only the text content.
 */
export function sanitizeMarkupToText(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const stripped = input
    .replace(/<[^>]*>/g, " ") // drop any tag
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // decode ampersand last
  return sanitizeText(stripped, maxLength);
}

/**
 * Accept a URL only if it is a well-formed http(s) URL; otherwise null. This is
 * a display/link value, never a fetch target.
 */
export function sanitizeHttpUrl(input: unknown): string | null {
  const text = sanitizeText(input, LIMITS.url);
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
  return parsed.toString().slice(0, LIMITS.url);
}
