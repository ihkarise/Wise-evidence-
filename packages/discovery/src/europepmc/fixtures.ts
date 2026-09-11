/**
 * Deterministic, sanitized Europe PMC fixtures and an injectable fake fetch
 * (M7.6; docs/20, docs/30). Everything here is static, offline data plus a
 * `FetchLike` built from a routing table — CI never contacts Europe PMC.
 *
 * The fixtures use the reserved, non-existent `10.0000/…` DOI registrant so no
 * DOI can collide with a real one (docs/25 §9), and fictional Europe PMC record
 * ids. They deliberately span the shapes a connector must survive: a full MEDLINE
 * article, a preprint without a DOI, a sparse record, a record with a malformed
 * title but a usable DOI, a duplicate by DOI, present/absent abstract, structured
 * vs. string author lists, and unexpected extra fields.
 */
import type { FetchLike, FetchLikeResponse } from "../http.js";

/** A minimal Europe PMC `result` object (only the fields the connector reads). */
export type EuropePMCResult = Record<string, unknown>;

/** A well-formed MEDLINE article with everything present. */
export const RESULT_FULL: EuropePMCResult = {
  id: "36000001",
  source: "MED",
  pmid: "36000001",
  pmcid: "PMC9000001",
  doi: "10.0000/wise.epmc.alpha",
  title: "An individualized intervention: a randomized placebo-controlled trial",
  authorString: "Smith JQ, Müller RA.",
  authorList: {
    author: [
      { fullName: "Smith JQ", firstName: "Jane Q", lastName: "Smith" },
      { fullName: "Müller RA", firstName: "Robert A", lastName: "Müller" },
    ],
  },
  journalInfo: { journal: { title: "Journal of Example Research" }, yearOfPublication: 2021 },
  pubYear: "2021",
  firstPublicationDate: "2021-03-01",
  abstractText: "<jats:p>A fictional randomized controlled trial used for offline tests.</jats:p>",
  pubType: "research-article",
  isOpenAccess: "Y",
  citedByCount: 7, // unexpected/extra field — must be ignored safely
};

/** A preprint with NO DOI — discoverable via its title, canonical DOI null. */
export const RESULT_NO_DOI: EuropePMCResult = {
  id: "PPR700000",
  source: "PPR",
  title: "A preprint with no DOI on record",
  authorString: "Researcher A.",
  pubYear: "2019",
  firstPublicationDate: "2019-06-15",
};

/** Missing author and journal; abstract absent; year-only date. */
export const RESULT_SPARSE: EuropePMCResult = {
  id: "36000002",
  source: "MED",
  doi: "10.0000/wise.epmc.sparse",
  title: "A sparse record with only a title and year",
  pubYear: "2020",
};

/** Malformed title (non-string) and unusual DOI casing — survives via the DOI. */
export const RESULT_MALFORMED_TITLE: EuropePMCResult = {
  id: "36000003",
  source: "MED",
  doi: "10.0000/WISE.EPMC.CASING",
  title: { unexpected: "object instead of string" },
  authorString: "Solo Literalname.",
  pubYear: "2018",
};

/** A duplicate of RESULT_FULL by DOI — surfaced, never deleted (DUPLICATE ≠ DELETE). */
export const RESULT_DUPLICATE: EuropePMCResult = {
  id: "PMC9000099",
  source: "PMC",
  pmcid: "PMC9000099",
  doi: "10.0000/wise.epmc.alpha",
  title: "An individualized intervention (PMC copy)",
  authorString: "Smith JQ.",
  journalInfo: { journal: { title: "PMC Mirror of Example Research" } },
  pubYear: "2021",
  firstPublicationDate: "2021-05-01",
};

/** Build a Europe PMC `/search` list response body (the top-level envelope). */
export function searchListBody(
  results: readonly EuropePMCResult[],
  nextCursorMark: string,
): string {
  return JSON.stringify({
    version: "6.9",
    hitCount: results.length,
    nextCursorMark,
    request: { queryString: "test", resultType: "core", cursorMark: "*", pageSize: results.length },
    resultList: { result: results },
  });
}

/** The default two-page discovery dataset (page 1 → cursor → page 2 → end). */
export const EPMC_PAGE_1: readonly EuropePMCResult[] = [RESULT_FULL, RESULT_NO_DOI, RESULT_SPARSE];
export const EPMC_PAGE_2: readonly EuropePMCResult[] = [RESULT_MALFORMED_TITLE, RESULT_DUPLICATE];

// --- fake fetch --------------------------------------------------------------

/** What a fake route returns (or how it fails), for deterministic tests. */
export interface FakeResponseSpec {
  readonly status?: number; // default 200
  readonly bodyText?: string; // response text (default "{}")
  readonly contentType?: string | null; // default "application/json"
  readonly headers?: Record<string, string>; // extra response headers (e.g. retry-after)
  /** Provide a streamed body of this many bytes instead of bodyText (size-cap tests). */
  readonly streamBytes?: number;
  /** Make the fetch itself reject, simulating timeout / connection / blocked redirect. */
  readonly throwKind?: "abort" | "network" | "redirect";
}

/** A record of the request an injected fetch received (for assertions). */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Record<string, string> | undefined;
  readonly redirect: string | undefined;
}

export interface FakeFetch {
  readonly fetch: FetchLike;
  readonly requests: RecordedRequest[];
}

/**
 * Build an injectable `FetchLike` from a handler that maps a request URL to a
 * `FakeResponseSpec`. Records every request so tests can assert on the method,
 * headers (User-Agent), and redirect policy actually used.
 */
export function makeFakeFetch(handler: (url: string) => FakeResponseSpec): FakeFetch {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = (url, init) => {
    requests.push({
      url,
      method: init?.method,
      headers: init?.headers,
      redirect: init?.redirect,
    });
    const spec = handler(url);
    if (spec.throwKind !== undefined) {
      const err = new Error(spec.throwKind === "abort" ? "aborted" : "network failure");
      if (spec.throwKind === "abort") err.name = "AbortError";
      if (spec.throwKind === "redirect") err.name = "TypeError"; // redirect:"error" throws TypeError
      return Promise.reject(err);
    }
    return Promise.resolve(makeResponse(spec));
  };
  return { fetch, requests };
}

/**
 * Convenience: a fake fetch serving a fixed set of search pages, keyed by the
 * `cursorMark`. Europe PMC repeats the final page's cursorMark, which the routing
 * here reproduces (page N's next mark is `cN+1`, the last page returns its own).
 */
export function makeEuropePMCFixtureFetch(options: {
  readonly pages?: readonly (readonly EuropePMCResult[])[];
}): FakeFetch {
  const pages = options.pages ?? [];
  return makeFakeFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/europepmc/webservices/rest/search") {
      const cursor = parsed.searchParams.get("cursorMark") ?? "*";
      const index = cursor === "*" ? 0 : Number(cursor.replace(/^c/, ""));
      const page = pages[index];
      if (page === undefined) return { bodyText: searchListBody([], cursor) };
      const isLast = index + 1 >= pages.length;
      // Last page echoes the cursor it was given (Europe PMC's end-of-results signal).
      const next = isLast ? cursor : `c${index + 1}`;
      return { bodyText: searchListBody(page, next) };
    }
    return { status: 404, bodyText: "{}" };
  });
}

function makeResponse(spec: FakeResponseSpec): FetchLikeResponse {
  const status = spec.status ?? 200;
  const contentType = spec.contentType === undefined ? "application/json" : spec.contentType;
  const headerMap = new Map<string, string>();
  if (contentType !== null) headerMap.set("content-type", contentType);
  for (const [k, v] of Object.entries(spec.headers ?? {})) headerMap.set(k.toLowerCase(), v);

  const headers = { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null };
  const bodyText = spec.bodyText ?? "{}";

  let body: ReadableStream<Uint8Array> | null | undefined;
  if (spec.streamBytes !== undefined) {
    const chunk = new Uint8Array(spec.streamBytes).fill(120); // 'x'
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body,
    text: () => Promise.resolve(bodyText),
  };
}
