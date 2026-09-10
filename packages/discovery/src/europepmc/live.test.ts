/**
 * OPT-IN live Europe PMC smoke test (M7.6; docs/30 §8, docs/20).
 *
 * This is the ONLY Europe PMC test that touches the real API. It is
 * `describe.runIf`-gated on `RUN_EUROPE_PMC_LIVE=1` and stays SKIPPED by default,
 * so `pnpm test` / CI never contact Europe PMC and never depend on its
 * availability. It exists only for a human to sanity-check the real endpoint in a
 * network-permitted environment.
 *
 * It uses the platform global fetch (adapted to the injected `FetchLike`) — the
 * one place a global fetch is permitted, and only inside a gated test. It is
 * deliberately tiny (a single record lookup) to stay polite.
 */
import { describe, it, expect } from "vitest";
import { EuropePMCDiscoveryProvider } from "./provider.js";
import type { FetchLike } from "../http.js";

const LIVE = process.env.RUN_EUROPE_PMC_LIVE === "1";

// Adapt the platform fetch to the connector's minimal FetchLike signature. Only
// reached when LIVE is set; the boundary guard ignores test files.
const liveFetch = ((url, init) =>
  (globalThis as { fetch: (u: string, i?: unknown) => Promise<unknown> }).fetch(
    url,
    init,
  )) as FetchLike;

describe.runIf(LIVE)("LIVE Europe PMC connector", () => {
  it("fetches and normalizes a well-known record from www.ebi.ac.uk", async () => {
    const provider = new EuropePMCDiscoveryProvider({
      fetch: liveFetch,
      contactEmail: process.env.EUROPE_PMC_CONTACT_EMAIL ?? null,
    });
    // A stable, long-standing MEDLINE record (the structure-of-DNA paper).
    const fetched = await provider.fetch({ sourceKey: "europepmc", sourceId: "MED/13054692" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.provenance.sourceKey).toBe("europepmc");
    expect(normalized.value.title.length).toBeGreaterThan(0);
  }, 20_000);
});
