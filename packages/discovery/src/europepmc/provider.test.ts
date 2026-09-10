/**
 * Europe PMC connector — contract, parsing, pagination, and provenance tests
 * (M7.6). All offline via an injected fake fetch; no network, no secrets.
 */
import { describe, it, expect } from "vitest";
import { EuropePMCDiscoveryProvider, EUROPE_PMC_DISCOVERY_VERSION } from "./provider.js";
import {
  EPMC_PAGE_1,
  EPMC_PAGE_2,
  RESULT_FULL,
  RESULT_SPARSE,
  makeEuropePMCFixtureFetch,
  makeFakeFetch,
  searchListBody,
  type EuropePMCResult,
} from "./fixtures.js";
import type { DiscoveryPage } from "../types.js";

const CLOCK = () => "2026-02-02T00:00:00.000Z";

function fixtureProvider(contactEmail?: string) {
  const { fetch, requests } = makeEuropePMCFixtureFetch({ pages: [EPMC_PAGE_1, EPMC_PAGE_2] });
  const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK, contactEmail });
  return { provider, requests };
}

/** A fake fetch that serves single records by their SRC/EXT_ID or DOI query. */
function recordFetch(records: readonly EuropePMCResult[]) {
  return makeFakeFetch((url) => {
    const query = new URL(url).searchParams.get("query") ?? "";
    const match = records.find((rec) => {
      const src = String((rec as { source?: unknown }).source ?? "");
      const id = String((rec as { id?: unknown }).id ?? "");
      const doi = String((rec as { doi?: unknown }).doi ?? "");
      if (src && id && query.includes(`EXT_ID:"${id}"`) && query.includes(`SRC:"${src}"`)) {
        return true;
      }
      return doi.length > 0 && query.includes(`DOI:"${doi}"`);
    });
    return { bodyText: searchListBody(match ? [match] : [], "*") };
  });
}

describe("EuropePMCDiscoveryProvider — discovery & parsing", () => {
  it("discovers page 1 and maps a full Europe PMC result to a neutral SourceItem", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "homeopathy" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("europepmc");
    expect(result.value.discoveredAt).toBe(CLOCK());

    const alpha = result.value.items.find((i) => i.sourceId === "MED/36000001");
    expect(alpha).toBeDefined();
    expect(alpha?.title).toContain("individualized intervention");
    expect(alpha?.authors).toEqual(["Smith JQ", "Müller RA"]);
    expect(alpha?.journal).toBe("Journal of Example Research");
    expect(alpha?.publicationDate).toBe("2021-03-01");
    expect(alpha?.doi).toBe("10.0000/wise.epmc.alpha");
    expect(alpha?.abstract).not.toContain("<"); // markup stripped
    // Carries all three identifier kinds Europe PMC cross-links.
    expect(alpha?.identifiers.map((id) => id.type).sort()).toEqual(["DOI", "PMCID", "PMID"]);
  });

  it("never exposes the raw Europe PMC record — only whitelisted provenance fields", async () => {
    const { provider } = fixtureProvider();
    const result = await provider.discover({ query: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alpha = result.value.items.find((i) => i.sourceId === "MED/36000001");
    expect(Object.keys(alpha?.raw ?? {}).sort()).toEqual([
      "europepmcId",
      "europepmcIsOpenAccess",
      "europepmcPubType",
      "europepmcSource",
      "pmcid",
      "pmid",
    ]);
    expect(alpha?.raw).not.toHaveProperty("citedByCount");
    expect(alpha?.raw).not.toHaveProperty("authorList");
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
    expect(req?.url).toContain("https://www.ebi.ac.uk/europepmc/webservices/rest/search?");
    expect(req?.url).toContain("pageSize=5");
    expect(req?.url).toContain("format=json");
    expect(req?.url).toContain("resultType=core");
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
    expect(requests[0]?.url).toContain("pageSize=100"); // maxItemsPerRequest
  });

  it("paginates across pages via the Europe PMC cursorMark and terminates", async () => {
    const { fetch } = makeEuropePMCFixtureFetch({ pages: [EPMC_PAGE_1, EPMC_PAGE_2] });
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
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
    // Page 1 is full (3 items) → advances; page 2 is short (2 items) → terminates.
    expect(pages.length).toBe(2);
    expect(pages[0]?.nextCursor).not.toBeNull();
    expect(pages[1]?.nextCursor).toBeNull();
  });

  it("stops paginating when Europe PMC repeats the same cursorMark (end of results)", async () => {
    // A single full page whose next mark equals the sent cursor must not loop.
    const { fetch } = makeFakeFetch(() => ({ bodyText: searchListBody(EPMC_PAGE_1, "*") }));
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextCursor).toBeNull();
  });

  it("surfaces a duplicate DOI without deleting it (DUPLICATE ≠ DELETE)", async () => {
    const { fetch } = makeFakeFetch(() => ({
      bodyText: searchListBody([...EPMC_PAGE_1, ...EPMC_PAGE_2], "*"),
    }));
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const alphaDois = result.value.items.filter((i) => i.doi === "10.0000/wise.epmc.alpha");
    expect(alphaDois.length).toBe(2); // both surfaced, distinct source ids
    expect(alphaDois.map((i) => i.sourceId).sort()).toEqual(["MED/36000001", "PMC/PMC9000099"]);
  });

  it("canonicalises unusual DOI casing and survives a malformed title via the DOI", async () => {
    const { fetch } = makeFakeFetch(() => ({ bodyText: searchListBody(EPMC_PAGE_2, "*") }));
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.discover({ query: "x", pageSize: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const casing = result.value.items.find((i) => i.sourceId === "MED/36000003");
    expect(casing).toBeDefined();
    expect(casing?.title).toBeNull(); // malformed title dropped
    const normalized = provider.normalize(casing!);
    expect(normalized.ok).toBe(true); // still usable via canonical DOI
    if (!normalized.ok) return;
    expect(normalized.value.canonicalDoi).toBe("10.0000/wise.epmc.casing");
  });

  it("supports discovery by DOI filter", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({
      identifiers: [{ type: "DOI", value: "10.0000/wise.epmc.alpha" }],
    });
    expect(requests[0]?.url).toContain("DOI");
    expect(decodeURIComponent(requests[0]?.url ?? "")).toContain('DOI:"10.0000/wise.epmc.alpha"');
  });

  it("neutralises query operators from untrusted free-text input", async () => {
    const { provider, requests } = fixtureProvider();
    await provider.discover({ query: 'homeopathy OR AUTH:"evil" AND (x)' });
    const decoded = decodeURIComponent(requests[0]?.url ?? "");
    expect(decoded).not.toContain('AUTH:"evil"');
    expect(decoded).not.toContain(" OR ");
  });
});

describe("EuropePMCDiscoveryProvider — fetch & provenance", () => {
  it("fetches a single record by its composite SRC/ID and records a raw-payload hash", async () => {
    const { fetch } = recordFetch([RESULT_FULL, RESULT_SPARSE]);
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "europepmc", sourceId: "MED/36000001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceId).toBe("MED/36000001");
    expect(result.value.fetchedAt).toBe(CLOCK());
    expect(result.value.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fetches a single record by a bare DOI", async () => {
    const { fetch } = recordFetch([RESULT_SPARSE]);
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({
      sourceKey: "europepmc",
      sourceId: "10.0000/wise.epmc.sparse",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceId).toBe("MED/36000002");
  });

  it("rejects a fetch whose source id is neither a composite id nor a DOI", async () => {
    const { fetch } = recordFetch([]);
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "europepmc", sourceId: "not-an-id" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("maps an unknown record (empty result list) to SOURCE_UNAVAILABLE", async () => {
    const { fetch } = recordFetch([]);
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const result = await provider.fetch({ sourceKey: "europepmc", sourceId: "MED/99999999" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("normalizes a fetched item with complete, traceable Europe PMC provenance", async () => {
    const { fetch } = recordFetch([RESULT_FULL]);
    const provider = new EuropePMCDiscoveryProvider({ fetch, clock: CLOCK });
    const fetched = await provider.fetch({ sourceKey: "europepmc", sourceId: "MED/36000001" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const prov = normalized.value.provenance;
    expect(prov.sourceKey).toBe("europepmc");
    expect(prov.sourceId).toBe("MED/36000001");
    expect(prov.doi).toBe("10.0000/wise.epmc.alpha");
    expect(prov.providerVersion).toBe(EUROPE_PMC_DISCOVERY_VERSION);
    expect(prov.discoveredAt).toBe(CLOCK());
    expect(prov.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
