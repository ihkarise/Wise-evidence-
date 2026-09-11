/**
 * PubMed-through-orchestrator integration (M7.7; docs/30 §9, §12). The real
 * PubMedDiscoveryProvider is driven by the orchestrator through the registry
 * using an INJECTED fake fetch — no network. Proves provider selection stays
 * registry-based (no `if source === "pubmed"` anywhere) and the connector plugs
 * into the run unchanged, preserving every LOCKED boundary (DISCOVER → QUEUE,
 * DUPLICATE ≠ DELETE, no canonical write).
 */
import { describe, it, expect } from "vitest";
import { runDiscovery } from "./orchestrator.js";
import { InMemoryDiscoveryStore, InMemoryStudyIndex } from "./store.js";
import { createDefaultDiscoveryRegistry } from "../registry.js";
import { PUBMED_PAGE_1, PUBMED_PAGE_2, makePubMedFixtureFetch } from "../pubmed/fixtures.js";
import type { DiscoveryActor } from "./types.js";

const STAFF: DiscoveryActor = { role: "ADMIN" };
const CLOCK = () => "2026-03-01T00:00:00.000Z";

describe("runDiscovery — PubMed via registry + injected fetch", () => {
  it("runs a full PubMed discovery and persists candidates offline", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1, PUBMED_PAGE_2] });
    const store = new InMemoryDiscoveryStore(CLOCK);
    const result = await runDiscovery(
      // pageSize 3 matches page 1's length so pagination advances to page 2.
      { providerType: "PUBMED", query: "homeopathy", budget: { pageSize: 3 } },
      {
        registry: createDefaultDiscoveryRegistry(),
        providerContext: { fetch, clock: CLOCK },
        runStore: store,
        candidateStore: store,
        studyIndex: new InMemoryStudyIndex(),
        actor: STAFF,
        now: () => 5_000,
        sleep: () => Promise.resolve(),
        rng: () => 0,
      },
    );

    expect(result.state).toBe("COMPLETED");
    expect(result.sourceKey).toBe("pubmed");
    expect(result.providerType).toBe("PUBMED");
    expect(result.counters.pages).toBe(2);
    // PMID is always the stable id, so all five records — including the DOI
    // duplicate (its own PMID) — normalize into distinct reviewable candidates.
    expect(result.counters.candidates).toBe(5);
    expect(result.counters.invalid).toBe(0);
    expect(result.counters.skipped).toBe(0);
    expect(store.candidates.size).toBe(5);
  });

  it("flags a DOI already known to the study index as a DUPLICATE candidate (never merges/deletes)", async () => {
    const { fetch } = makePubMedFixtureFetch({ pages: [PUBMED_PAGE_1] });
    const store = new InMemoryDiscoveryStore(CLOCK);
    const result = await runDiscovery(
      { providerType: "PUBMED", query: "homeopathy", budget: { pageSize: 3 } },
      {
        registry: createDefaultDiscoveryRegistry(),
        providerContext: { fetch, clock: CLOCK },
        runStore: store,
        candidateStore: store,
        // A canonical study already exists for the alpha DOI.
        studyIndex: new InMemoryStudyIndex([
          { studyId: "study-alpha", doi: "10.0000/wise.pubmed.alpha" },
        ]),
        actor: STAFF,
        now: () => 5_000,
        sleep: () => Promise.resolve(),
        rng: () => 0,
      },
    );

    expect(result.state).toBe("COMPLETED");
    expect(result.counters.candidates).toBe(3); // all still queued for human review
    expect(result.counters.duplicates).toBe(1); // the alpha record flagged, not deleted
    const states = [...store.candidates.values()].map((c) => c.state).sort();
    expect(states).toEqual(["DUPLICATE_CANDIDATE", "REVIEW_REQUIRED", "REVIEW_REQUIRED"]);
  });

  it("fails closed when PUBMED is selected without an injected fetch", async () => {
    const store = new InMemoryDiscoveryStore(CLOCK);
    const result = await runDiscovery(
      { providerType: "PUBMED", query: "x" },
      {
        registry: createDefaultDiscoveryRegistry(),
        // no providerContext.fetch → registry throws NOT_CONFIGURED
        runStore: store,
        candidateStore: store,
        studyIndex: new InMemoryStudyIndex(),
        actor: STAFF,
        now: () => 1,
      },
    );
    expect(result.state).toBe("FAILED");
    expect(result.errors.some((e) => e.code === "NOT_CONFIGURED")).toBe(true);
  });
});
