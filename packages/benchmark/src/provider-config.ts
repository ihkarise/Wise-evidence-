/**
 * Benchmark provider configuration (ADR-019; M6.1 master prompt §8, §11).
 *
 * The benchmark measures ONE model at a time under identical conditions, with the
 * model as the only variable. It must not be hard-coded to OpenRouter: which
 * backend it drives is configuration. `benchProvider` resolves a benchmark
 * provider for a given model id through the SAME provider-agnostic registry the
 * web coordinator uses (`@wise-evidence/ai`), so a run can target OpenRouter, a
 * self-hosted OpenAI-compatible server, Ollama, or the mock purely via env:
 *
 *   AI_PROVIDER   preset id (default "openrouter" for the M6.1 benchmark):
 *                 openrouter | openai-compatible | ollama | lmstudio | vllm | mock
 *   AI_BASE_URL   overrides the preset base URL
 *   AI_API_KEY    server-side secret (hosted providers)
 *
 * The model id comes from the candidate list (per model), NOT from AI_MODEL, so a
 * single run can sweep many models against one provider.
 */
import {
  createDefaultRegistry,
  envSecretResolver,
  getPreset,
  makeModelConfig,
  AIProviderError,
  type AIPricing,
  type AIProvider,
  type FetchLike,
} from "@wise-evidence/ai";

export interface BenchProviderOptions {
  readonly fetch: FetchLike;
  /** Verified pricing for this model, or null → cost stays null. */
  readonly pricing?: AIPricing | null;
  readonly timeoutMs?: number;
}

/**
 * Build a benchmark provider for `modelId` from the env-selected preset. Fails
 * closed on an unknown provider or a preset that needs a base URL none was given.
 * The M6.1 benchmark defaults to the "openrouter" preset when AI_PROVIDER is unset.
 */
export function benchProvider(
  env: Record<string, string | undefined>,
  modelId: string,
  options: BenchProviderOptions,
): AIProvider {
  const presetId = (env.AI_PROVIDER ?? "openrouter").trim() || "openrouter";
  const preset = getPreset(presetId);
  if (preset === null) {
    throw new AIProviderError("not-configured", `unknown benchmark provider '${presetId}'`);
  }
  const baseUrl = (env.AI_BASE_URL ?? "").trim() || preset.baseUrl;
  const providerConfig = { ...preset, baseUrl };
  const modelConfig = makeModelConfig(providerConfig, modelId, {
    pricing: options.pricing ?? null,
  });

  return createDefaultRegistry().resolve({
    provider: providerConfig,
    model: modelConfig,
    secretResolver: envSecretResolver(env),
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  });
}
