/**
 * Provider contract tests (M7.1). These assert the invariants EVERY
 * `DiscoveryProvider` must satisfy, run against the reference `MockDiscoveryProvider`.
 * A future Crossref adapter should be exercised against this same suite.
 */
import { describe, it, expect } from "vitest";
import { MockDiscoveryProvider } from "./mock/provider.js";
import type { DiscoveryProvider } from "./provider.js";

function makeProvider(): DiscoveryProvider {
  return new MockDiscoveryProvider();
}

describe("DiscoveryProvider contract", () => {
  it("exposes a key that matches its descriptor and is echoed on pages", async () => {
    const provider = makeProvider();
    expect(provider.key).toBe(provider.descriptor.key);
    const page = await provider.discover({});
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.source).toBe(provider.key);
  });

  it("never throws for the expected failure cases — it returns a result", async () => {
    const provider = makeProvider();
    // Malformed cursor and unknown fetch id must resolve, not reject.
    await expect(provider.discover({ cursor: "!!!" })).resolves.toBeDefined();
    await expect(
      provider.fetch({ sourceKey: provider.key, sourceId: "nope" }),
    ).resolves.toBeDefined();
  });

  it("returns pages whose items all carry the provider's source key", async () => {
    const provider = makeProvider();
    const page = await provider.discover({});
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.every((i) => i.sourceKey === provider.key)).toBe(true);
  });

  it("normalize() is pure — same input yields deeply-equal output", () => {
    const provider = makeProvider();
    const item = {
      sourceKey: provider.key,
      sourceId: "x-1",
      sourceUrl: "https://doi.org/10.0000/wise.contract.a",
      doi: "10.0000/wise.contract.a",
      identifiers: [],
      title: "Contract item",
      authors: ["A"],
      journal: null,
      publicationDate: "2020",
      abstract: null,
      raw: {},
    } as const;
    expect(provider.normalize(item)).toEqual(provider.normalize(item));
  });

  it("normalize() rejects a structurally-broken item with NORMALIZATION_FAILED", () => {
    const provider = makeProvider();
    const broken = {
      sourceKey: provider.key,
      sourceId: "", // no stable id
      sourceUrl: null,
      doi: null,
      identifiers: [],
      title: null,
      authors: [],
      journal: null,
      publicationDate: null,
      abstract: null,
      raw: {},
    } as const;
    const result = provider.normalize(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NORMALIZATION_FAILED");
  });

  it("normalize() rejects a too-thin item with INSUFFICIENT_METADATA", () => {
    const provider = makeProvider();
    const thin = {
      sourceKey: provider.key,
      sourceId: "thin-1",
      sourceUrl: null,
      doi: "not-a-doi", // invalid → no canonical DOI
      identifiers: [],
      title: null, // and no title
      authors: [],
      journal: null,
      publicationDate: null,
      abstract: null,
      raw: {},
    } as const;
    const result = provider.normalize(thin);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_METADATA");
  });

  it("a fetched item can be normalized end to end", async () => {
    const provider = makeProvider();
    const fetched = await provider.fetch({ sourceKey: provider.key, sourceId: "mock-0001" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
  });
});
