/**
 * CrossrefMetadataProvider — real bibliographic lookup against Crossref
 * (docs/26 §11-12, ADR-014).
 *
 * Security posture (this is the ONLY outbound host M3 contacts):
 *   - HTTPS only, host-PINNED to api.crossref.org — the DOI is only ever used to
 *     build the path, never to choose a host (no arbitrary-URL fetching, SSRF
 *     defense docs/16 §7,§10);
 *   - timeout-bounded (AbortController) and response-size-bounded (streamed cap);
 *   - redirects are NOT followed (redirect:"error") so a crafted response cannot
 *     bounce the request onto an internal host;
 *   - Crossref output is UNTRUSTED (docs/16 §8): every field is validated and
 *     sanitized, the returned DOI is re-normalized and must match the request,
 *     and provider markup is reduced to text — never rendered.
 *
 * `fetch` is injected so the provider is fully unit-testable with no network and
 * no cost; production passes the platform `globalThis.fetch`.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import type {
  MetadataAuthor,
  MetadataLookupResult,
  MetadataProvider,
  NormalizedMetadata,
} from "./types.js";
import { LIMITS, sanitizeHttpUrl, sanitizeMarkupToText, sanitizeText } from "./sanitize.js";

/** The single permitted host. Never widened. */
const CROSSREF_HOST = "api.crossref.org";
const CROSSREF_ORIGIN = `https://${CROSSREF_HOST}`;

/** Minimal fetch signature so the provider does not depend on DOM lib types. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    redirect?: "error" | "follow" | "manual";
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export interface CrossrefProviderOptions {
  readonly fetch: FetchLike;
  /** Request timeout in ms (default 8000). */
  readonly timeoutMs?: number;
  /** Maximum response body size in bytes (default 1 MiB). */
  readonly maxBytes?: number;
  /** Contact email included in the User-Agent per Crossref etiquette. */
  readonly contactEmail?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export class CrossrefMetadataProvider implements MetadataProvider {
  readonly name = "crossref";
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #userAgent: string;

  constructor(options: CrossrefProviderOptions) {
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const contact = options.contactEmail ? ` (mailto:${options.contactEmail})` : "";
    this.#userAgent = `WiseEvidence/0.1 (+https://github.com/ihkarise/Wise-evidence-)${contact}`;
  }

  async fetchByDoi(doi: string): Promise<MetadataLookupResult> {
    const canonical = toCanonicalDoi(doi);
    if (canonical === null) {
      return { ok: false, reason: "invalid-doi" };
    }

    // Host is a constant; only the path segment is derived from the DOI.
    const url = `${CROSSREF_ORIGIN}/works/${encodeURIComponent(canonical)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    let response: FetchLikeResponse;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": this.#userAgent },
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      const aborted =
        error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      return aborted ? { ok: false, reason: "timeout" } : { ok: false, reason: "network" };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return { ok: false, reason: "not-found" };
    }
    if (!response.ok) {
      return { ok: false, reason: "provider-error", detail: `HTTP ${response.status}` };
    }

    let rawBody: string;
    try {
      rawBody = await this.#readBounded(response);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return { ok: false, reason: "too-large" };
      }
      return { ok: false, reason: "network" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: "provider-error", detail: "invalid JSON" };
    }

    return this.#normalize(parsed, canonical);
  }

  /**
   * Read the response body with a hard byte cap. Prefers streaming (so an
   * oversized body is rejected before it is fully buffered); falls back to
   * `text()` + length check where a stream is unavailable (e.g. test fakes).
   */
  async #readBounded(response: FetchLikeResponse): Promise<string> {
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
          if (total > this.#maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new ResponseTooLargeError();
          }
          chunks.push(value);
        }
      }
      return new TextDecoder().decode(concat(chunks));
    }
    const text = await response.text();
    // Cap by UTF-8 byte length, not code units.
    if (new TextEncoder().encode(text).byteLength > this.#maxBytes) {
      throw new ResponseTooLargeError();
    }
    return text;
  }

  /** Validate + sanitize the Crossref `message` object into NormalizedMetadata. */
  #normalize(parsed: unknown, requestedDoi: string): MetadataLookupResult {
    const message = getObject(getProp(parsed, "message"));
    if (message === null) {
      return { ok: false, reason: "invalid-metadata", detail: "missing message" };
    }

    // The DOI Crossref echoes must re-normalize to the DOI we asked for.
    const returnedDoi = toCanonicalDoi(asString(getProp(message, "DOI")) ?? "");
    if (returnedDoi === null || returnedDoi !== requestedDoi) {
      return { ok: false, reason: "invalid-metadata", detail: "DOI mismatch" };
    }

    const title = sanitizeText(firstOfArray(getProp(message, "title")), LIMITS.title) ?? "";
    const journalTitle = sanitizeText(
      firstOfArray(getProp(message, "container-title")),
      LIMITS.journalTitle,
    );
    const publisher = sanitizeText(getProp(message, "publisher"), LIMITS.publisher);
    const abstract = sanitizeMarkupToText(getProp(message, "abstract"), LIMITS.abstract);
    const url = sanitizeHttpUrl(getProp(message, "URL"));
    const publicationDate = extractDate(message);
    const authors = extractAuthors(getProp(message, "author"));

    const metadata: NormalizedMetadata = {
      doi: requestedDoi,
      title,
      authors,
      journalTitle,
      publisher,
      publicationDate,
      abstract,
      url,
      provider: this.name,
    };
    return { ok: true, metadata };
  }
}

class ResponseTooLargeError extends Error {}

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

/** Build ordered, sanitized authors from Crossref's `author` array. */
function extractAuthors(value: unknown): MetadataAuthor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const authors: MetadataAuthor[] = [];
  for (const entry of value.slice(0, LIMITS.maxAuthors)) {
    const given = sanitizeText(getProp(entry, "given"), LIMITS.authorName);
    const family = sanitizeText(getProp(entry, "family"), LIMITS.authorName);
    const literal = sanitizeText(getProp(entry, "name"), LIMITS.authorName);
    const displayName =
      [given, family].filter((p): p is string => p !== null).join(" ") || literal;
    if (displayName) {
      authors.push({ displayName: displayName.slice(0, LIMITS.authorName), order: authors.length });
    }
  }
  return authors;
}

/**
 * Extract a publication date from Crossref's date-parts. Prefers
 * `published` → `published-print` → `published-online` → `issued`. Produces
 * `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` — validated numerically.
 */
function extractDate(message: Record<string, unknown>): string | null {
  for (const key of ["published", "published-print", "published-online", "issued"]) {
    const parts = getProp(getProp(message, key), "date-parts");
    if (Array.isArray(parts) && Array.isArray(parts[0])) {
      const [y, m, d] = parts[0] as unknown[];
      const year = asInt(y);
      if (year === null || year < 1000 || year > 9999) continue;
      const month = asInt(m);
      const day = asInt(d);
      let out = String(year);
      if (month !== null && month >= 1 && month <= 12) {
        out += `-${String(month).padStart(2, "0")}`;
        if (day !== null && day >= 1 && day <= 31) {
          out += `-${String(day).padStart(2, "0")}`;
        }
      }
      return out;
    }
  }
  return null;
}

// --- tiny, defensive accessors for untrusted parsed JSON ---------------------

function getProp(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function firstOfArray(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}
