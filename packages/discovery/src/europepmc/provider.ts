/**
 * EuropePMCDiscoveryProvider — the second real `DiscoveryProvider` (M7.6; docs/30,
 * ADR-020, docs/24 C2). It discovers and fetches bibliographic metadata from the
 * Europe PMC REST API and returns ONLY provider-neutral discovery objects. The
 * rest of the platform never sees a raw Europe PMC response.
 *
 * Europe PMC is a METADATA DISCOVERY SOURCE, nothing more. It never publishes,
 * never creates canonical records, never classifies outcome/quality/efficacy,
 * never invokes AI, and never writes to the database (docs/30 §1; the LOCKED
 * boundaries). This connector only produces provider-neutral discovery objects.
 *
 * It satisfies the M7.1 `DiscoveryProvider` contract unchanged and reuses the
 * exact same security machinery as the M7.2 Crossref connector — the injected,
 * host-pinned HTTP layer, the host-policy gate, the untrusted-metadata
 * sanitizers, and the shared normalizer. Only the endpoint, the query dialect,
 * and the response parsing are Europe-PMC-specific.
 *
 * Security posture (mirrors the Crossref connector, ADR-020 M7.2):
 *   - HTTPS only, host-PINNED to www.ebi.ac.uk via a module constant — the host
 *     is NEVER taken from a caller-supplied base URL. Every request URL is
 *     additionally routed through `assertUrlAllowed` against the descriptor.
 *   - `fetch` is dependency-injected (never an ambient global from here), so the
 *     connector is fully deterministic under tests with no network and no cost.
 *   - timeout-bounded (AbortController), response-size-bounded (streamed cap),
 *     redirects rejected (`redirect: "error"`) so a crafted response cannot bounce
 *     the request onto another host, and content-type validated as JSON.
 *   - Europe PMC output is UNTRUSTED: every field is length-capped/sanitized,
 *     DOIs are normalized through @wise-evidence/domain, markup is reduced to text
 *     and never rendered, and errors never carry secrets.
 *
 * Retry/backoff is intentionally NOT implemented here — a single request per
 * operation. Bounded retries, Retry-After honouring, and scheduling belong to the
 * separately-authorized discovery orchestrator (M7.3). A 429 is surfaced as a
 * typed `RATE_LIMITED` error (with any Retry-After in safe detail) for that
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

/** The single permitted Europe PMC host and origin. Never widened, never overridden. */
export const EUROPE_PMC_HOST = "www.ebi.ac.uk";
const EUROPE_PMC_ORIGIN = `https://${EUROPE_PMC_HOST}`;
/** The REST search path — the only endpoint this connector uses. */
const EUROPE_PMC_SEARCH_PATH = "/europepmc/webservices/rest/search";

/** Connector/provider version recorded in provenance. Bump when parsing changes. */
export const EUROPE_PMC_DISCOVERY_VERSION = "europepmc-discovery/1";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 25;

/**
 * The Europe PMC source descriptor. Provider-neutral, secret-free public config.
 *
 * NOTE — rate limits: Europe PMC's public limits are not verified from this
 * offline environment; the values below are WiseEvidence's own CONSERVATIVE
 * application-level caps (**REQUIRES LIVE VERIFICATION** before any production
 * run). The connector always enforces these caps regardless of Europe PMC's
 * actual limits. Europe PMC requires no API key.
 */
export const EUROPE_PMC_SOURCE_DESCRIPTOR: SourceDescriptor = {
  key: "europepmc",
  displayName: "Europe PMC REST API",
  providerType: "EUROPE_PMC",
  allowedHosts: [EUROPE_PMC_HOST],
  requireHttps: true,
  allowLocalNetwork: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxResponseBytes: DEFAULT_MAX_BYTES,
  maxItemsPerRequest: 100, // rows per page (app cap; REQUIRES LIVE VERIFICATION)
  maxCandidatesPerRun: 1000, // per-run ceiling (app cap; REQUIRES LIVE VERIFICATION)
  rateLimit: { requestsPerSecond: 1, burst: 2 }, // conservative; REQUIRES LIVE VERIFICATION
  supportedIdentifierTypes: ["DOI", "PMID", "PMCID"],
  capabilities: { canDiscover: true, canFetch: true, canPaginate: true, providesAbstracts: true },
};

export interface EuropePMCDiscoveryProviderOptions {
  /** Injected fetch. REQUIRED — the connector never reaches for a global fetch. */
  readonly fetch: FetchLike;
  /** Override the source key (default "europepmc"). */
  readonly key?: string;
  /** Override descriptor limits (host stays pinned regardless). */
  readonly descriptor?: SourceDescriptor;
  /**
   * Contact email for a polite, identifying User-Agent (Europe PMC etiquette).
   * Supplied by configuration; NEVER hard-coded. Absent → an anonymous (still
   * identifying) User-Agent with no mailto.
   */
  readonly contactEmail?: string | null;
  /** Deterministic clock returning an ISO timestamp. Injectable for tests. */
  readonly clock?: () => string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Default page size when a request omits one (clamped to the descriptor cap). */
  readonly defaultPageSize?: number;
}

export class EuropePMCDiscoveryProvider implements DiscoveryProvider {
  readonly key: string;
  readonly descriptor: SourceDescriptor;
  readonly version = EUROPE_PMC_DISCOVERY_VERSION;

  readonly #fetch: FetchLike;
  readonly #clock: () => string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #defaultPageSize: number;
  readonly #userAgent: string;

  constructor(options: EuropePMCDiscoveryProviderOptions) {
    this.#fetch = options.fetch;
    this.descriptor = options.descriptor ?? EUROPE_PMC_SOURCE_DESCRIPTOR;
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
    const since = sanitizeText(request.since, DISCOVERY_LIMITS.date);

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
    const cursorMark =
      typeof request.cursor === "string" && request.cursor.length > 0 ? request.cursor : "*";

    const queryExpr = buildQuery(query, dois, since);
    const params = new URLSearchParams();
    params.set("query", queryExpr);
    params.set("format", "json");
    params.set("resultType", "core"); // "core" returns abstracts + full metadata
    params.set("pageSize", String(rows));
    params.set("cursorMark", cursorMark);

    const url = `${EUROPE_PMC_ORIGIN}${EUROPE_PMC_SEARCH_PATH}?${params.toString()}`;

    const fetched = await this.#getJson(url);
    if (!fetched.ok) return fetched;

    const envelope = getObject(fetched.value);
    if (envelope === null) {
      return this.#fail("MALFORMED_RESPONSE", "Europe PMC response was not a JSON object");
    }
    const resultList = getObject(getProp(envelope, "resultList"));
    const rawItems = resultList !== null ? getProp(resultList, "result") : undefined;
    // A well-formed empty page (no resultList / empty result) is not malformed —
    // it terminates pagination. Only a non-array `result` is a structural fault.
    if (rawItems !== undefined && !Array.isArray(rawItems)) {
      return this.#fail("MALFORMED_RESPONSE", "Europe PMC resultList.result is not an array");
    }
    const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];

    const items = list
      .slice(0, rows)
      .map((raw) => this.#toSourceItem(raw))
      .filter((item): item is SourceItem => item !== null);

    const nextMark = sanitizeText(getProp(envelope, "nextCursorMark"), DISCOVERY_LIMITS.identifier);
    // Europe PMC repeats the SAME cursorMark on the final page. Stop when the page
    // is short/empty, when no next mark is offered, or when it equals what we sent.
    const nextCursor =
      items.length >= rows && nextMark !== null && nextMark !== cursorMark ? nextMark : null;

    const page: DiscoveryPage = {
      source: this.key,
      items,
      nextCursor,
      discoveredAt: this.#clock(),
    };
    return { ok: true, value: page };
  }

  async fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>> {
    const queryExpr = buildFetchQuery(ref.sourceId);
    if (queryExpr === null) {
      return this.#fail(
        "INVALID_IDENTIFIER",
        "fetch requires a Europe PMC 'SOURCE/ID' identifier or a valid DOI",
      );
    }
    const params = new URLSearchParams();
    params.set("query", queryExpr);
    params.set("format", "json");
    params.set("resultType", "core");
    params.set("pageSize", "1");
    params.set("cursorMark", "*");
    const url = `${EUROPE_PMC_ORIGIN}${EUROPE_PMC_SEARCH_PATH}?${params.toString()}`;

    const fetched = await this.#getJson(url);
    if (!fetched.ok) return fetched;

    const envelope = getObject(fetched.value);
    const resultList = envelope !== null ? getObject(getProp(envelope, "resultList")) : null;
    const rawItems = resultList !== null ? getProp(resultList, "result") : undefined;
    const first = Array.isArray(rawItems) ? rawItems[0] : undefined;
    if (first === undefined) {
      return this.#fail("SOURCE_UNAVAILABLE", `Europe PMC has no record for '${ref.sourceId}'`);
    }
    const item = this.#toSourceItem(first);
    if (item === null) {
      return this.#fail(
        "INSUFFICIENT_METADATA",
        `Europe PMC item '${ref.sourceId}' has no usable metadata`,
      );
    }
    const result: FetchResult = {
      sourceKey: this.key,
      sourceId: item.sourceId,
      item,
      fetchedAt: this.#clock(),
      rawHash: hashRawPayload(first),
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
   * GET a Europe PMC URL and return parsed JSON, or a typed failure. Enforces the
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
        ? this.#fail("TIMEOUT", "Europe PMC request timed out")
        : this.#fail("SOURCE_UNAVAILABLE", "Europe PMC request failed at the transport layer");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const retryAfter = sanitizeText(response.headers.get("retry-after"), 32);
      const detail =
        retryAfter !== null
          ? `HTTP ${response.status}; retry-after ${retryAfter}`
          : `HTTP ${response.status}`;
      return this.#fail(
        statusToCode(response.status),
        "Europe PMC returned an error status",
        detail,
      );
    }
    if (!isJsonContentType(response.headers)) {
      return this.#fail("MALFORMED_RESPONSE", "Europe PMC response was not JSON");
    }

    let bodyText: string;
    try {
      bodyText = await readBoundedText(response, this.#maxBytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return this.#fail("MALFORMED_RESPONSE", "Europe PMC response exceeded the size limit");
      }
      return this.#fail("SOURCE_UNAVAILABLE", "failed reading the Europe PMC response body");
    }

    try {
      return { ok: true, value: JSON.parse(bodyText) };
    } catch {
      return this.#fail("MALFORMED_RESPONSE", "Europe PMC response was not valid JSON");
    }
  }

  // --- parsing (Europe-PMC-specific; kept inside this connector) -------------

  /**
   * Map one Europe PMC `result` object to a sanitized `SourceItem`. Returns null
   * only when the object is not a JSON object at all; thin/broken items are kept
   * and surfaced — normalization decides usefulness, so one bad item never
   * crashes the run.
   */
  #toSourceItem(raw: unknown): SourceItem | null {
    const rec = getObject(raw);
    if (rec === null) return null;

    const source = sanitizeText(getProp(rec, "source"), DISCOVERY_LIMITS.identifier);
    const extId = sanitizeText(getProp(rec, "id"), DISCOVERY_LIMITS.identifier);
    const composite = source !== null && extId !== null ? `${source}/${extId}` : null;

    const doiRaw = sanitizeText(getProp(rec, "doi"), DISCOVERY_LIMITS.identifier);
    const canonical = doiRaw !== null ? toCanonicalDoi(doiRaw) : null;
    const pmid = sanitizeText(getProp(rec, "pmid"), DISCOVERY_LIMITS.identifier);
    const pmcid = sanitizeText(getProp(rec, "pmcid"), DISCOVERY_LIMITS.identifier);

    const identifiers: SourceIdentifier[] = [];
    if (doiRaw !== null) identifiers.push({ type: "DOI", value: doiRaw });
    if (pmid !== null) identifiers.push({ type: "PMID", value: pmid });
    if (pmcid !== null) identifiers.push({ type: "PMCID", value: pmcid });

    return {
      sourceKey: this.key,
      // Stable id: Europe PMC's composite `SOURCE/ID` (its own persistent
      // identifier). Falls back to the canonical/raw DOI so provenance is
      // retained, or "" when absent (normalization then rejects it).
      sourceId: composite ?? canonical ?? doiRaw ?? "",
      sourceUrl: deriveUrl(source, extId, canonical),
      doi: doiRaw,
      identifiers,
      title: sanitizeText(getProp(rec, "title"), DISCOVERY_LIMITS.title),
      authors: extractAuthors(rec),
      journal: extractJournal(rec),
      publicationDate: extractDate(rec),
      abstract: sanitizeMarkupToText(getProp(rec, "abstractText"), DISCOVERY_LIMITS.abstract),
      // Keep only the source-specific fields useful for provenance/debugging —
      // never a blind copy of the whole Europe PMC record.
      raw: pickRaw(rec, source, extId, pmid, pmcid),
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

/**
 * Build a Europe PMC query expression from a free-text query, an optional set of
 * canonical DOIs, and an optional `since` lower bound. Every user-supplied value
 * is quote-escaped so it cannot break out of its field clause. At least one of
 * `query` / `dois` is guaranteed by the caller.
 */
function buildQuery(query: string | null, dois: readonly string[], since: string | null): string {
  const clauses: string[] = [];
  if (query !== null) clauses.push(`(${escapeQueryValue(query)})`);
  if (dois.length > 0) {
    const doiOr = dois.map((doi) => `DOI:"${escapeQuotes(doi)}"`).join(" OR ");
    clauses.push(`(${doiOr})`);
  }
  // A validated `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` lower bound on first publication.
  if (since !== null && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(since)) {
    clauses.push(`(FIRST_PDATE:[${since} TO 3000-12-31])`);
  }
  return clauses.join(" AND ");
}

/**
 * Build the fetch query for a single record. Accepts Europe PMC's composite
 * `SOURCE/ID` (e.g. `MED/36000000`) or a bare DOI. Returns null when neither
 * shape is recognisable.
 */
function buildFetchQuery(sourceId: string): string | null {
  const id = sanitizeText(sourceId, DISCOVERY_LIMITS.identifier);
  if (id === null) return null;

  const slash = id.indexOf("/");
  if (slash > 0 && slash < id.length - 1) {
    const source = id.slice(0, slash);
    const extId = id.slice(slash + 1);
    // A composite id's source is a short alphabetic vocabulary token (MED, PMC,
    // PPR, …); anything else is treated as a DOI candidate instead.
    if (/^[A-Za-z]{2,10}$/.test(source) && !extId.includes("/")) {
      return `(SRC:"${escapeQuotes(source)}" AND EXT_ID:"${escapeQuotes(extId)}")`;
    }
  }

  const canonical = toCanonicalDoi(id);
  if (canonical !== null) return `DOI:"${escapeQuotes(canonical)}"`;
  return null;
}

/**
 * Escape a free-text query value: strip the Lucene/Europe-PMC syntax characters
 * that would let untrusted text alter the query structure, and cap length. This
 * is deliberately conservative — a discovery query is never a place for operators
 * supplied by an untrusted source item.
 */
function escapeQueryValue(value: string): string {
  return value
    .replace(/["\\(){}[\]:^~*?]/g, " ")
    .replace(/\bAND\b|\bOR\b|\bNOT\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DISCOVERY_LIMITS.title);
}

/** Escape embedded quotes/backslashes inside a quoted field value. */
function escapeQuotes(value: string): string {
  return value.replace(/["\\]/g, " ").trim();
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

/**
 * Derive a display/provenance URL. Prefers the DOI resolver, then the Europe PMC
 * article page for a composite id. This is a provenance value only, NEVER a fetch
 * target (host allow-listing for fetching lives in host-policy.ts).
 */
function deriveUrl(
  source: string | null,
  extId: string | null,
  canonical: string | null,
): string | null {
  if (canonical !== null) return sanitizeHttpUrl(`https://doi.org/${canonical}`);
  if (source !== null && extId !== null) {
    return sanitizeHttpUrl(
      `https://europepmc.org/article/${encodeURIComponent(source)}/${encodeURIComponent(extId)}`,
    );
  }
  return null;
}

/**
 * Build ordered, sanitized author display names. Prefers the structured
 * `authorList.author[].fullName`; falls back to splitting `authorString`.
 */
function extractAuthors(rec: Record<string, unknown>): string[] {
  const authorList = getObject(getProp(rec, "authorList"));
  const structured = authorList !== null ? getProp(authorList, "author") : undefined;
  if (Array.isArray(structured)) {
    const authors: string[] = [];
    for (const entry of structured.slice(0, DISCOVERY_LIMITS.maxAuthors)) {
      const full = sanitizeText(getProp(entry, "fullName"), DISCOVERY_LIMITS.authorName);
      const first = sanitizeText(getProp(entry, "firstName"), DISCOVERY_LIMITS.authorName);
      const last = sanitizeText(getProp(entry, "lastName"), DISCOVERY_LIMITS.authorName);
      const composed = [first, last].filter((p): p is string => p !== null).join(" ") || null;
      const name = full ?? composed;
      if (name !== null && name.length > 0)
        authors.push(name.slice(0, DISCOVERY_LIMITS.authorName));
    }
    if (authors.length > 0) return authors;
  }
  // Fallback: "Smith J, Müller R." → ["Smith J", "Müller R"].
  const authorString = sanitizeText(getProp(rec, "authorString"), DISCOVERY_LIMITS.title);
  if (authorString === null) return [];
  return authorString
    .split(",")
    .map((part) => sanitizeText(part, DISCOVERY_LIMITS.authorName))
    .filter((part): part is string => part !== null)
    .slice(0, DISCOVERY_LIMITS.maxAuthors);
}

/** Extract the journal / container title from Europe PMC's nested `journalInfo`. */
function extractJournal(rec: Record<string, unknown>): string | null {
  const journalInfo = getObject(getProp(rec, "journalInfo"));
  const journal = journalInfo !== null ? getObject(getProp(journalInfo, "journal")) : null;
  if (journal !== null) {
    const title = sanitizeText(getProp(journal, "title"), DISCOVERY_LIMITS.journal);
    if (title !== null) return title;
  }
  // Preprints and books use `bookOrReportDetails.publisher` etc.; fall back to none.
  return null;
}

/**
 * Extract a publication date. Prefers `firstPublicationDate` (`YYYY-MM-DD`), then
 * `pubYear` (`YYYY`). Validated numerically; only a well-formed value is returned.
 */
function extractDate(rec: Record<string, unknown>): string | null {
  const first = sanitizeText(getProp(rec, "firstPublicationDate"), DISCOVERY_LIMITS.date);
  if (first !== null && /^\d{4}-\d{2}-\d{2}$/.test(first)) return first;

  const year = sanitizeText(getProp(rec, "pubYear"), DISCOVERY_LIMITS.date);
  if (year !== null && /^\d{4}$/.test(year)) {
    const n = Number.parseInt(year, 10);
    if (n >= 1000 && n <= 9999) return year;
  }
  // A partial `YYYY-MM` first-publication date is still useful.
  if (first !== null && /^\d{4}-\d{2}$/.test(first)) return first;
  if (first !== null && /^\d{4}$/.test(first)) return first;
  return null;
}

/** Retain only source-specific fields useful for provenance/debugging. */
function pickRaw(
  rec: Record<string, unknown>,
  source: string | null,
  extId: string | null,
  pmid: string | null,
  pmcid: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source !== null) out.europepmcSource = source;
  if (extId !== null) out.europepmcId = extId;
  if (pmid !== null) out.pmid = pmid;
  if (pmcid !== null) out.pmcid = pmcid;
  const pubType = sanitizeText(getProp(rec, "pubType"), DISCOVERY_LIMITS.journal);
  if (pubType !== null) out.europepmcPubType = pubType;
  const isOpenAccess = getProp(rec, "isOpenAccess");
  if (typeof isOpenAccess === "string") {
    out.europepmcIsOpenAccess = sanitizeText(isOpenAccess, DISCOVERY_LIMITS.date);
  }
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
