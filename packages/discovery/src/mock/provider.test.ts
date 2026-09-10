import { describe, it, expect } from "vitest";
import { MockDiscoveryProvider, MOCK_DISCOVERY_VERSION, FIXED_MOCK_CLOCK } from "./provider.js";
import { EMPTY_DISCOVERY_DATASET } from "./fixtures.js";
import type { DiscoveryPage } from "../types.js";

/** Drain every page of a provider into a flat item list plus the page count. */
async function drain(provider: MockDiscoveryProvider): Promise<{
  readonly pages: DiscoveryPage[];
}> {
  const pages: DiscoveryPage[] = [];
  let cursor: string | null = null;
  // Bounded loop — the mock always terminates with nextCursor null.
  for (let i = 0; i < 100; i += 1) {
    const result = await provider.discover({ cursor });
    expect(result.ok).toBe(true);
    if (!result.ok) break;
    pages.push(result.value);
    cursor = result.value.nextCursor;
    if (cursor === null) break;
  }
  return { pages };
}

describe("MockDiscoveryProvider — discovery", () => {
  it("discovers items from the first page with a deterministic timestamp", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.discover({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("mock");
    expect(result.value.discoveredAt).toBe(FIXED_MOCK_CLOCK());
    expect(result.value.items.length).toBeGreaterThan(0);
    expect(result.value.nextCursor).not.toBeNull();
  });

  it("paginates across multiple pages and terminates with a null cursor", async () => {
    const provider = new MockDiscoveryProvider();
    const { pages } = await drain(provider);
    expect(pages.length).toBe(2);
    expect(pages[pages.length - 1]?.nextCursor).toBeNull();
  });

  it("is deterministic: two providers yield identical pages", async () => {
    const a = await drain(new MockDiscoveryProvider());
    const b = await drain(new MockDiscoveryProvider());
    expect(a.pages).toEqual(b.pages);
  });

  it("returns a single empty page for the empty dataset", async () => {
    const provider = new MockDiscoveryProvider({ dataset: EMPTY_DISCOVERY_DATASET });
    const result = await provider.discover({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toEqual([]);
    expect(result.value.nextCursor).toBeNull();
  });

  it("preserves source identity and keeps missing/invalid DOIs verbatim", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.discover({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.value.items.map((i) => [i.sourceId, i]));
    expect(byId.get("mock-0001")?.doi).toBe("10.0000/wise.discovery.alpha");
    expect(byId.get("mock-0002")?.doi).toBeNull(); // missing DOI preserved as null
    expect(byId.get("mock-0003")?.doi).toBe("not-a-valid-doi"); // invalid DOI kept raw
  });

  it("surfaces a duplicate item without deleting it (DUPLICATE ≠ DELETE)", async () => {
    const provider = new MockDiscoveryProvider();
    const { pages } = await drain(provider);
    const items = pages.flatMap((p) => p.items);
    const withAlpha = items.filter((i) => i.doi === "10.0000/wise.discovery.alpha");
    expect(withAlpha.length).toBe(2); // both the original and the reprint are present
    expect(new Set(withAlpha.map((i) => i.sourceId)).size).toBe(2);
  });

  it("clamps page size to the descriptor limit", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.discover({ pageSize: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBe(1);
  });

  it("rejects a malformed cursor with MALFORMED_RESPONSE", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.discover({ cursor: "not-a-number" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MALFORMED_RESPONSE");
  });

  it("simulates rate limiting deterministically after a call budget", async () => {
    const provider = new MockDiscoveryProvider({ maxDiscoverCalls: 1 });
    const first = await provider.discover({});
    const second = await provider.discover({});
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("RATE_LIMITED");
    expect(second.error.retryable).toBe(true);
  });
});

describe("MockDiscoveryProvider — fetch", () => {
  it("fetches a known item and records a raw-payload hash", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.fetch({ sourceKey: "mock", sourceId: "mock-0001" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceId).toBe("mock-0001");
    expect(result.value.fetchedAt).toBe(FIXED_MOCK_CLOCK());
    expect(result.value.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns FETCH_FAILED for an unknown source id", async () => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.fetch({ sourceKey: "mock", sourceId: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FETCH_FAILED");
  });

  it.each([
    ["mock-fetch-unavailable", "SOURCE_UNAVAILABLE"],
    ["mock-fetch-timeout", "TIMEOUT"],
    ["mock-fetch-ratelimited", "RATE_LIMITED"],
    ["mock-fetch-failed", "FETCH_FAILED"],
    ["mock-fetch-malformed", "MALFORMED_RESPONSE"],
  ])("simulates the configured fetch failure for %s", async (sourceId, expected) => {
    const provider = new MockDiscoveryProvider();
    const result = await provider.fetch({ sourceKey: "mock", sourceId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(expected);
  });
});

describe("MockDiscoveryProvider — identity", () => {
  it("exposes its key, descriptor, and version", () => {
    const provider = new MockDiscoveryProvider();
    expect(provider.key).toBe("mock");
    expect(provider.descriptor.providerType).toBe("MOCK");
    expect(provider.version).toBe(MOCK_DISCOVERY_VERSION);
  });

  it("honours an overridden source key", async () => {
    const provider = new MockDiscoveryProvider({ key: "mock-b" });
    const result = await provider.discover({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.source).toBe("mock-b");
    expect(result.value.items.every((i) => i.sourceKey === "mock-b")).toBe(true);
  });
});
