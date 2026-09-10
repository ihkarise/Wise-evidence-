/**
 * Crossref-through-orchestrator integration (M7.3, docs/30 §Phase 29). The real
 * CrossrefDiscoveryProvider is driven by the orchestrator through the registry
 * using an INJECTED fake fetch — no network. Proves provider selection stays
 * registry-based (no `if source === "crossref"` anywhere) and the connector
 * plugs into the run unchanged.
 */
import { describe, it, expect } from "vitest";
import { runDiscovery } from "./orchestrator.js";
import { InMemoryDiscoveryStore, InMemoryStudyIndex } from "./store.js";
import { createDefaultDiscoveryRegistry } from "../registry.js";
import {
  CROSSREF_PAGE_1,
  CROSSREF_PAGE_2,
  makeCrossrefFixtureFetch,
} from "../crossref/fixtures.js";
import type { DiscoveryActor } from "./types.js";

const STAFF: DiscoveryActor = { role: "ADMIN" };

describe("runDiscovery — Crossref via registry + injected fetch", () => {
  it("runs a full Crossref discovery and persists candidates offline", async () => {
    const { fetch } = makeCrossrefFixtureFetch({
      pages: [
        { items: CROSSREF_PAGE_1, nextCursor: null },
        { items: CROSSREF_PAGE_2, nextCursor: null },
      ],
    });
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      // pageSize 3 matches the fixture page length so pagination advances to page 2.
      { providerType: "CROSSREF", query: "homeopathy", budget: { pageSize: 3 } },
      {
        registry: createDefaultDiscoveryRegistry(),
        providerContext: { fetch, clock: () => "2026-03-01T00:00:00.000Z" },
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
    expect(result.sourceKey).toBe("crossref");
    expect(result.providerType).toBe("CROSSREF");
    // Page 1: alpha (DOI) → candidate, no-DOI → invalid, sparse (DOI) → candidate.
    // Page 2: casing (DOI) → candidate, duplicate-alpha (same DOI) → skipped (idempotent).
    expect(result.counters.pages).toBe(2);
    expect(result.counters.candidates).toBe(3);
    expect(result.counters.invalid).toBe(1);
    expect(result.counters.skipped).toBe(1);
    expect(store.candidates.size).toBe(3);
  });

  it("fails closed when CROSSREF is selected without an injected fetch", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "CROSSREF", query: "x" },
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
