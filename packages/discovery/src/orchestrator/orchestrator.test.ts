/**
 * Discovery orchestrator — end-to-end run tests (M7.3). All offline and
 * deterministic via the MockDiscoveryProvider and in-memory stores; no network,
 * no database, no AI.
 */
import { describe, it, expect } from "vitest";
import { runDiscovery, OrchestratorError, type RunDiscoveryDeps } from "./orchestrator.js";
import { InMemoryDiscoveryStore, InMemoryStudyIndex } from "./store.js";
import { createDefaultDiscoveryRegistry, DiscoveryProviderRegistry } from "../registry.js";
import { MockDiscoveryProvider } from "../mock/provider.js";
import type { DiscoveryActor } from "./types.js";
import type { MockDiscoveryDataset } from "../mock/fixtures.js";

const STAFF: DiscoveryActor = { role: "REVIEWER" };
const fixedNow = () => 1_000;

function baseDeps(overrides: Partial<RunDiscoveryDeps> = {}): RunDiscoveryDeps {
  return {
    registry: createDefaultDiscoveryRegistry(),
    runStore: new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z"),
    candidateStore:
      overrides.candidateStore ?? new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z"),
    studyIndex: new InMemoryStudyIndex(),
    actor: STAFF,
    now: fixedNow,
    sleep: () => Promise.resolve(),
    rng: () => 0,
    ...overrides,
  };
}

/** A registry whose MOCK factory serves a specific dataset. */
function registryWithDataset(dataset: MockDiscoveryDataset): DiscoveryProviderRegistry {
  return new DiscoveryProviderRegistry().register(
    "MOCK",
    (ctx) => new MockDiscoveryProvider({ key: ctx.key, dataset }),
  );
}

describe("runDiscovery — mock end to end", () => {
  it("runs the full pipeline and persists reviewable candidates", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const deps = baseDeps({ runStore: store, candidateStore: store });
    const result = await runDiscovery({ providerType: "MOCK" }, deps);

    expect(result.state).toBe("COMPLETED");
    expect(result.sourceKey).toBe("mock");
    expect(result.counters.pages).toBe(2);
    expect(result.counters.discovered).toBe(5);
    expect(result.counters.normalized).toBe(4);
    expect(result.counters.invalid).toBe(1); // the malformed item
    expect(result.counters.candidates).toBe(4);
    expect(result.counters.failed).toBe(0);

    // Run lifecycle recorded, candidates persisted.
    const run = store.runs.get(result.runId);
    expect(run?.state).toBe("COMPLETED");
    expect(store.candidates.size).toBe(4);
  });

  it("persists candidate provenance and a minimised normalized payload", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const deps = baseDeps({ runStore: store, candidateStore: store });
    await runDiscovery({ providerType: "MOCK" }, deps);
    const candidate = [...store.candidates.values()].find((c) => c.stableSourceId === "mock-0001");
    expect(candidate).toBeDefined();
    expect(candidate?.runId).toMatch(/^run-/);
    expect(candidate?.rawHash).toMatch(/^[0-9a-f]{64}$/);
    const payload = candidate?.normalizedPayload as Record<string, unknown>;
    expect(payload.canonicalDoi).toBe("10.0000/wise.discovery.alpha");
    expect(payload).toHaveProperty("provenance");
  });

  it("is idempotent: a re-run into the same store creates no new candidates", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const deps = () => baseDeps({ runStore: store, candidateStore: store });
    const first = await runDiscovery({ providerType: "MOCK" }, deps());
    const second = await runDiscovery({ providerType: "MOCK" }, deps());

    expect(first.counters.candidates).toBe(4);
    expect(second.counters.candidates).toBe(0);
    expect(second.counters.skipped).toBe(4);
    expect(store.candidates.size).toBe(4); // unchanged
  });

  it("keeps items with a missing DOI as valid candidates (missing DOI ≠ missing item)", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    await runDiscovery(
      { providerType: "MOCK" },
      baseDeps({ runStore: store, candidateStore: store }),
    );
    // mock-0002 has no DOI but a title — it must have been persisted.
    const noDoi = [...store.candidates.values()].find((c) => c.stableSourceId === "mock-0002");
    expect(noDoi).toBeDefined();
    expect((noDoi?.normalizedPayload as Record<string, unknown>).canonicalDoi).toBeNull();
  });
});

describe("runDiscovery — deduplication (conservative, never deletes)", () => {
  it("flags exact-DOI matches as DEFINITE duplicates but still persists them", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const studyIndex = new InMemoryStudyIndex([
      { studyId: "existing-study", doi: "10.0000/wise.discovery.alpha" },
    ]);
    const result = await runDiscovery(
      { providerType: "MOCK" },
      baseDeps({ runStore: store, candidateStore: store, studyIndex }),
    );
    expect(result.counters.duplicates).toBe(2); // mock-0001 and mock-0004 share the DOI
    expect(result.counters.candidates).toBe(4); // none deleted
    const dup = [...store.candidates.values()].find((c) => c.stableSourceId === "mock-0001");
    expect(dup?.dedup.verdict).toBe("DEFINITE_DUPLICATE");
    expect(dup?.dedup.relatedStudyId).toBe("existing-study");
    expect(dup?.state).toBe("DUPLICATE_CANDIDATE");
  });
});

describe("runDiscovery — budgets (always bounded)", () => {
  it("enforces the candidate budget", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "MOCK", budget: { maxCandidates: 2 } },
      baseDeps({ runStore: store, candidateStore: store }),
    );
    expect(result.counters.candidates).toBe(2);
    expect(result.stopReason).toContain("candidate budget");
  });

  it("enforces the page budget", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "MOCK", budget: { maxPages: 1 } },
      baseDeps({ runStore: store, candidateStore: store }),
    );
    expect(result.counters.pages).toBe(1);
    expect(result.counters.discovered).toBe(3); // only page 1
  });

  it("cannot exceed the hard maximum page size", async () => {
    // pageSize is clamped; the mock descriptor caps items at 10 anyway.
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      {
        providerType: "MOCK",
        budget: { pageSize: 1_000_000, maxItems: 1000, maxCandidates: 1000 },
      },
      baseDeps({ runStore: store, candidateStore: store }),
    );
    expect(result.counters.candidates).toBe(4);
  });
});

describe("runDiscovery — failure isolation & retries", () => {
  it("isolates a failed fetch: the run continues and other items persist", async () => {
    const dataset: MockDiscoveryDataset = {
      pages: [
        [
          { sourceId: "a-1", doi: "10.0000/iso.a", title: "Item A" },
          { sourceId: "b-1", doi: "10.0000/iso.b", title: "Item B" },
        ],
      ],
      fetchBehaviors: { "b-1": { kind: "error", code: "FETCH_FAILED" } },
    };
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "MOCK", fetchDetail: true },
      baseDeps({ registry: registryWithDataset(dataset), runStore: store, candidateStore: store }),
    );
    expect(result.counters.discovered).toBe(2);
    expect(result.counters.failed).toBe(1); // b-1 fetch failed
    expect(result.counters.candidates).toBe(1); // a-1 still persisted
    expect(result.state).toBe("COMPLETED");
  });

  it("bounded-retries a transient (RATE_LIMITED) discover failure, then fails the run", async () => {
    // maxDiscoverCalls:0 → every discover() returns a retryable RATE_LIMITED.
    const rateLimited = new MockDiscoveryProvider({ maxDiscoverCalls: 0 });
    const registry = new DiscoveryProviderRegistry().register("MOCK", () => rateLimited);
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "MOCK", budget: { maxRetriesPerRequest: 2, maxRequests: 5 } },
      baseDeps({ registry, runStore: store, candidateStore: store }),
    );
    expect(result.counters.retries).toBe(2); // initial + 2 bounded retries, then gives up
    expect(result.state).toBe("FAILED");
    expect(result.counters.candidates).toBe(0);
  });
});

describe("runDiscovery — authorization & provider selection", () => {
  it("refuses a non-staff actor before any run is created", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    await expect(
      runDiscovery(
        { providerType: "MOCK" },
        baseDeps({ runStore: store, candidateStore: store, actor: { role: "PUBLIC" } }),
      ),
    ).rejects.toBeInstanceOf(OrchestratorError);
    expect(store.runs.size).toBe(0);
  });

  it("fails closed (FAILED run) for an unconfigured provider", async () => {
    const store = new InMemoryDiscoveryStore(() => "2026-03-01T00:00:00.000Z");
    const result = await runDiscovery(
      { providerType: "PUBMED" },
      baseDeps({ runStore: store, candidateStore: store }),
    );
    expect(result.state).toBe("FAILED");
    expect(result.errors.some((e) => e.code === "NOT_CONFIGURED")).toBe(true);
    expect(result.counters.candidates).toBe(0);
  });
});
