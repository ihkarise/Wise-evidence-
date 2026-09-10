/**
 * OPT-IN live Crossref smoke test (M7.2; docs/30 §8, docs/20).
 *
 * This is the ONLY test that touches the real Crossref API. It is
 * `describe.runIf`-gated on `RUN_CROSSREF_LIVE=1` and stays SKIPPED by default,
 * so `pnpm test` / CI never contact Crossref and never depend on its
 * availability. It exists only for a human to sanity-check the real endpoint in a
 * network-permitted environment.
 *
 * It uses the platform global fetch (adapted to the injected `FetchLike`) — the
 * one place a global fetch is permitted, and only inside a gated test. It is
 * deliberately tiny (a single request for a well-known DOI) to stay polite.
 */
import { describe, it, expect } from "vitest";
import { CrossrefDiscoveryProvider } from "./provider.js";
import type { FetchLike } from "../http.js";

const LIVE = process.env.RUN_CROSSREF_LIVE === "1";

// Adapt the platform fetch to the connector's minimal FetchLike signature. Only
// reached when LIVE is set; the boundary guard ignores test files.
const liveFetch = ((url, init) =>
  (globalThis as { fetch: (u: string, i?: unknown) => Promise<unknown> }).fetch(
    url,
    init,
  )) as FetchLike;

describe.runIf(LIVE)("LIVE Crossref connector", () => {
  it("fetches and normalizes a well-known DOI from api.crossref.org", async () => {
    const provider = new CrossrefDiscoveryProvider({
      fetch: liveFetch,
      contactEmail: process.env.CROSSREF_CONTACT_EMAIL ?? null,
    });
    // Crossref's own metadata self-description DOI — stable and safe to fetch.
    const fetched = await provider.fetch({
      sourceKey: "crossref",
      sourceId: "10.1145/2783446.2783605",
    });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.canonicalDoi).toBe("10.1145/2783446.2783605");
    expect(normalized.value.provenance.sourceKey).toBe("crossref");
  }, 20_000);
});
