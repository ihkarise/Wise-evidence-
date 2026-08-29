/**
 * Provider/model configuration tests (ADR-019): presets, model configuration,
 * secret references (never values), and base-URL SSRF policy.
 */
import { describe, it, expect } from "vitest";
import {
  PROVIDER_PRESETS,
  getPreset,
  makeModelConfig,
  validateBaseUrl,
  isPrivateHost,
  envSecretResolver,
  defaultCapabilitiesForType,
} from "./config.js";
import { AIProviderError } from "./types.js";

describe("provider presets", () => {
  it("model and provider are separate concepts: a preset carries no model id", () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(preset).not.toHaveProperty("modelId");
      expect(preset).not.toHaveProperty("model");
    }
  });

  it("presets never embed a secret value — only a secretRef name", () => {
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      expect(preset).not.toHaveProperty("apiKey");
      expect(preset).not.toHaveProperty("secret");
      // secretRef, when present, is an env-var NAME, not a secret.
      if (preset.secretRef !== null) {
        expect(preset.secretRef).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });

  it("openrouter and ollama are distinct backends of the same adapter family", () => {
    expect(getPreset("openrouter")?.type).toBe("OPENAI_COMPATIBLE");
    expect(getPreset("openrouter")?.requiresSecret).toBe(true);
    expect(getPreset("ollama")?.type).toBe("LOCAL");
    expect(getPreset("ollama")?.requiresSecret).toBe(false);
    expect(getPreset("ollama")?.baseUrl).toContain("11434");
  });

  it("is case-insensitive and returns null for unknown ids", () => {
    expect(getPreset("OpenRouter")?.id).toBe("openrouter");
    expect(getPreset("does-not-exist")).toBeNull();
    expect(getPreset(undefined)).toBeNull();
  });
});

describe("model configuration", () => {
  it("fills capabilities from the provider type by default", () => {
    const local = makeModelConfig(PROVIDER_PRESETS.ollama, "qwen3");
    expect(local.modelId).toBe("qwen3");
    expect(local.providerId).toBe("ollama");
    expect(local.capabilities).toEqual(defaultCapabilitiesForType("LOCAL"));
    expect(local.pricing).toBeNull(); // local → unknown, never zero
  });

  it("keeps operator pricing when supplied", () => {
    const m = makeModelConfig(PROVIDER_PRESETS.openrouter, "deepseek/x", {
      pricing: { inputPerMTok: 0.04, outputPerMTok: 0.08 },
    });
    expect(m.pricing).toEqual({ inputPerMTok: 0.04, outputPerMTok: 0.08 });
  });
});

describe("secret resolver", () => {
  it("resolves a ref to a value and treats blank as missing", () => {
    const resolve = envSecretResolver({ AI_API_KEY: "sk-x", BLANK: "  " });
    expect(resolve("AI_API_KEY")).toBe("sk-x");
    expect(resolve("BLANK")).toBeUndefined();
    expect(resolve("ABSENT")).toBeUndefined();
  });
});

describe("base-URL SSRF policy", () => {
  it("accepts https public URLs and normalises the trailing slash", () => {
    expect(validateBaseUrl("https://openrouter.ai/api/v1/", false)).toBe(
      "https://openrouter.ai/api/v1",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => validateBaseUrl("file:///etc/passwd", true)).toThrow(AIProviderError);
    expect(() => validateBaseUrl("ftp://host/x", true)).toThrow(AIProviderError);
  });

  it("rejects embedded credentials", () => {
    expect(() => validateBaseUrl("https://user:pass@host/v1", false)).toThrow(/credentials/);
  });

  it("blocks http and private hosts unless local network is permitted", () => {
    expect(() => validateBaseUrl("http://localhost:11434/v1", false)).toThrow(AIProviderError);
    expect(() => validateBaseUrl("https://127.0.0.1/v1", false)).toThrow(/private|loopback/);
    // Permitted for a local provider:
    expect(validateBaseUrl("http://localhost:11434/v1", true)).toBe("http://localhost:11434/v1");
    expect(validateBaseUrl("http://192.168.1.9:1234/v1", true)).toBe("http://192.168.1.9:1234/v1");
  });

  it("classifies private/loopback/link-local hosts", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.0.0.1",
      "192.168.0.2",
      "172.16.5.5",
      "169.254.1.1",
      "::1",
      "0.0.0.0",
      "svc.local",
    ]) {
      expect(isPrivateHost(h)).toBe(true);
    }
    for (const h of ["openrouter.ai", "8.8.8.8", "172.32.0.1", "example.com"]) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});
