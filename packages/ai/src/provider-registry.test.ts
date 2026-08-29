/**
 * Provider-registry tests (ADR-019): configuration → provider resolution, unknown
 * provider / unregistered adapter failure, keyless local providers, required-secret
 * enforcement, secret non-exposure, and the env→provider path shared by the web
 * coordinator and the benchmark.
 */
import { describe, it, expect } from "vitest";
import {
  AIProviderRegistry,
  createDefaultRegistry,
  resolveProviderFromEnv,
} from "./provider-registry.js";
import { PROVIDER_PRESETS, makeModelConfig } from "./config.js";
import { MockAIProvider } from "./providers/mock.js";
import {
  OpenAICompatibleProvider,
  type FetchLike,
  type FetchLikeResponse,
} from "./providers/openai.js";
import { AIProviderError } from "./types.js";

const SECRET = "sk-super-secret-key-1234567890";

function spyFetch(): { fetch: FetchLike; headers: Record<string, string>[] } {
  const headers: Record<string, string>[] = [];
  const fetch: FetchLike = (_url, init) => {
    headers.push(init.headers);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "{}" } }] })),
    } as FetchLikeResponse);
  };
  return { fetch, headers };
}

describe("AIProviderRegistry.resolve", () => {
  it("resolves the mock provider with no key and no network", () => {
    const registry = createDefaultRegistry();
    const provider = registry.resolve({
      provider: PROVIDER_PRESETS.mock,
      model: makeModelConfig(PROVIDER_PRESETS.mock, "mock-1"),
    });
    expect(provider).toBeInstanceOf(MockAIProvider);
    expect(provider.id).toBe("mock");
  });

  it("resolves an OpenAI-compatible provider from a preset + model", () => {
    const { fetch } = spyFetch();
    const provider = createDefaultRegistry().resolve({
      provider: { ...PROVIDER_PRESETS.openrouter },
      model: makeModelConfig(PROVIDER_PRESETS.openrouter, "deepseek/x"),
      secretResolver: () => SECRET,
      fetch,
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.id).toBe("openrouter");
    expect(provider.modelId).toBe("deepseek/x");
    expect(provider.capabilities?.structuredOutput).toBe(true);
  });

  it("resolves a keyless local (Ollama) provider and sends no Authorization header", async () => {
    const { fetch, headers } = spyFetch();
    const provider = createDefaultRegistry().resolve({
      provider: PROVIDER_PRESETS.ollama,
      model: makeModelConfig(PROVIDER_PRESETS.ollama, "qwen3"),
      fetch,
    });
    await provider.complete({
      task: "outcome-classification",
      system: "S",
      userContent: "U",
      maxOutputTokens: 64,
      timeoutMs: 1000,
    });
    expect(headers[0]).not.toHaveProperty("Authorization");
  });

  it("fails closed when a required secret is missing (message names the ref, not a value)", () => {
    try {
      createDefaultRegistry().resolve({
        provider: PROVIDER_PRESETS.openrouter,
        model: makeModelConfig(PROVIDER_PRESETS.openrouter, "deepseek/x"),
        secretResolver: () => undefined,
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).reason).toBe("not-configured");
      expect((error as Error).message).toContain("AI_API_KEY"); // the NAME
      expect((error as Error).message).not.toContain(SECRET); // never the value
    }
  });

  it("fails clearly for an unregistered adapter type (e.g. DIRECT_API)", () => {
    const registry = new AIProviderRegistry(); // nothing registered
    expect(() =>
      registry.resolve({
        provider: {
          id: "gemini-native",
          displayName: "Gemini (native)",
          type: "DIRECT_API",
          baseUrl: null,
          secretRef: "AI_API_KEY",
          requiresSecret: true,
          allowLocalNetwork: false,
        },
        model: makeModelConfig(PROVIDER_PRESETS.openrouter, "gemini-x"),
      }),
    ).toThrow(/no adapter registered/);
  });

  it("rejects an OpenAI-compatible provider with a private base URL by default", () => {
    expect(() =>
      createDefaultRegistry().resolve({
        provider: { ...PROVIDER_PRESETS["openai-compatible"], baseUrl: "http://169.254.1.1/v1" },
        model: makeModelConfig(PROVIDER_PRESETS["openai-compatible"], "m"),
        secretResolver: () => SECRET,
      }),
    ).toThrow(AIProviderError);
  });
});

describe("resolveProviderFromEnv", () => {
  it("defaults to the mock provider when AI_PROVIDER is unset", () => {
    const resolved = resolveProviderFromEnv({});
    expect(resolved.provider.id).toBe("mock");
    expect(resolved.provider.modelId).toBe("mock-1");
    expect(resolved.pricing).toEqual({ inputPerMTok: null, outputPerMTok: null });
  });

  it("resolves a hosted provider from env and carries pricing through", () => {
    const { fetch } = spyFetch();
    const resolved = resolveProviderFromEnv(
      {
        AI_PROVIDER: "openrouter",
        AI_MODEL: "deepseek/deepseek-v4-flash-latest",
        AI_API_KEY: SECRET,
        AI_PRICE_INPUT_PER_MTOK: "0.04",
        AI_PRICE_OUTPUT_PER_MTOK: "0.08",
      },
      { fetch },
    );
    expect(resolved.provider.id).toBe("openrouter");
    expect(resolved.provider.modelId).toBe("deepseek/deepseek-v4-flash-latest");
    expect(resolved.pricing).toEqual({ inputPerMTok: 0.04, outputPerMTok: 0.08 });
  });

  it("rejects an unknown provider id (anonymous input can never invoke a provider)", () => {
    expect(() => resolveProviderFromEnv({ AI_PROVIDER: "evil-provider" })).toThrow(
      /unknown AI provider/,
    );
  });

  it("requires AI_MODEL for a non-mock provider", () => {
    expect(() => resolveProviderFromEnv({ AI_PROVIDER: "openrouter", AI_API_KEY: SECRET })).toThrow(
      /AI_MODEL is required/,
    );
  });

  it("supports a local provider via env with no key and a base-URL override", () => {
    const { fetch } = spyFetch();
    const resolved = resolveProviderFromEnv(
      { AI_PROVIDER: "ollama", AI_MODEL: "llama3", AI_BASE_URL: "http://localhost:11434/v1" },
      { fetch },
    );
    expect(resolved.provider.id).toBe("ollama");
    expect(resolved.provider.modelId).toBe("llama3");
  });
});
