/**
 * Provider health + fallback provenance tests (ADR-019). Health is category-only
 * (no secrets); fallback metadata records both provider/model identities.
 */
import { describe, it, expect } from "vitest";
import { healthStatusFromReason, healthy, type FallbackRecord } from "./health.js";

describe("provider health", () => {
  it("maps error reasons to safe health categories", () => {
    expect(healthStatusFromReason("unauthorized")).toBe("authentication_error");
    expect(healthStatusFromReason("timeout")).toBe("timeout");
    expect(healthStatusFromReason("rate-limited")).toBe("rate_limited");
    expect(healthStatusFromReason("unavailable")).toBe("unavailable");
    expect(healthStatusFromReason("unsupported-capability")).toBe("unsupported_capability");
    expect(healthStatusFromReason("network")).toBe("provider_error");
    expect(healthStatusFromReason("bad-response")).toBe("provider_error");
    expect(healthStatusFromReason("not-configured")).toBe("provider_error");
  });

  it("healthy() carries only ids and a null detail", () => {
    const h = healthy("openrouter", "deepseek/x");
    expect(h).toEqual({
      providerId: "openrouter",
      modelId: "deepseek/x",
      status: "available",
      detail: null,
    });
  });
});

describe("fallback provenance", () => {
  it("records original and fallback provider/model plus a safe reason", () => {
    const record: FallbackRecord = {
      originalProviderId: "openrouter",
      originalModelId: "deepseek/x",
      fallbackProviderId: "ollama",
      fallbackModelId: "qwen3",
      reason: "unavailable",
    };
    // Both identities are preserved so a reviewer can see exactly what produced a
    // suggestion — a different model can classify differently.
    expect(record.originalModelId).not.toBe(record.fallbackModelId);
    expect(record.reason).toBe("unavailable");
  });
});
