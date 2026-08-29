/**
 * Provider & model configuration (ADR-019; docs/29 §3, §4, §16).
 *
 * Provider and model are TWO different concepts and are modelled separately:
 *   - `ProviderConfig`  — WHERE and HOW to reach a backend (type, base URL,
 *     which SECRET to use — by reference, never the value, network policy).
 *   - `ModelConfig`     — WHICH model to run there and WHAT it can do
 *     (capabilities, pricing). A model id is never used as provider identity.
 *
 * Nothing here holds a raw API key. Configuration carries a `secretRef` (the NAME
 * of an environment variable / secret-manager entry); the actual secret is
 * resolved server-side by a `SecretResolver` at construction time and never
 * persisted, logged, or sent to the browser (docs/29 §4, ADR-019 "Secret
 * management").
 *
 * Pure: no network, no provider, no DB. `validateBaseUrl` performs config-time
 * SSRF hardening because a configurable base URL is otherwise a fetch-anywhere
 * primitive — but base URLs remain TRUSTED operator configuration, never user
 * input (ADR-019 "Security").
 */
import type { AIPricing } from "./cost.js";
import {
  LOCAL_MODEL_CAPABILITIES,
  MOCK_CAPABILITIES,
  OPENAI_COMPATIBLE_CAPABILITIES,
  type AICapabilities,
} from "./capabilities.js";
import { AIProviderError } from "./types.js";

/**
 * The provider families the architecture recognises (ADR-019). The runtime adapter
 * is chosen from this, NOT from a vendor name:
 *   - OPENAI_COMPATIBLE — any server speaking the OpenAI chat-completions API
 *     (OpenRouter, vLLM, a self-hosted gateway). Uses `OpenAICompatibleProvider`.
 *   - LOCAL             — a locally-hosted OpenAI-compatible server (Ollama, LM
 *     Studio). Same adapter; distinguished for network policy and key-optionality.
 *   - DIRECT_API        — a vendor whose wire format differs materially (Gemini,
 *     Anthropic native). No adapter ships today; the registry fails clearly until
 *     one is registered, proving the seam without adding a paid SDK.
 *   - MOCK              — the deterministic offline provider (CI default).
 */
export type AIProviderType = "OPENAI_COMPATIBLE" | "DIRECT_API" | "LOCAL" | "MOCK";

/** WHERE/HOW to reach a provider. Never contains a secret value — only a ref. */
export interface ProviderConfig {
  /** Stable provider id (provenance + registry key), e.g. "openrouter", "ollama". */
  readonly id: string;
  readonly displayName: string;
  readonly type: AIProviderType;
  /** OpenAI-compatible base URL. `null` for MOCK and for DIRECT_API defaults. */
  readonly baseUrl: string | null;
  /** NAME of the env/secret entry holding the key — never the key itself. */
  readonly secretRef: string | null;
  /** Whether a secret is mandatory (hosted APIs: yes; local servers: no). */
  readonly requiresSecret: boolean;
  /** Whether a private/loopback/`http:` base URL is permitted (local dev only). */
  readonly allowLocalNetwork: boolean;
}

/** WHICH model to run and WHAT it supports. */
export interface ModelConfig {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string | null;
  readonly capabilities: AICapabilities;
  /** Operator-supplied pricing, or `null` when unknown — never assumed zero. */
  readonly pricing: AIPricing | null;
  readonly enabled: boolean;
}

/**
 * Built-in provider PRESETS (thin configuration profiles, ADR-019). They exist so
 * one adapter can represent many backends WITHOUT duplicating code or hard-coding
 * a base URL as an application assumption. An operator selects a preset by id and
 * may override its base URL and model. `secretRef` names an env var; the value is
 * resolved server-side.
 */
export const PROVIDER_PRESETS = {
  mock: {
    id: "mock",
    displayName: "Mock (offline, deterministic)",
    type: "MOCK",
    baseUrl: null,
    secretRef: null,
    requiresSecret: false,
    allowLocalNetwork: false,
  },
  "openai-compatible": {
    id: "openai-compatible",
    displayName: "Generic OpenAI-compatible",
    type: "OPENAI_COMPATIBLE",
    baseUrl: null, // operator MUST supply AI_BASE_URL
    secretRef: "AI_API_KEY",
    requiresSecret: true,
    allowLocalNetwork: false,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    type: "OPENAI_COMPATIBLE",
    baseUrl: "https://openrouter.ai/api/v1",
    secretRef: "AI_API_KEY",
    requiresSecret: true,
    allowLocalNetwork: false,
  },
  ollama: {
    id: "ollama",
    displayName: "Ollama (local)",
    type: "LOCAL",
    baseUrl: "http://localhost:11434/v1",
    secretRef: null,
    requiresSecret: false,
    allowLocalNetwork: true,
  },
  lmstudio: {
    id: "lmstudio",
    displayName: "LM Studio (local)",
    type: "LOCAL",
    baseUrl: "http://localhost:1234/v1",
    secretRef: null,
    requiresSecret: false,
    allowLocalNetwork: true,
  },
  vllm: {
    id: "vllm",
    displayName: "vLLM (self-hosted)",
    type: "OPENAI_COMPATIBLE",
    baseUrl: null, // operator supplies the server URL
    secretRef: "AI_API_KEY",
    requiresSecret: false, // often keyless behind a private network
    allowLocalNetwork: true,
  },
} satisfies Record<string, ProviderConfig>;

/** Look up a preset by id (case-insensitive). Returns null when unknown. */
export function getPreset(id: string | null | undefined): ProviderConfig | null {
  if (!id) return null;
  return (PROVIDER_PRESETS as Record<string, ProviderConfig>)[id.trim().toLowerCase()] ?? null;
}

/** Default capabilities for a provider type when a model does not declare them. */
export function defaultCapabilitiesForType(type: AIProviderType): AICapabilities {
  switch (type) {
    case "MOCK":
      return MOCK_CAPABILITIES;
    case "LOCAL":
      return LOCAL_MODEL_CAPABILITIES;
    case "OPENAI_COMPATIBLE":
    case "DIRECT_API":
      return OPENAI_COMPATIBLE_CAPABILITIES;
  }
}

/** Build a `ModelConfig`, filling capabilities from the provider type by default. */
export function makeModelConfig(
  provider: ProviderConfig,
  modelId: string,
  overrides: Partial<Omit<ModelConfig, "providerId" | "modelId">> = {},
): ModelConfig {
  return {
    providerId: provider.id,
    modelId,
    displayName: overrides.displayName ?? null,
    capabilities: overrides.capabilities ?? defaultCapabilitiesForType(provider.type),
    pricing: overrides.pricing ?? null,
    enabled: overrides.enabled ?? true,
  };
}

// --- secret references -------------------------------------------------------

/** Resolves a secret NAME to its value, server-side only. */
export type SecretResolver = (ref: string) => string | undefined;

/** A `SecretResolver` backed by a plain env record (server-side). */
export function envSecretResolver(env: Record<string, string | undefined>): SecretResolver {
  return (ref) => {
    const v = env[ref];
    return v === undefined || v.trim().length === 0 ? undefined : v;
  };
}

// --- base-URL SSRF hardening -------------------------------------------------

/**
 * Validate a provider base URL (ADR-019 "Security"). Base URLs are trusted
 * operator configuration, but a configurable URL is a fetch-anywhere primitive,
 * so we still enforce:
 *   - scheme is http or https;
 *   - `http:` and private/loopback hosts are allowed ONLY when the provider
 *     config opts in (`allowLocalNetwork`, i.e. Ollama/LM Studio/vLLM in dev);
 *   - no embedded credentials in the URL.
 * Returns the normalised origin+path (trailing slash trimmed). Throws a safe
 * `not-configured` error otherwise. NEVER call this with an anonymous user's URL —
 * only with operator configuration.
 */
export function validateBaseUrl(raw: string, allowLocalNetwork: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AIProviderError("not-configured", "AI base URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AIProviderError("not-configured", "AI base URL must use http or https");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new AIProviderError("not-configured", "AI base URL must not embed credentials");
  }
  const host = url.hostname.toLowerCase();
  const isLocal = isPrivateHost(host);
  if (url.protocol === "http:" && !(isLocal && allowLocalNetwork)) {
    throw new AIProviderError(
      "not-configured",
      "AI base URL must use https unless it is a permitted local endpoint",
    );
  }
  if (isLocal && !allowLocalNetwork) {
    throw new AIProviderError(
      "not-configured",
      "AI base URL resolves to a private/loopback host, which this provider does not permit",
    );
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * Heuristic private/loopback host detector (ADR-019). Covers localhost, IPv4
 * loopback/private/link-local ranges, IPv6 loopback, and `.local`/`.internal`
 * names. Not exhaustive DNS resolution — a coarse policy gate for the config-time
 * check; production should also pin allowed hosts at the network layer.
 */
export function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host === "0.0.0.0") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 169 && b === 254) return true; // link-local
  }
  return false;
}
