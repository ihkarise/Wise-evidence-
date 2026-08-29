/**
 * Benchmark provider-config tests (ADR-019): the benchmark resolves its provider
 * through the shared registry and is NOT hard-coded to OpenRouter — it defaults to
 * OpenRouter but can target any configured backend, and sweeps model ids per call.
 */
import { describe, it, expect } from "vitest";
import { OpenAICompatibleProvider, MockAIProvider, type FetchLike } from "@wise-evidence/ai";
import { benchProvider } from "./provider-config.js";

const noopFetch: FetchLike = () =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });

describe("benchProvider", () => {
  it("defaults to OpenRouter and uses the per-model id (not AI_MODEL)", () => {
    const p = benchProvider({ AI_API_KEY: "sk-x" }, "deepseek/deepseek-v4-flash-latest", {
      fetch: noopFetch,
    });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.id).toBe("openrouter");
    expect(p.modelId).toBe("deepseek/deepseek-v4-flash-latest");
  });

  it("can target a different provider purely via configuration (Ollama, keyless)", () => {
    const p = benchProvider({ AI_PROVIDER: "ollama" }, "qwen3", { fetch: noopFetch });
    expect(p).toBeInstanceOf(OpenAICompatibleProvider);
    expect(p.id).toBe("ollama");
    expect(p.modelId).toBe("qwen3");
  });

  it("can target the mock provider for a fully offline benchmark", () => {
    const p = benchProvider({ AI_PROVIDER: "mock" }, "mock-1", { fetch: noopFetch });
    expect(p).toBeInstanceOf(MockAIProvider);
  });

  it("rejects an unknown provider id", () => {
    expect(() => benchProvider({ AI_PROVIDER: "nope" }, "m", { fetch: noopFetch })).toThrow(
      /unknown benchmark provider/,
    );
  });
});
