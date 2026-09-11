/**
 * PubMed connector — contract, parsing, pagination, and provenance tests (M7.7).
 * All offline via an injected fake fetch; no network, no secrets. Covers the
 * two-call ESearch → ESummary flow, DOI present/missing/casing, PMID/PMCID
 * handling, the elocationid DOI fallback, and the DUPLICATE ≠ DELETE boundary.
 */
import { describe, it, expect } from "vitest";
import { PubMedDiscoveryProvider, PUBMED_DISCOVERY_VERSION } from "./provider.js";
import {
  PUBMED_PAGE_1,
  PUBMED_PAGE_2,
  SUMMARY_ELOCATION_DOI,
  SUMMARY_WITH_ERROR,
  makePubMedFixtureFetch,
  makeFakeFetch,
  esearchBody,
  esummaryBody,
} from "./fixtures.js";
import type { DiscoveryPage } from "../types.js";

const CLOCK = () => "2026-02-02T00:00:00.000Z";

function fixtureProvider(contactEmail?: string) {
  const { fetch, requests } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1, PUBMED_PAGE_2] });
  const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK, contactEmail });
  return { provider, requests };
}

describe("PubMedDiscoveryProvider — discovery & parsing", () => {
  it("runs ESearch then ESummary and maps a full record to a neutral SourceItem", async () => {
    const { provider, requests } = fixtureProvider();
    const result = await provider.discover({ query: "homeopathy", pageSize: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("pubmed");
    expect(result.value.discoveredAt).toBe(CLOCK());
    // Two HTTP calls per page: ESearch first, then ESummary.
    expect(requests[0]?.url).toContain("/entrez/eutils/esearch.fcgi");
    expect(requests[1]?.url).toContain("/entrez/eutils/esummary.fcgi");

    const alpha = result.value.items.find((i) => i.sourceId === "36000001");
    expect(alpha).toBeDefined();
    expect(alpha?.title).toContain("individualized intervention");
    expect(alpha?.authors).toEqual(["Smith JQ", "Müller RA"]);
    expect(alpha?.journal).toBe("Journal of Example Research");
    expect(alpha?.publicationDate).toBe("2021-03-01");
    expect(alpha?.doi).toBe("10.0000/wise.pubmed.alpha");
    // PMID is the stable id; carries all three identifier kinds.
    expect(alpha?.identifiers.map((id) => id.type).sort()).toEqual(["DOI", "PMCID", "PMID"]);
    expect(alpha?.identifiers.find((id) => id.type === "PMCID")?.value).toBe("PMC9000001");
    // JSON-only scope: no abstract is ever produced.
    expect(alpha?.abstract).toBeNull();
  });

  it("keeps a record with NO DOI discoverable via its PMID", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "x", pageSize: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const noDoi = result.value.items.find((i) => i.sourceId === "37000002");
    expect(noDoi).toBeDefined();
    expect(noDoi?.doi).toBeNull();
    expect(noDoi?.identifiers.map((id) => id.type)).toEqual(["PMID"]);
    const normalized = provider.normalize(noDoi!);
    expect(normalized.ok).toBe(true); // usable via title, even without a DOI
    if (!normalized.ok) return;
    expect(normalized.value.canonicalDoi).toBeNull();
    expect(normalized.value.provenance.sourceId).toBe("37000002");
  });

  it("never exposes the raw ESummary record — only whitelisted provenance fields", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "x", pageSize: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alpha = result.value.items.find((i) => i.sourceId === "36000001");
    expect(Object.keys(alpha?.raw ?? {}).sort()).toEqual([
      "pmcid",
      "pmid",
      "pubmedPubType",
      "pubmedSortDate",
    ]);
    expect(alpha?.raw).not.toHaveProperty("fake_extra");
    expect(alpha?.raw).not.toHaveProperty("authors");
  });

  it("requires a query, PMID, or DOI (never an unbounded request)", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("sends a bounded, gated ESearch with a polite User-Agent and no redirects", async () => {
    const { provider, requests } = fixtureProvider("discovery@example.org");
    await provider.discover({ query: "homeopathy", pageSize: 5 });
    const req = requests[0];
    expect(req?.url).toContain("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?");
    expect(req?.url).toContain("db=pubmed");
    expect(req?.url).toContain("retmode=json");
    expect(req?.url).toContain("retmax=5");
    expect(req?.method).toBe("GET");
    expect(req?.redirect).toBe("error");
    expect(req?.headers?.["User-Agent"]).toContain("mailto:discovery@example.org");
    expect(req?.headers?.Accept).toBe("application/json");
  });

  it("omits mailto from the User-Agent and never puts the email in the URL", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: "x" });
    expect(requests[0]?.headers?.["User-Agent"]).not.toContain("mailto:");
    expect(requests[0]?.url).not.toContain("email=");
  });

  it("clamps page size to the descriptor's per-request cap", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: "x", pageSize: 100_000 });
    expect(requests[0]?.url).toContain("retmax=100"); // maxItemsPerRequest
  });

  it("paginates across pages via retstart and terminates on the short final page", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1, PUBMED_PAGE_2] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const pages: DiscoveryPage[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const result = await provider.discover({ query: "x", pageSize: 3, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      pages.push(result.value);
      cursor = result.value.nextCursor;
      if (cursor === null) break;
    }
    // Page 1 is full (3 of 5) → advances (retstart=3); page 2 is short (2) → terminates.
    expect(pages.length).toBe(2);
    expect(pages[0]?.nextCursor).toBe("3");
    expect(pages[1]?.nextCursor).toBeNull();
  });

  it("treats an empty ESearch idlist as a terminal, non-error page", async () => {
    const { fetch } = makeFakeFetch((url) =>
      url.includes("esearch")
        ? { bodyText: esearchBody([], 0, 0) }
        : { bodyText: esummaryBody([]) },
    );
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "nothing-matches" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
    expect(result.value.nextCursor).toBeNull();
  });

  it("surfaces a DOI-duplicate under its own PMID without deleting it (DUPLICATE ≠ DELETE)", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [[...PUBMED_PAGE_1, ...PUBMED_PAGE_2]] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alphaDois = result.value.items.filter((i) => i.doi === "10.0000/wise.pubmed.alpha");
    expect(alphaDois.length).toBe(2); // both surfaced, distinct PMIDs
    expect(alphaDois.map((i) => i.sourceId).sort()).toEqual(["36000001", "37000005"]);
  });

  it("canonicalises unusual DOI casing and survives a malformed title via the DOI", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_2] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const casing = result.value.items.find((i) => i.sourceId === "37000004");
    expect(casing).toBeDefined();
    expect(casing?.title).toBeNull(); // malformed title dropped
    expect(casing?.authors).toEqual([]); // hostile non-array authors ignored
    const normalized = provider.normalize(casing!);
    expect(normalized.ok).toBe(true); // still usable via canonical DOI
    if (!normalized.ok) return;
    expect(normalized.value.canonicalDoi).toBe("10.0000/wise.pubmed.casing");
  });

  it("extracts a DOI from elocationid when no doi articleid is present", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [[SUMMARY_ELOCATION_DOI]] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.doi).toBe("10.0000/wise.pubmed.eloc");
  });

  it("skips a summary that reports a per-record error", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [[SUMMARY_WITH_ERROR]] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
  });

  it("de-duplicates repeated PMIDs in the ESearch idlist", async () => {
    const { fetch } = makeFakeFetch((url) =>
      url.includes("esearch")
        ? { bodyText: esearchBody(["36000001", "36000001"], 1, 0) }
        : { bodyText: esummaryBody([PUBMED_PAGE_1[0]!]) },
    );
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(1);
  });

  it("supports discovery by PMID identifier and tags it as [UID]", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ identifiers: [{ type: "PMID", value: "36000001" }] });
    expect(decodeURIComponent(requests[0]?.url ?? "")).toContain("36000001[UID]");
  });

  it("supports discovery by DOI identifier as an [AID] clause", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ identifiers: [{ type: "DOI", value: "10.0000/wise.pubmed.alpha" }] });
    expect(decodeURIComponent(requests[0]?.url ?? "")).toContain(
      '"10.0000/wise.pubmed.alpha"[AID]',
    );
  });

  it("neutralises PubMed field tags and operators from untrusted free-text input", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: "homeopathy OR cancer[Title] AND (evil)" });
    const decoded = decodeURIComponent(requests[0]?.url ?? "");
    expect(decoded).not.toContain("[Title]");
    expect(decoded).not.toContain(" OR ");
    expect(decoded).not.toContain(" AND (");
  });
});

describe("PubMedDiscoveryProvider — fetch & provenance", () => {
  it("fetches a single record by PMID and records a raw-payload hash", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "pubmed", sourceId: "36000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceId).toBe("36000001");
    expect(result.value.fetchedAt).toBe(CLOCK());
    expect(result.value.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a fetch whose source id is not a numeric PMID", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "pubmed", sourceId: "not-a-pmid" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("maps an unknown PMID (empty summary) to SOURCE_UNAVAILABLE", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "pubmed", sourceId: "99999999" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("normalizes a fetched item with complete, traceable PubMed provenance", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1] });
    const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
    const fetched = await provider.fetch({ sourceKey: "pubmed", sourceId: "36000001" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const prov = normalized.value.provenance;
    expect(prov.sourceKey).toBe("pubmed");
    expect(prov.sourceId).toBe("36000001");
    expect(prov.doi).toBe("10.0000/wise.pubmed.alpha");
    expect(prov.providerVersion).toBe(PUBMED_DISCOVERY_VERSION);
    expect(prov.discoveredAt).toBe(CLOCK());
    expect(prov.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: the same fixtures produce identical items across runs", async () => {
    const run = async () => {
      const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1, PUBMED_PAGE_2] });
      const provider = new PubMedDiscoveryProvider({ fetch, clock: CLOCK });
      const result = await provider.discover({ query: "x", pageSize: 100 });
      return result.ok ? result.value.items : [];
    };
    expect(await run()).toEqual(await run());
  });
});
