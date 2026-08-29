/**
 * Runner tests — the offline "mock benchmark" (master prompt §13, §14, §15, §30).
 *
 * Exercises the whole harness against the deterministic MockAIProvider and a few
 * controllable stub providers, proving: per-task capture, honest nulls (no
 * fabricated 0s), cost only from usage+pricing, provider-error and invalid-output
 * handling, aggregation, and cache-identity isolation. No network, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  MockAIProvider,
  AIProviderError,
  UNKNOWN_USAGE,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProvider,
} from "@wise-evidence/ai";
import { runModelWorkload, aggregate, cacheKeyParts, cacheKeyString } from "./runner.js";
import { ESSENTIAL_TASKS, FULL_TASKS } from "./workloads.js";
import { demoInputForTask } from "./demo-study.js";

/** A stub provider whose behaviour the test controls. */
class StubProvider implements AIProvider {
  readonly id = "stub";
  constructor(
    readonly modelId: string,
    private readonly behaviour: (req: AICompletionRequest) => Promise<AICompletionResponse>,
  ) {}
  complete(req: AICompletionRequest): Promise<AICompletionResponse> {
    return this.behaviour(req);
  }
}

/** A monotonic fake clock so latency is deterministic (+5ms per read). */
function fakeClock(): () => number {
  let t = 1000;
  return () => (t += 5);
}

const baseOpts = {
  maxOutputTokens: 512,
  timeoutMs: 1000,
  now: fakeClock(),
};

describe("runModelWorkload (mock benchmark)", () => {
  it("captures one measurement per task, all valid, with non-null usage", async () => {
    const ms = await runModelWorkload(new MockAIProvider({ model: "mock-1" }), ESSENTIAL_TASKS, {
      ...baseOpts,
      pricing: null,
      now: fakeClock(),
    });
    expect(ms).toHaveLength(ESSENTIAL_TASKS.length);
    for (const m of ms) {
      expect(m.providerStatus).toBe("ok");
      expect(m.validOutput).toBe(true);
      expect(m.inputTokens).not.toBeNull();
      expect(m.outputTokens).not.toBeNull();
      expect(m.latencyMs).toBeGreaterThanOrEqual(0);
      expect(m.rawOutputSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("derives cost only when pricing is supplied; NULL otherwise", async () => {
    const priced = await runModelWorkload(new MockAIProvider(), ["research-summary"], {
      ...baseOpts,
      pricing: { inputPerMTok: 0.04, outputPerMTok: 0.08 },
      now: fakeClock(),
    });
    expect(typeof priced[0]!.costEstimate).toBe("number");

    const unpriced = await runModelWorkload(new MockAIProvider(), ["research-summary"], {
      ...baseOpts,
      pricing: null,
      now: fakeClock(),
    });
    expect(unpriced[0]!.costEstimate).toBeNull();
  });

  it("keeps cost NULL when usage is unavailable even if pricing is set (no fabricated 0)", async () => {
    const provider = new MockAIProvider({ reportUsage: false });
    const ms = await runModelWorkload(provider, ["research-summary"], {
      ...baseOpts,
      pricing: { inputPerMTok: 1, outputPerMTok: 1 },
      now: fakeClock(),
    });
    expect(ms[0]!.inputTokens).toBeNull();
    expect(ms[0]!.costEstimate).toBeNull();
  });

  it("records a provider-error measurement with null validity/cost", async () => {
    const provider = new StubProvider("stub-1", () =>
      Promise.reject(new AIProviderError("unavailable", "down")),
    );
    const ms = await runModelWorkload(provider, ["research-summary"], {
      ...baseOpts,
      pricing: { inputPerMTok: 1, outputPerMTok: 1 },
      maxRetries: 0,
      now: fakeClock(),
    });
    expect(ms[0]!.providerStatus).toBe("provider-error");
    expect(ms[0]!.validOutput).toBeNull();
    expect(ms[0]!.costEstimate).toBeNull();
    expect(ms[0]!.errorReason).toBe("unavailable");
  });

  it("marks malformed output invalid (never valid without validation)", async () => {
    const provider = new StubProvider("stub-1", () =>
      Promise.resolve({
        rawText: "not json at all",
        usage: UNKNOWN_USAGE,
        model: "stub-1",
        finishReason: "stop",
      }),
    );
    const ms = await runModelWorkload(provider, ["research-summary"], {
      ...baseOpts,
      pricing: null,
      maxRetries: 0,
      now: fakeClock(),
    });
    expect(ms[0]!.providerStatus).toBe("ok");
    expect(ms[0]!.validOutput).toBe(false);
    expect(ms[0]!.validationDetail).not.toBeNull();
  });
});

describe("aggregate", () => {
  it("summarises reliability and null-honest totals", async () => {
    const ms = await runModelWorkload(new MockAIProvider({ model: "mock-1" }), FULL_TASKS, {
      ...baseOpts,
      pricing: { inputPerMTok: 0.04, outputPerMTok: 0.08 },
      now: fakeClock(),
    });
    const agg = aggregate("mock-1", ms);
    expect(agg.taskCount).toBe(6);
    expect(agg.okCount).toBe(6);
    expect(agg.validCount).toBe(6);
    expect(agg.successRate).toBe(1);
    expect(agg.validRate).toBe(1);
    expect(agg.totalTokens).not.toBeNull();
    expect(agg.totalCost).not.toBeNull();
    expect(agg.avgLatencyMs).not.toBeNull();
  });

  it("returns a NULL total when any component is null", () => {
    const agg = aggregate("m", [
      {
        model: "m",
        task: "research-summary",
        promptVersion: "v1",
        inputTokens: 10,
        outputTokens: null,
        totalTokens: null,
        latencyMs: 5,
        providerStatus: "ok",
        retries: 0,
        validOutput: true,
        validationDetail: null,
        costEstimate: null,
        output: {},
        rawOutputSha256: null,
        errorReason: null,
      },
    ]);
    expect(agg.totalOutputTokens).toBeNull();
    expect(agg.totalCost).toBeNull();
    expect(agg.totalInputTokens).toBe(10);
  });
});

describe("cache identity (master prompt §15)", () => {
  it("same task/model/prompt/input → identical identity", () => {
    const a = cacheKeyString(cacheKeyParts("outcome-classification", "m", "v1"));
    const b = cacheKeyString(cacheKeyParts("outcome-classification", "m", "v1"));
    expect(a).toBe(b);
  });

  it("changing the model changes the identity", () => {
    const a = cacheKeyString(cacheKeyParts("outcome-classification", "model-a", "v1"));
    const b = cacheKeyString(cacheKeyParts("outcome-classification", "model-b", "v1"));
    expect(a).not.toBe(b);
  });

  it("changing the prompt version changes the identity", () => {
    const a = cacheKeyString(cacheKeyParts("outcome-classification", "m", "v1"));
    const b = cacheKeyString(cacheKeyParts("outcome-classification", "m", "v2"));
    expect(a).not.toBe(b);
  });

  it("changing the input changes the identity (input hash)", () => {
    const base = demoInputForTask("outcome-classification");
    const a = cacheKeyString(cacheKeyParts("outcome-classification", "m", "v1", base));
    const b = cacheKeyString(
      cacheKeyParts("outcome-classification", "m", "v1", { ...base, title: "different" }),
    );
    expect(a).not.toBe(b);
  });
});
