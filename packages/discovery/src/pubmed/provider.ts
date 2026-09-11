/**
 * PubMedDiscoveryProvider — the third real `DiscoveryProvider` (M7.7; docs/30,
 * ADR-020, docs/24 C3). It discovers and fetches bibliographic metadata from the
 * NCBI E-utilities JSON API and returns ONLY provider-neutral discovery objects.
 * The rest of the platform never sees a raw NCBI response.
 *
 * PubMed is a METADATA DISCOVERY SOURCE, nothing more. It never publishes, never
 * creates canonical records, never classifies outcome/quality/efficacy, never
 * invokes AI, and never writes to the database (docs/30 §1; the LOCKED
 * boundaries). This connector only produces provider-neutral discovery objects
 * that flow through the EXISTING normalize → dedup → human-review pipeline.
 *
 * It satisfies the M7.1 `DiscoveryProvider` contract UNCHANGED and reuses the
 * exact same security machinery as the M7.2 Crossref and M7.6 Europe PMC
 * connectors — the injected, host-pinned HTTP layer, the host-policy gate, the
 * untrusted-metadata sanitizers, and the shared normalizer. Only the endpoints,
 * the query dialect, and the response parsing are PubMed-specific.
 *
 * JSON ONLY (Option A, authorized M7.7 scope): the connector uses the official
 * ESearch + ESummary JSON endpoints and NOTHING else. It deliberately does NOT
 * parse XML, does NOT retrieve abstracts (ESummary JSON carries none), and does
 * NOT fetch full text — so `descriptor.capabilities.providesAbstracts` is false.
 * Crossref / Europe PMC supply abstracts for the same record where appropriate.
 *
 * Two HTTP calls per discovery page: ESearch (term → PMIDs), then ESummary
 * (PMIDs → metadata). fetch() is a single ESummary call for one PMID. The
 * orchestrator counts ONE request per discover()/fetch() (docs/30 §10.6); this
 * connector never issues more than the two calls a page requires and adds no
 * scheduler, worker, retry, or concurrency of its own.
 *
 * Security posture (mirrors Crossref/Europe PMC, ADR-020):
 *   - HTTPS only, host-PINNED to eutils.ncbi.nlm.nih.gov via a module constant —
 *     the host is NEVER taken from a caller-supplied base URL. Every request URL
 *     is additionally routed through `assertUrlAllowed` against the descriptor.
 *   - `fetch` is dependency-injected (never an ambient global from here), so the
 *     connector is fully deterministic under tests with no network and no cost.
 *   - timeout-bounded (AbortController), response-size-bounded (streamed cap),
 *     redirects rejected (`redirect: "error"`), content-type validated as JSON.
 *   - NCBI output is UNTRUSTED: every field is length-capped/sanitized, DOIs are
 *     normalized through @wise-evidence/domain, and errors never carry secrets.
 *   - No API key: the public E-utilities endpoints are used key-free. NCBI's
 *     optional api_key (and tool/email query params) are intentionally NOT added
 *     — a secret is never introduced merely because one could raise a rate limit.
 *
 * Retry/backoff is intentionally NOT implemented here — the bounded retries,
 * Retry-After honouring, and scheduling belong to the discovery orchestrator
 * (M7.3). A 429 is surfaced as a typed `RATE_LIMITED` error (with any Retry-After
 * in safe detail) for that orchestrator to act on.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import { DiscoveryError, type DiscoveryErrorCode } from "../errors.js";
import { assertUrlAllowed } from "../host-policy.js";
import { hashRawPayload } from "../hash.js";
import { isDiscoveryError } from "../errors.js";
import { normalizeSourceItem } from "../normalize.js";
import type { DiscoveryProvider } from "../provider.js";
import type { SourceDescriptor } from "../descriptor.js";
import { DISCOVERY_LIMITS, sanitizeHttpUrl, sanitizeText } from "../sanitize.js";
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

/** The single permitted NCBI E-utilities host. Never widened, never overridden. */
export const PUBMED_HOST = "eutils.ncbi.nlm.nih.gov";
const PUBMED_ORIGIN = `https://${PUBMED_HOST}`;
/** The two REST endpoints this connector uses — and the only ones it ever touches. */
const PUBMED_ESEARCH_PATH = "/entrez/eutils/esearch.fcgi";
const PUBMED_ESUMMARY_PATH = "/entrez/eutils/esummary.fcgi";
/** The E-utilities database. PubMed only — no other NCBI db is queried. */
const PUBMED_DB = "pubmed";

/** Connector/provider version recorded in provenance. Bump when parsing changes. */
export const PUBMED_DISCOVERY_VERSION = "pubmed-discovery/1";

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 25;
/** A PMID is a positive integer of up to nine digits. */
const PMID_RE = /^\d{1,9}$/;

/**
 * The PubMed source descriptor. Provider-neutral, secret-free public config.
 *
 * NOTE — rate limits: NCBI's public E-utilities allow ~3 requests/second WITHOUT
 * an API key. Because a single discovery page issues TWO HTTP calls (ESearch +
 * ESummary), the values below are WiseEvidence's own CONSERVATIVE application
 * caps (**REQUIRES LIVE VERIFICATION** before any production run). The connector
 * always enforces these caps regardless of NCBI's actual limits. No API key.
 */
export const PUBMED_SOURCE_DESCRIPTOR: SourceDescriptor = {
  key: "pubmed",
  displayName: "PubMed (NCBI E-utilities)",
  providerType: "PUBMED",
  allowedHosts: [PUBMED_HOST],
  requireHttps: true,
  allowLocalNetwork: false,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxResponseBytes: DEFAULT_MAX_BYTES,
  maxItemsPerRequest: 100, // PMIDs per ESummary page (app cap; REQUIRES LIVE VERIFICATION)
  maxCandidatesPerRun: 1000, // per-run ceiling (app cap; REQUIRES LIVE VERIFICATION)
  rateLimit: { requestsPerSecond: 1, burst: 2 }, // conservative (2 HTTP/page); REQUIRES LIVE VERIFICATION
  supportedIdentifierTypes: ["DOI", "PMID", "PMCID"],
  // providesAbstracts is FALSE: JSON-only, no XML, so ESummary carries no abstract.
  capabilities: { canDiscover: true, canFetch: true, canPaginate: true, providesAbstracts: false },
};

export interface PubMedDiscoveryProviderOptions {
  /** Injected fetch. REQUIRED — the connector never reaches for a global fetch. */
  readonly fetch: FetchLike;
  /** Override the source key (default "pubmed"). */
  readonly key?: string;
  /** Override descriptor limits (host stays pinned regardless). */
  readonly descriptor?: SourceDescriptor;
  /**
   * Contact email for a polite, identifying User-Agent (NCBI etiquette). Supplied
   * by configuration; NEVER hard-coded. Absent → an anonymous (still identifying)
   * User-Agent with no mailto. It is NEVER sent as an NCBI `email` query param.
   */
  readonly contactEmail?: string | null;
  /** Deterministic clock returning an ISO timestamp. Injectable for tests. */
  readonly clock?: () => string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /** Default page size when a request omits one (clamped to the descriptor cap). */
  readonly defaultPageSize?: number;
}

export class PubMedDiscoveryProvider implements DiscoveryProvider {
  readonly key: string;
  readonly descriptor: SourceDescriptor;
  readonly version = PUBMED_DISCOVERY_VERSION;

  readonly #fetch: FetchLike;
  readonly #clock: () => string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;
  readonly #defaultPageSize: number;
  readonly #userAgent: string;

  constructor(options: PubMedDiscoveryProviderOptions) {
    this.#fetch = options.fetch;
    this.descriptor = options.descriptor ?? PUBMED_SOURCE_DESCRIPTOR;
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
    const pmids = collectPmids(request.identifiers);
    const dois = collectDois(request.identifiers);
    const since = sanitizeText(request.since, DISCOVERY_LIMITS.date);

    // Never allow an unbounded discovery request: a query, PMID, or DOI is required.
    if (query === null && pmids.length === 0 && dois.length === 0) {
      return this.#fail(
        "INVALID_IDENTIFIER",
        "discovery requires a non-empty query or at least one PMID/DOI identifier",
      );
    }

    const rows = clamp(
      request.pageSize ?? this.#defaultPageSize,
      1,
      this.descriptor.maxItemsPerRequest,
    );
    const retStart = parseCursor(request.cursor);
    const term = buildTerm(query, pmids, dois, since);

    // --- 1) ESearch: term → a page of PMIDs -----------------------------------
    const searchParams = new URLSearchParams();
    searchParams.set("db", PUBMED_DB);
    searchParams.set("term", term);
    searchParams.set("retmode", "json");
    searchParams.set("retstart", String(retStart));
    searchParams.set("retmax", String(rows));
    const searchUrl = `${PUBMED_ORIGIN}${PUBMED_ESEARCH_PATH}?${searchParams.toString()}`;

    const searchFetched = await this.#getJson(searchUrl);
    if (!searchFetched.ok) return searchFetched;

    const searchEnvelope = getObject(searchFetched.value);
    const esearchresult =
      searchEnvelope !== null ? getObject(getProp(searchEnvelope, "esearchresult")) : null;
    if (esearchresult === null) {
      return this.#fail(
        "MALFORMED_RESPONSE",
        "PubMed ESearch response had no esearchresult object",
      );
    }
    const rawIdList = getProp(esearchresult, "idlist");
    // A well-formed empty result terminates pagination — it is not malformed.
    if (rawIdList !== undefined && !Array.isArray(rawIdList)) {
      return this.#fail("MALFORMED_RESPONSE", "PubMed ESearch idlist is not an array");
    }
    const idList = uniquePmids(Array.isArray(rawIdList) ? rawIdList : []).slice(0, rows);
    const totalCount = parseCount(getProp(esearchresult, "count"));

    if (idList.length === 0) {
      const page: DiscoveryPage = {
        source: this.key,
        items: [],
        nextCursor: null,
        discoveredAt: this.#clock(),
      };
      return { ok: true, value: page };
    }

    // --- 2) ESummary: PMIDs → metadata ----------------------------------------
    const summaries = await this.#getSummaries(idList);
    if (!summaries.ok) return summaries;

    const items = idList
      .map((pmid) => this.#toSourceItem(pmid, summaries.value.get(pmid)))
      .filter((item): item is SourceItem => item !== null);

    // Advance only when a full page came back AND the offset stays below the total.
    const nextStart = retStart + idList.length;
    const nextCursor =
      idList.length >= rows && (totalCount === null || nextStart < totalCount)
        ? String(nextStart)
        : null;

    const page: DiscoveryPage = {
      source: this.key,
      items,
      nextCursor,
      discoveredAt: this.#clock(),
    };
    return { ok: true, value: page };
  }

  async fetch(ref: SourceItemRef): Promise<DiscoveryResult<FetchResult>> {
    const pmid = sanitizeText(ref.sourceId, DISCOVERY_LIMITS.identifier);
    if (pmid === null || !PMID_RE.test(pmid)) {
      return this.#fail("INVALID_IDENTIFIER", "fetch requires a numeric PubMed PMID");
    }

    const summaries = await this.#getSummaries([pmid]);
    if (!summaries.ok) return summaries;

    const raw = summaries.value.get(pmid);
    if (raw === undefined) {
      return this.#fail("SOURCE_UNAVAILABLE", `PubMed has no record for PMID '${pmid}'`);
    }
    const item = this.#toSourceItem(pmid, raw);
    if (item === null) {
      return this.#fail("INSUFFICIENT_METADATA", `PubMed record '${pmid}' has no usable metadata`);
    }
    const result: FetchResult = {
      sourceKey: this.key,
      sourceId: item.sourceId,
      item,
      fetchedAt: this.#clock(),
      rawHash: hashRawPayload(raw),
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
   * Run an ESummary call for a set of PMIDs and return a map of PMID → summary
   * object. The E-utilities `esummary.fcgi?retmode=json` returns
   * `{ result: { uids: [...], "<uid>": {...} } }`.
   */
  async #getSummaries(
    pmids: readonly string[],
  ): Promise<DiscoveryResult<Map<string, Record<string, unknown>>>> {
    const params = new URLSearchParams();
    params.set("db", PUBMED_DB);
    params.set("id", pmids.join(","));
    params.set("retmode", "json");
    params.set("version", "2.0");
    const url = `${PUBMED_ORIGIN}${PUBMED_ESUMMARY_PATH}?${params.toString()}`;

    const fetched = await this.#getJson(url);
    if (!fetched.ok) return fetched;

    const envelope = getObject(fetched.value);
    const resultObj = envelope !== null ? getObject(getProp(envelope, "result")) : null;
    if (resultObj === null) {
      return this.#fail("MALFORMED_RESPONSE", "PubMed ESummary response had no result object");
    }
    const map = new Map<string, Record<string, unknown>>();
    for (const pmid of pmids) {
      const rec = getObject(getProp(resultObj, pmid));
      // A per-record `error` string (e.g. "cannot get document summary") means the
      // summary is unusable — skip it rather than surface a broken item.
      if (rec === null) continue;
      if (typeof getProp(rec, "error") === "string") continue;
      map.set(pmid, rec);
    }
    return { ok: true, value: map };
  }

  /**
   * GET a PubMed URL and return parsed JSON, or a typed failure. Enforces the host
   * policy, timeout, redirect rejection, size cap, and content-type check. Never
   * throws for expected failures; never leaks secrets.
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
      return aborted
        ? this.#fail("TIMEOUT", "PubMed request timed out")
        : this.#fail("SOURCE_UNAVAILABLE", "PubMed request failed at the transport layer");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const retryAfter = sanitizeText(response.headers.get("retry-after"), 32);
      const detail =
        retryAfter !== null
          ? `HTTP ${response.status}; retry-after ${retryAfter}`
          : `HTTP ${response.status}`;
      return this.#fail(statusToCode(response.status), "PubMed returned an error status", detail);
    }
    if (!isJsonContentType(response.headers)) {
      return this.#fail("MALFORMED_RESPONSE", "PubMed response was not JSON");
    }

    let bodyText: string;
    try {
      bodyText = await readBoundedText(response, this.#maxBytes);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        return this.#fail("MALFORMED_RESPONSE", "PubMed response exceeded the size limit");
      }
      return this.#fail("SOURCE_UNAVAILABLE", "failed reading the PubMed response body");
    }

    try {
      return { ok: true, value: JSON.parse(bodyText) };
    } catch {
      return this.#fail("MALFORMED_RESPONSE", "PubMed response was not valid JSON");
    }
  }

  // --- parsing (PubMed-specific; kept inside this connector) -----------------

  /**
   * Map one ESummary record to a sanitized `SourceItem`. `pmid` is the id from the
   * ESearch idlist (authoritative), so it holds even when a record's own `uid`
   * field is malformed. Returns null only when the record is not an object.
   */
  #toSourceItem(pmid: string, raw: Record<string, unknown> | undefined): SourceItem | null {
    if (raw === undefined) return null;

    const articleIds = extractArticleIds(raw);
    const doiRaw = articleIds.doi ?? extractElocationDoi(raw);
    const pmcid = articleIds.pmcid;

    const identifiers: SourceIdentifier[] = [{ type: "PMID", value: pmid }];
    if (doiRaw !== null) identifiers.push({ type: "DOI", value: doiRaw });
    if (pmcid !== null) identifiers.push({ type: "PMCID", value: pmcid });

    return {
      sourceKey: this.key,
      // Stable id: PubMed's PMID (its persistent identifier). A record with no DOI
      // is STILL discoverable because the PMID is always present here.
      sourceId: pmid,
      sourceUrl: deriveUrl(pmid, doiRaw),
      doi: doiRaw,
      identifiers,
      title: sanitizeText(getProp(raw, "title"), DISCOVERY_LIMITS.title),
      authors: extractAuthors(raw),
      journal: extractJournal(raw),
      publicationDate: extractDate(raw),
      // JSON-only scope: ESummary carries no abstract, and no XML is parsed.
      abstract: null,
      raw: pickRaw(raw, pmid, pmcid),
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

/** Collect valid, de-duplicated PMIDs from the request identifiers. */
function collectPmids(identifiers: DiscoveryRequest["identifiers"]): string[] {
  if (identifiers === undefined) return [];
  const out: string[] = [];
  for (const id of identifiers) {
    if (id.type !== "PMID") continue;
    const value = sanitizeText(id.value, DISCOVERY_LIMITS.identifier);
    if (value !== null && PMID_RE.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Collect canonical, de-duplicated DOIs from the request identifiers. */
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

/** Keep only well-formed PMIDs from an untrusted idlist, preserving order, de-duped. */
function uniquePmids(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const entry of list) {
    const value = sanitizeText(entry, DISCOVERY_LIMITS.identifier);
    if (value !== null && PMID_RE.test(value) && !out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Build a PubMed ESearch `term` from a free-text query, PMIDs, DOIs, and an
 * optional `since` lower bound. Every user-supplied value is neutralised so it
 * cannot inject PubMed field tags or boolean operators. At least one of
 * query/pmids/dois is guaranteed by the caller.
 */
function buildTerm(
  query: string | null,
  pmids: readonly string[],
  dois: readonly string[],
  since: string | null,
): string {
  const clauses: string[] = [];
  if (query !== null) clauses.push(`(${escapeQueryValue(query)})`);
  if (pmids.length > 0) {
    // PMIDs are already digit-validated; tag them with [UID].
    clauses.push(`(${pmids.map((pmid) => `${pmid}[UID]`).join(" OR ")})`);
  }
  if (dois.length > 0) {
    // [AID] (Article Identifier) is the field DOIs live in for PubMed.
    clauses.push(`(${dois.map((doi) => `"${escapeQuotes(doi)}"[AID]`).join(" OR ")})`);
  }
  // A validated `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` lower bound on publication date.
  if (since !== null && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(since)) {
    const from = since.replace(/-/g, "/");
    clauses.push(`("${from}"[Date - Publication] : "3000"[Date - Publication])`);
  }
  return clauses.join(" AND ");
}

/**
 * Escape a free-text query value: strip the PubMed syntax characters and boolean
 * operators that would let untrusted text alter the query structure, and cap
 * length. Deliberately conservative — a discovery query is never a place for
 * operators or field tags supplied by an untrusted source item.
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

/** Parse an opaque cursor into a non-negative retstart offset (0 when absent/invalid). */
function parseCursor(cursor: DiscoveryRequest["cursor"]): number {
  if (typeof cursor !== "string" || cursor.length === 0) return 0;
  const n = Number.parseInt(cursor, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Parse the ESearch `count` (a string) into a non-negative number, or null. */
function parseCount(value: unknown): number | null {
  const text = sanitizeText(value, 20);
  if (text === null || !/^\d+$/.test(text)) return null;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Map an HTTP error status onto the closest typed discovery error code. */
function statusToCode(status: number): DiscoveryErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 408) return "TIMEOUT";
  return "SOURCE_UNAVAILABLE";
}

/**
 * Derive a display/provenance URL. Prefers the DOI resolver, then the canonical
 * PubMed article page. Provenance value only, NEVER a fetch target.
 */
function deriveUrl(pmid: string, doiRaw: string | null): string | null {
  const canonical = doiRaw !== null ? toCanonicalDoi(doiRaw) : null;
  if (canonical !== null) return sanitizeHttpUrl(`https://doi.org/${canonical}`);
  return sanitizeHttpUrl(`https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`);
}

interface ExtractedArticleIds {
  readonly doi: string | null;
  readonly pmcid: string | null;
}

/**
 * Extract DOI and PMCID from ESummary's `articleids: [{ idtype, value }]`. The
 * DOI is kept raw (canonicalisation happens in the shared normalizer); the PMCID
 * is normalised to a `PMC…`-prefixed value.
 */
function extractArticleIds(rec: Record<string, unknown>): ExtractedArticleIds {
  const list = getProp(rec, "articleids");
  let doi: string | null = null;
  let pmcid: string | null = null;
  if (Array.isArray(list)) {
    for (const entry of list) {
      const idType = sanitizeText(getProp(entry, "idtype"), DISCOVERY_LIMITS.identifier);
      const value = sanitizeText(getProp(entry, "value"), DISCOVERY_LIMITS.identifier);
      if (idType === null || value === null) continue;
      const kind = idType.toLowerCase();
      if (kind === "doi" && doi === null) doi = value;
      else if ((kind === "pmc" || kind === "pmcid") && pmcid === null) {
        pmcid = /^pmc/i.test(value) ? value.toUpperCase() : `PMC${value}`;
      }
    }
  }
  return { doi, pmcid };
}

/** Fallback DOI extraction from `elocationid` (e.g. "doi: 10.1234/abc"). */
function extractElocationDoi(rec: Record<string, unknown>): string | null {
  const eloc = sanitizeText(getProp(rec, "elocationid"), DISCOVERY_LIMITS.identifier);
  if (eloc === null) return null;
  const match = eloc.match(/10\.\d{4,9}\/\S+/);
  return match ? match[0] : null;
}

/**
 * Build ordered, sanitized author display names from ESummary's
 * `authors: [{ name, authtype }]`. Non-object entries and empty names are dropped.
 */
function extractAuthors(rec: Record<string, unknown>): string[] {
  const list = getProp(rec, "authors");
  if (!Array.isArray(list)) return [];
  const authors: string[] = [];
  for (const entry of list.slice(0, DISCOVERY_LIMITS.maxAuthors)) {
    const name = sanitizeText(getProp(entry, "name"), DISCOVERY_LIMITS.authorName);
    if (name !== null) authors.push(name);
  }
  return authors;
}

/** Extract the journal / container title — prefers `fulljournalname`, then `source`. */
function extractJournal(rec: Record<string, unknown>): string | null {
  const full = sanitizeText(getProp(rec, "fulljournalname"), DISCOVERY_LIMITS.journal);
  if (full !== null) return full;
  return sanitizeText(getProp(rec, "source"), DISCOVERY_LIMITS.journal);
}

/**
 * Extract a publication date. Prefers `sortpubdate` (`YYYY/MM/DD hh:mm`), then
 * `epubdate` / `pubdate` (`YYYY Mon DD` or `YYYY`). Only a well-formed value is
 * returned; a zeroed month/day collapses to the year.
 */
function extractDate(rec: Record<string, unknown>): string | null {
  const sort = sanitizeText(getProp(rec, "sortpubdate"), DISCOVERY_LIMITS.identifier);
  if (sort !== null) {
    const m = sort.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
    if (m) {
      const [, y, mo, d] = m;
      if (mo === "00" || d === "00") return y ?? null;
      return `${y}-${mo}-${d}`;
    }
    const y = sort.match(/^(\d{4})/);
    if (y) return y[1] ?? null;
  }
  for (const key of ["epubdate", "pubdate"]) {
    const value = sanitizeText(getProp(rec, key), DISCOVERY_LIMITS.identifier);
    if (value === null) continue;
    const y = value.match(/^(\d{4})/);
    if (y) return y[1] ?? null;
  }
  return null;
}

/** Retain only source-specific fields useful for provenance/debugging. */
function pickRaw(
  rec: Record<string, unknown>,
  pmid: string,
  pmcid: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { pmid };
  if (pmcid !== null) out.pmcid = pmcid;
  const pubType = extractPubType(rec);
  if (pubType !== null) out.pubmedPubType = pubType;
  const sortDate = sanitizeText(getProp(rec, "sortpubdate"), DISCOVERY_LIMITS.identifier);
  if (sortDate !== null) out.pubmedSortDate = sortDate;
  return out;
}

/** ESummary `pubtype` is an array of strings; join the sanitized ones. */
function extractPubType(rec: Record<string, unknown>): string | null {
  const list = getProp(rec, "pubtype");
  if (!Array.isArray(list)) return null;
  const types = list
    .map((t) => sanitizeText(t, DISCOVERY_LIMITS.identifier))
    .filter((t): t is string => t !== null);
  return types.length > 0 ? types.join(", ").slice(0, DISCOVERY_LIMITS.journal) : null;
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
