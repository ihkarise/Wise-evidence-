/**
 * OPT-IN live PubMed smoke test (M7.7; docs/30 §8, docs/20).
 *
 * This is the ONLY PubMed test that touches the real NCBI E-utilities API. It is
 * `describe.runIf`-gated on `RUN_PUBMED_LIVE=1` and stays SKIPPED by default, so
 * `pnpm test` / CI never contact NCBI and never depend on its availability. It
 * exists only for a human to sanity-check the real endpoint in a
 * network-permitted environment.
 *
 * It uses the platform global fetch (adapted to the injected `FetchLike`) — the
 * one place a global fetch is permitted, and only inside a gated test. It is
 * deliberately tiny (a single PMID lookup) to stay polite and key-free.
 */
import { describe, it, expect } from "vitest";
import { PubMedDiscoveryProvider } from "./provider.js";
import type { FetchLike } from "../http.js";

const LIVE = process.env.RUN_PUBMED_LIVE === "1";

// Adapt the platform fetch to the connector's minimal FetchLike signature. Only
// reached when LIVE is set; the boundary guard ignores test files.
const liveFetch = ((url, init) =>
  (globalThis as { fetch: (u: string, i?: unknown) => Promise<unknown> }).fetch(
    url,
    init,
  )) as FetchLike;

describe.runIf(LIVE)("LIVE PubMed connector", () => {
  it("fetches and normalizes a well-known PMID from eutils.ncbi.nlm.nih.gov", async () => {
    const provider = new PubMedDiscoveryProvider({
      fetch: liveFetch,
      contactEmail: process.env.PUBMED_CONTACT_EMAIL ?? null,
    });
    // A stable, long-standing MEDLINE record (Watson & Crick, structure of DNA).
    const fetched = await provider.fetch({ sourceKey: "pubmed", sourceId: "13054692" });
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    const normalized = provider.normalize(fetched.value.item);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.value.provenance.sourceKey).toBe("pubmed");
    expect(normalized.value.title.length).toBeGreaterThan(0);
  }, 20_000);
});
