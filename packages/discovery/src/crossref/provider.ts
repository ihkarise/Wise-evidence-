/**
 * CrossrefDiscoveryProvider — the first real `DiscoveryProvider` (M7.2; docs/30,
 * ADR-020). It discovers and fetches bibliographic metadata from the Crossref
 * REST API and returns ONLY provider-neutral discovery objects. The rest of the
 * platform never sees a raw Crossref response.
 *
 * Crossref is a METADATA DISCOVERY SOURCE, nothing more. It never publishes,
 * never creates canonical records, never classifies outcome/quality/efficacy,
 * never invokes AI, and never writes to the database (docs/30 §1; the LOCKED
 * boundaries). This connector only produces `DiscoveryResult`s.
 *
 * Security posture (mirrors the M3 Crossref metadata provider, ADR-014, and the
 * M7.1 host policy):
 *   - HTTPS only, host-PINNED to api.crossref.org via a module constant — the
 *     host is NEVER taken from a caller-supplied base URL. Every request URL is
 *     additionally routed through `assertUrlAllowed` against the descriptor.
 *   - `fetch` is dependency-injected (never an ambient global from here), so the
 *     connector is fully deterministic under tests with no network and no cost.
 *   - timeout-bounded (AbortController), response-size-bounded (streamed cap),
 *     redirects rejected (`redirect: "error"`) so a crafted response cannot bounce
 *     the request onto another host, and content-type validated as JSON.
 *   - Crossref output is UNTRUSTED: every field is length-capped/sanitized, DOIs
 *     are normalized through @wise-evidence/domain, markup is reduced to text and
 *     never rendered, and errors never carry secrets.
 *
 * Retry/backoff is intentionally NOT implemented here — a single request per
 * operation. Bounded retries, Retry-After honouring, and scheduling belong to the
 * later, separately-authorized discovery orchestrator (M7.3). A 429 is surfaced
 * as a typed `RATE_LIMITED` error (with any Retry-After in safe detail) for that
 * orchestrator to act on.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import { DiscoveryError, type DiscoveryErrorCode } from "../errors.js";
import { assertUrlAllowed } from "../host-policy.js";
import { hashRawPayload } from "../hash.js";
import { isDiscoveryError } from "../errors.js";
import { normalizeSourceItem } from "../normalize.js";
import type { DiscoveryProvider } from "../provider.js";
import type { SourceDescriptor } from "../descriptor.js";
import {
  DISCOVERY_LIMITS,
  sanitizeHttpUrl,
  sanitizeMarkupToText,
  sanitizeText,
} from "../sanitize.js";
import {
  isJsonContentType,
  readBoundedText,
  ResponseTooLargeError,
  type FetchLike,
  type FetchLikeResponse,
} from "../http.js";
import type {
  DiscoveryPage,
  DiscoveryRequest,
  DiscoveryResult,
  FetchResult,
  NormalizedSourceItem,
  SourceIdentifier,
  SourceItem,
  SourceItemRef,
} from "../types.js";

/** The single permitted Crossref host and origin. Never widened, never overridden. */
export const CROSSREF_HOST = "api.crossref.org";
const CROSSREF_ORIGIN = `https://${CROSSREF_HOST}`;

/** Connector/provider version recorded in provenance. Bump when parsing changes. */
export const CROSSREF_DISCOVERY_VERSION = "crossref-discovery/1";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 20;

/**
 * The Crossref source descriptor. Provider-neutral, secret-free public config.
 *
 * NOTE — rate limits: Crossref's public/polite-pool limits vary and are not
 * verified from this offline environment; the values below are WiseEvidence's
 * own CONSERVATIVE application-level caps (**REQUIRES LIVE VERIFICATION** before
 * any production run). The connector always enforces these caps regardless of
 * Crossref's actual limits.
 */
export const CROSSREF_SOURCE_DESCRIPTOR: SourceDescriptor = {
  key: "crossref",
  displayName: "Crossref REST API",
  providerType: "CROSSREF",
  allowedHosts: [CROSSREF_HOST],
  requireHttps: true,
  allowLocalNetwork: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxResponseBytes: DEFAULT_MAX_BYTES,
  maxItemsPerRequest: 100, // rows per Crossref page (app cap; REQUIRES LIVE VERIFICATION)
  maxCandidatesPerRun: 1000, // per-run ceiling (app cap; REQUIRES LIVE VERIFICATION)
  rateLimit: { requestsPerSecond: 1, burst: 2 }, // conservative; REQUIRES LIVE VERIFICATION
  supportedIdentifierTypes: ["DOI"],
  capabilities: { canDiscover: true, canFetch: true, canPaginate: true, providesAbstracts: true },
};

export interface CrossrefDiscoveryProviderOptions {
  /** Injected fetch. REQUIRED — the connector never reaches for a global fetch. */
  readonly fetch: FetchLike;
  /** Override the source key (default "crossref"). */
  readonly key?: string;
  /** Override descriptor limits (host stays pinned regardless). */
  readonly descriptor?: SourceDescriptor;
  /**
   * Contact email for the polite-pool User-Agent (Crossref etiquette). Supplied
   * by configuration; NEVER hard-coded. Absent → an anonymous (still identifying)
   * User-Agent with no mailto.
   */
  readonly contactEmail?: string | null;
  /** Deterministic clock returning an ISO timestamp. Injectable for tests. */
  readonly clock?: () => string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Default page size when a request omits one (clamped to the descriptor cap). */
  readonly defaultPageSize?: number;
}

export class CrossrefDiscoveryProvider implements DiscoveryProvider {
  readonly key: string;
  readonly descriptor: SourceDescriptor;
  readonly version = CROSSREF_DISCOVERY_VERSION;

  readonly #fetch: FetchLike;
  readonly #clock: () => string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #defaultPageSize: number;
  readonly #userAgent: string;

  constructor(options: CrossrefDiscoveryProviderOptions) {
    this.#fetch = options.fetch;
    this.descriptor = options.descriptor ?? CROSSREF_SOURCE_DESCRIPTOR;
    this.key = options.key ?? this.descriptor.key;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#timeoutMs = options.timeoutMs ?? this.descriptor.timeoutMs;
    this.#maxBytes = options.maxBytes ?? this.descriptor.maxResponseBytes;
    this.#defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
    const contact = options.contactEmail ? ` (mailto:${options.contactEmail})` : "";
    this.#userAgent = `WiseEvidence/0.1 (+https://github.com/ihkarise/Wise-evidence-)${contact}`;
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryResult<DiscoveryPage>> {
    const query = sanitizeText(request.query, DISCOVERY_LIMITS.title);
    const dois = collectDois(request.identifiers);

    // Never allow an unbounded discovery request: a query or DOI filter is required.
    if (query === null && dois.length === 0) {
      return this.#fail(
        "INVALID_IDENTIFIER",
        "discovery requires a non-empty query or at least one DOI identifier",
      );
    }

    const rows = clamp(
      request.pageSize ?? this.#defaultPageSize,
      1,
      this.descriptor.maxItemsPerRequest,
    );
    const cursor =
      typeof request.cursor === "string" && request.cursor.length > 0 ? request.cursor : "*";

    const params = new URLSearchParams();
    if (query !== null) params.set("query", query);
    params.set("rows", String(rows));
    params.set("cursor", cursor);
    const filters: string[] = [];
    for (const doi of dois) filters.push(`doi:${doi}`);
    const since = sanitizeText(request.since, DISCOVERY_LIMITS.date);
    if (since !== null) filters.push(`from-pub-date:${since}`);
    if (filters.length > 0) params.set("filter", filters.join(","));

    const url = `${CROSSREF_ORIGIN}/works?${params.toString()}`;

    const fetched = await this.#getJson(url);
    if (!fetched.ok) return fetched;

    const message = getObject(getProp(fetched.value, "message"));
    if (message === null) {
      return this.#fail("MALFORMED_RESPONSE", "Crossref response has no message object");
    }
    const rawItems = getProp(message, "items");
    if (!Array.isArray(rawItems)) {
      return this.#fail("MALFORMED_RESPONSE", "Crossref message has no items array");
    }

    const items = rawItems
      .slice(0, rows)
      .map((raw) => this.#toSourceItem(raw))
      .filter((item): item is SourceItem => item !== null);

    const nextCursorStr = sanitizeText(
      getProp(message, "next-cursor"),
      DISCOVERY_LIMITS.identifier,
    );
    // Stop paginating on a short/empty page even though Crossref keeps issuing cursors.
    const nextCursor = items.length >= rows && nextCursorStr !== null ? nextCursorStr : null;

    const page: DiscoveryPage = {
      source: this.key,
      items,
      nextCursor,
      discoveredAt: this.#clock(),
    };
    return { ok: true, value: page };
  }

  async fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>> {
    const canonical = toCanonicalDoi(ref.sourceId);
    if (canonical === null) {
      return this.#fail("INVALID_IDENTIFIER", "fetch requires a valid DOI as the source id");
    }
    const url = `${CROSSREF_ORIGIN}/works/${encodeURIComponent(canonical)}`;

    const fetched = await this.#getJson(url);
    if (!fetched.ok) return fetched;

    const message = getObject(getProp(fetched.value, "message"));
    if (message === null) {
      return this.#fail("MALFORMED_RESPONSE", "Crossref response has no message object");
    }
    const item = this.#toSourceItem(message);
    if (item === null) {
      return this.#fail(
        "INSUFFICIENT_METADATA",
        `Crossref item '${canonical}' has no usable metadata`,
      );
    }
    const result: FetchResult = {
      sourceKey: this.key,
      sourceId: item.sourceId,
      item,
      fetchedAt: this.#clock(),
      rawHash: hashRawPayload(message),
    };
    return { ok: true, value: result };
  }

  normalize(item: SourceItem): DiscoveryResult<NormalizedSourceItem> {
    return normalizeSourceItem(item, {
      discoveredAt: this.#clock(),
      fetchedAt: null,
      providerVersion: this.version,
      rawHash: hashRawPayload(item.raw),
    });
  }

  // --- HTTP ------------------------------------------------------------------

  /**
   * GET a Crossref URL and return parsed JSON, or a typed failure. Enforces the
   * host policy, timeout, redirect rejection, size cap, and content-type check.
   * Never throws for expected failures; never leaks secrets.
   */
  async #getJson(url: string): Promise<DiscoveryResult<unknown>> {
    try {
      assertUrlAllowed(url, this.descriptor);
    } catch (error) {
      if (isDiscoveryError(error)) return { ok: false, error };
      return this.#fail("FORBIDDEN_SOURCE", "request URL failed the source host policy");
    }

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
      // A blocked redirect or any connection failure lands here — fail closed.
      return aborted
        ? this.#fail("TIMEOUT", "Crossref request timed out")
        : this.#fail("SOURCE_UNAVAILABLE", "Crossref request failed at the transport layer");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const retryAfter = sanitizeText(response.headers.get("retry-after"), 32);
      const detail =
        retryAfter !== null
          ? `HTTP ${response.status}; retry-after ${retryAfter}`
          : `HTTP ${response.status}`;
      return this.#fail(statusToCode(response.status), "Crossref returned an error status", detail);
    }
    if (!isJsonContentType(response.headers)) {
      return this.#fail("MALFORMED_RESPONSE", "Crossref response was not JSON");
    }

    let bodyText: string;
    try {
      bodyText = await readBoundedText(response, this.#maxBytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return this.#fail("MALFORMED_RESPONSE", "Crossref response exceeded the size limit");
      }
      return this.#fail("SOURCE_UNAVAILABLE", "failed reading the Crossref response body");
    }

    try {
      return { ok: true, value: JSON.parse(bodyText) };
    } catch {
      return this.#fail("MALFORMED_RESPONSE", "Crossref response was not valid JSON");
    }
  }

  // --- parsing (Crossref-specific; kept inside this connector) ---------------

  /**
   * Map one Crossref `work` object to a sanitized `SourceItem`. Returns null only
   * when the object is not a JSON object at all; a missing/invalid DOI is kept
   * (raw) and surfaced — normalization decides usefulness, not this parser, so
   * one bad item never crashes the run.
   */
  #toSourceItem(raw: unknown): SourceItem | null {
    const work = getObject(raw);
    if (work === null) return null;

    const doiRaw = sanitizeText(getProp(work, "DOI"), DISCOVERY_LIMITS.identifier);
    const canonical = doiRaw !== null ? toCanonicalDoi(doiRaw) : null;

    const identifiers: SourceIdentifier[] = [];
    if (doiRaw !== null) identifiers.push({ type: "DOI", value: doiRaw });

    return {
      sourceKey: this.key,
      // Stable id: the canonical DOI (Crossref's stable identifier). Falls back to
      // the raw DOI so provenance is retained, or "" when absent (normalization
      // then rejects it as NORMALIZATION_FAILED).
      sourceId: canonical ?? doiRaw ?? "",
      sourceUrl: sanitizeHttpUrl(getProp(work, "URL")),
      doi: doiRaw,
      identifiers,
      title: sanitizeText(firstOfArray(getProp(work, "title")), DISCOVERY_LIMITS.title),
      authors: extractAuthors(getProp(work, "author")),
      journal: sanitizeText(
        firstOfArray(getProp(work, "container-title")),
        DISCOVERY_LIMITS.journal,
      ),
      publicationDate: extractDate(work),
      abstract: sanitizeMarkupToText(getProp(work, "abstract"), DISCOVERY_LIMITS.abstract),
      // Keep only the source-specific fields useful for provenance/debugging —
      // never a blind copy of the whole Crossref record.
      raw: pickRaw(work),
    };
  }

  #fail(
    code: DiscoveryErrorCode,
    message: string,
    detail?: string,
  ): { readonly ok: false; readonly error: DiscoveryError } {
    return {
      ok: false,
      error: new DiscoveryError(code, `source '${this.key}': ${message}`, {
        source: this.key,
        detail,
      }),
    };
  }
}

// --- pure helpers ------------------------------------------------------------

function collectDois(identifiers: DiscoveryRequest["identifiers"]): string[] {
  if (identifiers === undefined) return [];
  const out: string[] = [];
  for (const id of identifiers) {
    if (id.type !== "DOI") continue;
    const canonical = toCanonicalDoi(id.value);
    if (canonical !== null && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Map an HTTP error status onto the closest typed discovery error code. */
function statusToCode(status: number): DiscoveryErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 408) return "TIMEOUT";
  // 404, other 4xx, and 5xx all mean "the source could not serve this request".
  return "SOURCE_UNAVAILABLE";
}

/** Build ordered, sanitized author display names from Crossref's `author` array. */
function extractAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const entry of value.slice(0, DISCOVERY_LIMITS.maxAuthors)) {
    const given = sanitizeText(getProp(entry, "given"), DISCOVERY_LIMITS.authorName);
    const family = sanitizeText(getProp(entry, "family"), DISCOVERY_LIMITS.authorName);
    const literal = sanitizeText(getProp(entry, "name"), DISCOVERY_LIMITS.authorName);
    const displayName = [given, family].filter((p): p is string => p !== null).join(" ") || literal;
    if (displayName !== null && displayName.length > 0) {
      authors.push(displayName.slice(0, DISCOVERY_LIMITS.authorName));
    }
  }
  return authors;
}

/**
 * Extract a publication date from Crossref's date-parts. Prefers `published` →
 * `published-print` → `published-online` → `issued`. Produces `YYYY`, `YYYY-MM`,
 * or `YYYY-MM-DD`, validated numerically.
 */
function extractDate(work: Record<string, unknown>): string | null {
  for (const key of ["published", "published-print", "published-online", "issued"]) {
    const parts = getProp(getProp(work, key), "date-parts");
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

/** Retain only source-specific fields useful for provenance/debugging. */
function pickRaw(work: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const type = sanitizeText(getProp(work, "type"), DISCOVERY_LIMITS.identifier);
  if (type !== null) out.crossrefType = type;
  const member = sanitizeText(getProp(work, "member"), DISCOVERY_LIMITS.identifier);
  if (member !== null) out.crossrefMember = member;
  const score = getProp(work, "score");
  if (typeof score === "number" && Number.isFinite(score)) out.crossrefScore = score;
  return out;
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

function firstOfArray(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}
