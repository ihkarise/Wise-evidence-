/**
 * AI provider registry (ADR-019; docs/29 §3, §4).
 *
 * The registry is the single place that turns CONFIGURATION into a provider
 * instance. It maps a `ProviderConfig.type` to an adapter FACTORY, validates the
 * configuration (base URL, required secret, adapter availability), resolves the
 * secret by reference server-side, and returns an `AIProvider`. The orchestrator
 * and coordinator ask the registry for a provider — they never `new` a vendor
 * adapter, and they never learn whether the request went to OpenRouter, Ollama,
 * vLLM, or a mock.
 *
 * Fail-closed: an unknown provider type (e.g. DIRECT_API before a native adapter
 * ships) or missing required configuration yields a typed `not-configured` error
 * with a SAFE message (secret NAMES may appear; secret VALUES never do).
 *
 * Pure with respect to the DB and network: constructing a provider performs no I/O
 * (the first network call happens only when the provider is actually used).
 */
import {
  PROVIDER_PRESETS,
  getPreset,
  makeModelConfig,
  validateBaseUrl,
  envSecretResolver,
  type AIProviderType,
  type ModelConfig,
  type ProviderConfig,
  type SecretResolver,
} from "./config.js";
import { parsePricing, type AIPricing } from "./cost.js";
import { MockAIProvider } from "./providers/mock.js";
import { OpenAICompatibleProvider, type FetchLike } from "./providers/openai.js";
import { AIProviderError, type AIProvider } from "./types.js";

/** Everything an adapter factory needs to construct one provider instance. */
export interface ProviderFactoryContext {
  readonly provider: ProviderConfig;
  readonly model: ModelConfig;
  /** Resolved secret value (server-side) or undefined for keyless providers. */
  readonly apiKey: string | undefined;
  /** Validated base URL (non-mock), or null for MOCK. */
  readonly baseUrl: string | null;
  readonly fetch: FetchLike;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/** Builds a provider instance from validated configuration. No I/O. */
export type ProviderFactory = (ctx: ProviderFactoryContext) => AIProvider;

export interface ResolveSpec {
  readonly provider: ProviderConfig;
  readonly model: ModelConfig;
  /** Resolves `provider.secretRef` server-side. Omit for keyless/mock. */
  readonly secretResolver?: SecretResolver;
  /** Injected fetch for OpenAI-compatible adapters (unused by MOCK). */
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

export class AIProviderRegistry {
  readonly #factories = new Map<AIProviderType, ProviderFactory>();

  /** Register (or replace) the adapter factory for a provider type. */
  register(type: AIProviderType, factory: ProviderFactory): this {
    this.#factories.set(type, factory);
    return this;
  }

  /** Whether an adapter is registered for a provider type. */
  hasFactory(type: AIProviderType): boolean {
    return this.#factories.has(type);
  }

  /**
   * Validate configuration and build the provider instance. Throws a safe
   * `not-configured` error when no adapter is registered for the type, when a
   * required base URL/secret is missing, or when the base URL fails SSRF policy.
   */
  resolve(spec: ResolveSpec): AIProvider {
    const { provider, model } = spec;
    const factory = this.#factories.get(provider.type);
    if (factory === undefined) {
      throw new AIProviderError(
        "not-configured",
        `no adapter registered for provider type ${provider.type} (provider '${provider.id}')`,
      );
    }

    let baseUrl: string | null = null;
    if (provider.type !== "MOCK") {
      if (!provider.baseUrl) {
        throw new AIProviderError(
          "not-configured",
          `provider '${provider.id}' requires a base URL`,
        );
      }
      baseUrl = validateBaseUrl(provider.baseUrl, provider.allowLocalNetwork);
    }

    let apiKey: string | undefined;
    if (provider.secretRef !== null) {
      apiKey = spec.secretResolver?.(provider.secretRef);
    }
    if (provider.requiresSecret && (apiKey === undefined || apiKey.length === 0)) {
      throw new AIProviderError(
        "not-configured",
        // secretRef is a variable NAME, never the value — safe to include.
        `provider '${provider.id}' requires secret ${provider.secretRef ?? "(unset)"}`,
      );
    }

    return factory({
      provider,
      model,
      apiKey,
      baseUrl,
      fetch: spec.fetch ?? (globalThis.fetch as unknown as FetchLike),
      timeoutMs: spec.timeoutMs,
      maxBytes: spec.maxBytes,
    });
  }
}

/** The MOCK adapter factory — offline, deterministic, no key, no network. */
export const mockFactory: ProviderFactory = (ctx) =>
  new MockAIProvider({ model: ctx.model.modelId });

/** The OpenAI-compatible adapter factory (also drives LOCAL servers). */
export const openAICompatibleFactory: ProviderFactory = (ctx) => {
  if (ctx.baseUrl === null) {
    throw new AIProviderError("not-configured", "OpenAI-compatible provider requires a base URL");
  }
  return new OpenAICompatibleProvider({
    fetch: ctx.fetch,
    baseUrl: ctx.baseUrl,
    apiKey: ctx.apiKey,
    model: ctx.model.modelId,
    providerId: ctx.provider.id,
    capabilities: ctx.model.capabilities,
    timeoutMs: ctx.timeoutMs,
    maxBytes: ctx.maxBytes,
  });
};

/**
 * A registry pre-registered with the shipped adapters: MOCK, OPENAI_COMPATIBLE,
 * and LOCAL (LOCAL reuses the OpenAI-compatible adapter). DIRECT_API is
 * intentionally NOT registered — resolving a DIRECT_API provider fails clearly
 * until a native adapter is added, without any code change to the orchestrator.
 */
export function createDefaultRegistry(): AIProviderRegistry {
  return new AIProviderRegistry()
    .register("MOCK", mockFactory)
    .register("OPENAI_COMPATIBLE", openAICompatibleFactory)
    .register("LOCAL", openAICompatibleFactory);
}

/** The fully-resolved provider plus the configuration that produced it. */
export interface ResolvedProvider {
  readonly provider: AIProvider;
  readonly providerConfig: ProviderConfig;
  readonly modelConfig: ModelConfig;
  readonly pricing: AIPricing | null;
}

/**
 * Resolve a provider from an environment record via the built-in presets
 * (ADR-019 "Provider configuration"). This is the single env→provider path shared
 * by the web coordinator and the benchmark, so switching providers is purely a
 * configuration change:
 *
 *   AI_PROVIDER   preset id (default "mock"): mock | openrouter | ollama |
 *                 lmstudio | vllm | openai-compatible
 *   AI_BASE_URL   overrides the preset base URL (required for presets with none)
 *   AI_MODEL      model id (required for every non-mock provider)
 *   AI_API_KEY    secret VALUE, read server-side via the preset's secretRef
 *   AI_PRICE_*    optional operator pricing (absent → cost null)
 *
 * Unknown provider ids and missing required configuration fail closed.
 */
export function resolveProviderFromEnv(
  env: Record<string, string | undefined>,
  options: { readonly fetch?: FetchLike; readonly registry?: AIProviderRegistry } = {},
): ResolvedProvider {
  const registry = options.registry ?? createDefaultRegistry();
  const id = (env.AI_PROVIDER ?? "mock").trim() || "mock";
  const preset = getPreset(id);
  if (preset === null) {
    throw new AIProviderError(
      "not-configured",
      `unknown AI provider '${id}' (known: ${Object.keys(PROVIDER_PRESETS).join(", ")})`,
    );
  }

  const baseUrl = (env.AI_BASE_URL ?? "").trim() || preset.baseUrl;
  const providerConfig: ProviderConfig = { ...preset, baseUrl };

  const modelId = (env.AI_MODEL ?? "").trim() || (preset.type === "MOCK" ? "mock-1" : "");
  if (preset.type !== "MOCK" && modelId.length === 0) {
    throw new AIProviderError("not-configured", `AI_MODEL is required for provider '${id}'`);
  }

  const pricing = parsePricing(env.AI_PRICE_INPUT_PER_MTOK, env.AI_PRICE_OUTPUT_PER_MTOK);
  const modelConfig = makeModelConfig(providerConfig, modelId, { pricing });

  const timeoutRaw = Number(env.AI_REQUEST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;

  const provider = registry.resolve({
    provider: providerConfig,
    model: modelConfig,
    secretResolver: envSecretResolver(env),
    fetch: options.fetch,
    timeoutMs,
  });

  return { provider, providerConfig, modelConfig, pricing };
}
