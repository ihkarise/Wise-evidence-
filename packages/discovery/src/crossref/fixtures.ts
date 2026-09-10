/**
 * Deterministic, sanitized Crossref fixtures and an injectable fake fetch
 * (M7.2; docs/20, docs/30). Everything here is static, offline data plus a
 * `FetchLike` built from a routing table — CI never contacts Crossref.
 *
 * The fixtures use the reserved, non-existent `10.0000/…` registrant so no DOI
 * can collide with a real one (docs/25 §9). They deliberately span the shapes a
 * connector must survive: a full article, an item without a DOI, missing
 * author/journal/date, present/absent abstract, a malformed title, a duplicate
 * DOI, unusual DOI casing, and unexpected extra fields.
 */
import type { FetchLike, FetchLikeResponse } from "../http.js";

/** A minimal Crossref `work` object (only the fields the connector reads). */
export type CrossrefWork = Record<string, unknown>;

/** A well-formed article with everything present. */
export const WORK_FULL: CrossrefWork = {
  DOI: "10.0000/wise.crossref.alpha",
  type: "journal-article",
  title: ["An individualized intervention: a randomized placebo-controlled trial"],
  author: [
    { given: "Jane Q.", family: "Smith" },
    { given: "Robert A.", family: "Müller" },
  ],
  "container-title": ["Journal of Example Research"],
  issued: { "date-parts": [[2021, 3, 1]] },
  URL: "https://doi.org/10.0000/wise.crossref.alpha",
  abstract: "<jats:p>A fictional randomized controlled trial used for offline tests.</jats:p>",
  member: "297",
  score: 21.5,
  "reference-count": 42, // unexpected/extra field — must be ignored safely
};

/** An item with NO DOI — discoverable via its title, canonical DOI null. */
export const WORK_NO_DOI: CrossrefWork = {
  type: "posted-content",
  title: ["A preprint with no DOI on record"],
  author: [{ given: "A.", family: "Researcher" }],
  "container-title": ["Example Preprint Server"],
  issued: { "date-parts": [[2019]] },
};

/** Missing author and journal; abstract absent; year-only date. */
export const WORK_SPARSE: CrossrefWork = {
  DOI: "10.0000/wise.crossref.sparse",
  type: "journal-article",
  title: ["A sparse record with only a title and year"],
  issued: { "date-parts": [[2020]] },
};

/** Malformed title (non-string inside the array) and unusual DOI casing. */
export const WORK_MALFORMED_TITLE: CrossrefWork = {
  DOI: "10.0000/WISE.CrossRef.CASING",
  type: "journal-article",
  title: [{ unexpected: "object instead of string" }],
  author: [{ name: "Solo Literalname" }],
  issued: { "date-parts": [["2018", "07"]] },
  URL: "https://doi.org/10.0000/wise.crossref.casing",
};

/** A duplicate of WORK_FULL by DOI — surfaced, never deleted (DUPLICATE ≠ DELETE). */
export const WORK_DUPLICATE: CrossrefWork = {
  DOI: "10.0000/wise.crossref.alpha",
  type: "journal-article",
  title: ["An individualized intervention (reprint)"],
  author: [{ given: "Jane Q.", family: "Smith" }],
  "container-title": ["Reprints of Example Research"],
  issued: { "date-parts": [[2021, 5, 1]] },
  URL: "https://example.org/reprint/alpha",
};

/** Build a Crossref `/works` list response body (the top-level envelope). */
export function worksListBody(items: readonly CrossrefWork[], nextCursor: string | null): string {
  return JSON.stringify({
    status: "ok",
    "message-type": "work-list",
    message: {
      "total-results": items.length,
      "next-cursor": nextCursor,
      items,
    },
  });
}

/** Build a Crossref `/works/{doi}` single-item response body. */
export function workItemBody(work: CrossrefWork): string {
  return JSON.stringify({ status: "ok", "message-type": "work", message: work });
}

/** The default two-page discovery dataset (page 1 → cursor → page 2 → end). */
export const CROSSREF_PAGE_1: readonly CrossrefWork[] = [WORK_FULL, WORK_NO_DOI, WORK_SPARSE];
export const CROSSREF_PAGE_2: readonly CrossrefWork[] = [WORK_MALFORMED_TITLE, WORK_DUPLICATE];

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

/** Convenience: a fake fetch serving a fixed set of query pages and per-DOI items. */
export function makeCrossrefFixtureFetch(options: {
  readonly pages?: readonly {
    readonly items: readonly CrossrefWork[];
    readonly nextCursor: string | null;
  }[];
  readonly byDoi?: Readonly<Record<string, CrossrefWork>>;
}): FakeFetch {
  const pages = options.pages ?? [];
  return makeFakeFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/works") {
      const cursor = parsed.searchParams.get("cursor") ?? "*";
      // "*" is the first page; subsequent cursors are "p1", "p2", ...
      const index = cursor === "*" ? 0 : Number(cursor.replace(/^p/, ""));
      const page = pages[index];
      if (page === undefined) return { bodyText: worksListBody([], null) };
      const next = index + 1 < pages.length ? `p${index + 1}` : page.nextCursor;
      return { bodyText: worksListBody(page.items, next) };
    }
    if (parsed.pathname.startsWith("/works/")) {
      const doi = decodeURIComponent(parsed.pathname.slice("/works/".length));
      const work = options.byDoi?.[doi];
      if (work === undefined) return { status: 404, bodyText: "{}" };
      return { bodyText: workItemBody(work) };
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
