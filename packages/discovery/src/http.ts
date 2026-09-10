/**
 * Injected HTTP transport helpers for networked discovery connectors
 * (M7.2; docs/16 §7-8, docs/30 §3.7).
 *
 * These are the provider-neutral pieces a real connector (Crossref today; PubMed
 * / Europe PMC later) shares: a minimal injected `fetch` signature so a connector
 * never depends on DOM lib types and is fully unit-testable with no network, a
 * hard byte-cap reader (streamed when possible so an oversized body is rejected
 * before it is fully buffered), and a JSON content-type check.
 *
 * The security *policy* (which host, https, redirects) lives in `host-policy.ts`
 * and each connector's `SourceDescriptor`; this module only carries the transport
 * mechanics. It exposes NO ready-made "fetch any URL" function — a connector must
 * build and gate its own request URL through `assertUrlAllowed` first.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports. Uses only
 * standard `AbortController` / `TextDecoder` / `TextEncoder` globals — never the
 * node http/https modules and never an ambient global fetch.
 */

/** Minimal fetch signature so connectors do not depend on DOM lib types. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    redirect?: "error" | "follow" | "manual";
  },
) => Promise<FetchLikeResponse>;

/** The subset of a `Response` a connector needs. The platform `Response` satisfies it. */
export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

/** Thrown by `readBoundedText` when the body exceeds the byte cap. */
export class ResponseTooLargeError extends Error {
  constructor() {
    super("response exceeded the maximum permitted size");
    this.name = "ResponseTooLargeError";
  }
}

/**
 * Read a response body as text with a hard byte cap. Prefers streaming (so an
 * oversized body is rejected before it is fully buffered); falls back to
 * `text()` + a UTF-8 byte-length check where a stream is unavailable (e.g. test
 * fakes). Throws `ResponseTooLargeError` when the cap is exceeded.
 */
export async function readBoundedText(
  response: FetchLikeResponse,
  maxBytes: number,
): Promise<string> {
  const body = response.body ?? null;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new ResponseTooLargeError();
        }
        chunks.push(value);
      }
    }
    return new TextDecoder().decode(concat(chunks));
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ResponseTooLargeError();
  }
  return text;
}

/** True when the response declares a JSON content type (application/*json). */
export function isJsonContentType(headers: { get(name: string): string | null }): boolean {
  const contentType = headers.get("content-type") ?? headers.get("Content-Type") ?? "";
  return /application\/(?:[\w.+-]+\+)?json\b/i.test(contentType) || /\bjson\b/i.test(contentType);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
