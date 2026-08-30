/**
 * Crossref connector — contract, parsing, pagination, and provenance tests
 * (M7.2). All offline via an injected fake fetch; no network, no secrets.
 */
import { describe, it, expect } from "vitest";
import { CrossrefDiscoveryProvider, CROSSREF_DISCOVERY_VERSION } from "./provider.js";
import {
  CROSSREF_PAGE_1,
  CROSSREF_PAGE_2,
  WORK_FULL,
  WORK_SPARSE,
  makeCrossrefFixtureFetch,
} from "./fixtures.js";
import type { DiscoveryPage } from "../types.js";

const CLOCK = () => "2026-02-02T00:00:00.000Z";

function fixtureProvider(contactEmail?: string) {
  const { fetch, requests } = makeCrossrefFixtureFetch({
    pages: [
      { items: CROSSREF_PAGE_1, nextCursor: null },
      { items: CROSSREF_PAGE_2, nextCursor: null },
    ],
    byDoi: {
      "10.0000/wise.crossref.alpha": WORK_FULL,
      "10.0000/wise.crossref.sparse": WORK_SPARSE,
    },
  });
  const provider = new CrossrefDiscoveryProvider({ fetch, clock: CLOCK, contactEmail });
  return { provider, requests };
}

describe("CrossrefDiscoveryProvider — discovery & parsing", () => {
  it("discovers page 1 and maps a full Crossref work to a neutral SourceItem", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "homeopathy" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("crossref");
    expect(result.value.discoveredAt).toBe(CLOCK());

    const alpha = result.value.items.find((i) => i.sourceId === "10.0000/wise.crossref.alpha");
    expect(alpha).toBeDefined();
    expect(alpha?.title).toContain("individualized intervention");
    expect(alpha?.authors).toEqual(["Jane Q. Smith", "Robert A. Müller"]);
    expect(alpha?.journal).toBe("Journal of Example Research");
    expect(alpha?.publicationDate).toBe("2021-03-01");
    expect(alpha?.doi).toBe("10.0000/wise.crossref.alpha");
    expect(alpha?.abstract).not.toContain("<"); // markup stripped
  });

  it("never exposes the raw Crossref record — only whitelisted provenance fields", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alpha = result.value.items.find((i) => i.sourceId === "10.0000/wise.crossref.alpha");
    expect(Object.keys(alpha?.raw ?? {}).sort()).toEqual([
      "crossrefMember",
      "crossrefScore",
      "crossrefType",
    ]);
    expect(alpha?.raw).not.toHaveProperty("reference-count");
    expect(alpha?.raw).not.toHaveProperty("author");
  });

  it("requires a query or DOI identifier (never an unbounded request)", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("sends a bounded, gated request with a polite User-Agent and no redirects", async () => {
    const { provider, requests } = fixtureProvider("discovery@example.org");
    await provider.discover({ query: "homeopathy", pageSize: 5 });
    const req = requests[0];
    expect(req?.url).toContain("https://api.crossref.org/works?");
    expect(req?.url).toContain("rows=5");
    expect(req?.method).toBe("GET");
    expect(req?.redirect).toBe("error");
    expect(req?.headers?.["User-Agent"]).toContain("mailto:discovery@example.org");
    expect(req?.headers?.Accept).toBe("application/json");
  });

  it("omits mailto from the User-Agent when no contact email is configured", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: "x" });
    expect(requests[0]?.headers?.["User-Agent"]).not.toContain("mailto:");
  });

  it("clamps page size to the descriptor's per-request cap", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: "x", pageSize: 100_000 });
    expect(requests[0]?.url).toContain("rows=100"); // CROSSREF_SOURCE_DESCRIPTOR.maxItemsPerRequest
  });

  it("paginates across pages via the Crossref cursor and terminates", async () => {
    const { fetch } = makeCrossrefFixtureFetch({
      pages: [
        { items: CROSSREF_PAGE_1, nextCursor: null },
        { items: CROSSREF_PAGE_2, nextCursor: null },
      ],
    });
    const provider = new CrossrefDiscoveryProvider({ fetch, clock: CLOCK });
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
    expect(pages.length).toBe(2);
    expect(pages[0]?.nextCursor).not.toBeNull();
    expect(pages[1]?.nextCursor).toBeNull();
  });

  it("surfaces a duplicate DOI without deleting it (DUPLICATE ≠ DELETE)", async () => {
    const { fetch } = makeCrossrefFixtureFetch({
      pages: [{ items: [...CROSSREF_PAGE_1, ...CROSSREF_PAGE_2], nextCursor: null }],
    });
    const provider = new CrossrefDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alphas = result.value.items.filter((i) => i.sourceId === "10.0000/wise.crossref.alpha");
    expect(alphas.length).toBe(2);
  });

  it("canonicalises unusual DOI casing and survives a malformed title via the DOI", async () => {
    const { fetch } = makeCrossrefFixtureFetch({
      pages: [{ items: CROSSREF_PAGE_2, nextCursor: null }],
    });
    const provider = new CrossrefDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const casing = result.value.items.find((i) => i.sourceId === "10.0000/wise.crossref.casing");
    expect(casing).toBeDefined();
    expect(casing?.title).toBeNull(); // malformed title dropped
    const normalized = provider.normalize(casing!);
    expect(normalized.ok).toBe(true); // still usable via canonical DOI
  });

  it("supports discovery by DOI filter", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({
      identifiers: [{ type: "DOI", value: "10.0000/wise.crossref.alpha" }],
    });
    expect(requests[0]?.url).toContain("filter=doi%3A10.0000%2Fwise.crossref.alpha");
  });
});

describe("CrossrefDiscoveryProvider — fetch & provenance", () => {
  it("fetches a single work by DOI and records a raw-payload hash", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.fetch({
      sourceKey: "crossref",
      sourceId: "10.0000/wise.crossref.alpha",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceId).toBe("10.0000/wise.crossref.alpha");
    expect(result.value.fetchedAt).toBe(CLOCK());
    expect(result.value.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a fetch whose source id is not a valid DOI", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.fetch({ sourceKey: "crossref", sourceId: "not-a-doi" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("maps an unknown DOI (404) to SOURCE_UNAVAILABLE", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.fetch({
      sourceKey: "crossref",
      sourceId: "10.0000/wise.crossref.missing",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("normalizes a fetched item with complete, traceable Crossref provenance", async () => {
    const { provider } = fixtureProvider();
    const fetched = await provider.fetch({
      sourceKey: "crossref",
      sourceId: "10.0000/wise.crossref.alpha",
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const prov = normalized.value.provenance;
    expect(prov.sourceKey).toBe("crossref");
    expect(prov.sourceId).toBe("10.0000/wise.crossref.alpha");
    expect(prov.doi).toBe("10.0000/wise.crossref.alpha");
    expect(prov.providerVersion).toBe(CROSSREF_DISCOVERY_VERSION);
    expect(prov.discoveredAt).toBe(CLOCK());
    expect(prov.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
