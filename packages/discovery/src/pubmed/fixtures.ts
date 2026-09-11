/**
 * Deterministic, sanitized PubMed (NCBI E-utilities) fixtures and an injectable
 * fake fetch (M7.7; docs/20, docs/30). Everything here is static, offline data
 * plus a `FetchLike` built from a routing table over the ESearch and ESummary
 * endpoints — CI never contacts NCBI.
 *
 * The fixtures use the reserved, non-existent `10.0000/…` DOI registrant so no
 * DOI can collide with a real one (docs/25 §9), and fictional PMIDs. They span
 * the shapes a connector must survive: a full record with all cross-links, a
 * record with NO DOI (still discoverable by PMID), a sparse record, a record with
 * a malformed title but a usable DOI, a DOI-duplicate with its own PMID, a record
 * whose DOI is only in `elocationid`, and a per-record `error` summary.
 */
import type { FetchLike, FetchLikeResponse } from "../http.js";

/** A minimal ESummary record object (only the fields the connector reads). */
export type PubMedSummary = Record<string, unknown>;

/** A well-formed record with everything present and all cross-links. */
export const SUMMARY_FULL: PubMedSummary = {
  uid: "36000001",
  title: "An individualized intervention: a randomized placebo-controlled trial",
  sortpubdate: "2021/03/01 00:00",
  epubdate: "2021 Feb 15",
  pubdate: "2021 Mar",
  source: "J Example Res",
  fulljournalname: "Journal of Example Research",
  authors: [
    { name: "Smith JQ", authtype: "Author" },
    { name: "Müller RA", authtype: "Author" },
  ],
  articleids: [
    { idtype: "pubmed", value: "36000001" },
    { idtype: "doi", value: "10.0000/wise.pubmed.alpha" },
    { idtype: "pmc", value: "PMC9000001" },
  ],
  pubtype: ["Journal Article", "Randomized Controlled Trial"],
  elocationid: "doi: 10.0000/wise.pubmed.alpha",
  fake_extra: "ignored", // unexpected/extra field — must be dropped safely
};

/** A record with NO DOI — discoverable via its PMID, canonical DOI null. */
export const SUMMARY_NO_DOI: PubMedSummary = {
  uid: "37000002",
  title: "A PubMed record with no DOI on file",
  sortpubdate: "2019/06/15 00:00",
  source: "Prepr Arch",
  fulljournalname: "Preprint Archive",
  authors: [{ name: "Researcher A", authtype: "Author" }],
  articleids: [{ idtype: "pubmed", value: "37000002" }],
  pubtype: ["Preprint"],
};

/** Missing authors and journal; year-only sort date; DOI present. */
export const SUMMARY_SPARSE: PubMedSummary = {
  uid: "37000003",
  title: "A sparse record with only a title and year",
  sortpubdate: "2020/00/00 00:00",
  articleids: [
    { idtype: "pubmed", value: "37000003" },
    { idtype: "doi", value: "10.0000/wise.pubmed.sparse" },
  ],
};

/** Malformed title (non-string) and unusual DOI casing — survives via the DOI. */
export const SUMMARY_MALFORMED_TITLE: PubMedSummary = {
  uid: "37000004",
  title: { unexpected: "object instead of string" },
  sortpubdate: "2018/09/01 00:00",
  authors: "not-an-array", // hostile shape — must be ignored, not crash
  articleids: [
    { idtype: "pubmed", value: "37000004" },
    { idtype: "doi", value: "10.0000/WISE.PUBMED.CASING" },
  ],
};

/** A DOI-duplicate of SUMMARY_FULL — its OWN PMID, surfaced, never deleted. */
export const SUMMARY_DUPLICATE: PubMedSummary = {
  uid: "37000005",
  title: "An individualized intervention (duplicate record)",
  sortpubdate: "2021/05/01 00:00",
  source: "J Example Res",
  fulljournalname: "Mirror of Example Research",
  authors: [{ name: "Smith JQ", authtype: "Author" }],
  articleids: [
    { idtype: "pubmed", value: "37000005" },
    { idtype: "doi", value: "10.0000/wise.pubmed.alpha" },
  ],
};

/** DOI only in `elocationid` (no doi articleid) — the fallback path. */
export const SUMMARY_ELOCATION_DOI: PubMedSummary = {
  uid: "37000006",
  title: "A record whose DOI lives only in elocationid",
  sortpubdate: "2022/01/10 00:00",
  source: "J Example Res",
  authors: [{ name: "Author B", authtype: "Author" }],
  articleids: [{ idtype: "pubmed", value: "37000006" }],
  elocationid: "doi: 10.0000/wise.pubmed.eloc",
};

/** A summary that reports a per-record error — must be skipped, never surfaced. */
export const SUMMARY_WITH_ERROR: PubMedSummary = {
  uid: "37000099",
  error: "cannot get document summary",
};

/** Hostile metadata: markup/operators in every free-text field. Kept as text. */
export const SUMMARY_HOSTILE: PubMedSummary = {
  uid: "37000100",
  title: "<script>alert(1)</script> Homeopathy AND cancer[Title]",
  sortpubdate: "2020/02/02 00:00",
  source: "<b>Injected</b> Journal OR evil[Journal]",
  fulljournalname: "<b>Injected</b> Journal OR evil[Journal]",
  authors: [{ name: 'Evil "); DROP TABLE authors;--', authtype: "Author" }],
  articleids: [
    { idtype: "pubmed", value: "37000100" },
    { idtype: "doi", value: "10.0000/wise.pubmed.hostile" },
  ],
};

/** The default two-page discovery dataset (page 1 → cursor → page 2 → end). */
export const PUBMED_PAGE_1: readonly PubMedSummary[] = [
  SUMMARY_FULL,
  SUMMARY_NO_DOI,
  SUMMARY_SPARSE,
];
export const PUBMED_PAGE_2: readonly PubMedSummary[] = [SUMMARY_MALFORMED_TITLE, SUMMARY_DUPLICATE];

/** The uid string of a summary fixture. */
function uidOf(rec: PubMedSummary): string {
  return String((rec as { uid?: unknown }).uid ?? "");
}

/** Build an ESearch JSON response body for an idlist slice. */
export function esearchBody(idlist: readonly string[], count: number, retstart: number): string {
  return JSON.stringify({
    header: { type: "esearch", version: "0.3" },
    esearchresult: {
      count: String(count),
      retmax: String(idlist.length),
      retstart: String(retstart),
      idlist,
    },
  });
}

/** Build an ESummary JSON response body for a set of summary records. */
export function esummaryBody(records: readonly PubMedSummary[]): string {
  const result: Record<string, unknown> = { uids: records.map(uidOf) };
  for (const rec of records) result[uidOf(rec)] = rec;
  return JSON.stringify({ header: { type: "esummary", version: "0.3" }, result });
}

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
    requests.push({ url, method: init?.method, headers: init?.headers, redirect: init?.redirect });
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
 * A fake fetch serving a fixed set of PubMed search pages, keyed by the ESearch
 * `retstart` offset. ESearch returns the PMID slice for the page; ESummary
 * returns the summaries for whatever `id` csv it is asked for (across all pages).
 */
export function makePubMedFixtureFetch(options: {
  readonly pages?: readonly (readonly PubMedSummary[])[];
}): FakeFetch {
  const pages = options.pages ?? [];
  const flat = pages.flat();
  const total = flat.length;
  const byId = new Map(flat.map((rec) => [uidOf(rec), rec] as const));

  return makeFakeFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/entrez/eutils/esearch.fcgi") {
      const retstart = Number(parsed.searchParams.get("retstart") ?? "0");
      const retmax = Number(parsed.searchParams.get("retmax") ?? "20");
      const ids = flat.slice(retstart, retstart + retmax).map(uidOf);
      return { bodyText: esearchBody(ids, total, retstart) };
    }
    if (parsed.pathname === "/entrez/eutils/esummary.fcgi") {
      const idCsv = parsed.searchParams.get("id") ?? "";
      const records = idCsv
        .split(",")
        .map((id) => byId.get(id))
        .filter((rec): rec is PubMedSummary => rec !== undefined);
      return { bodyText: esummaryBody(records) };
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
