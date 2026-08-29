/**
 * OpenAICompatibleProvider — the real provider (docs/29 §3.1, §4, §20).
 *
 * Written against the generic OpenAI-compatible chat-completions contract (a
 * base URL + API key + model). It is NOT hard-coded to OpenRouter; OpenRouter is
 * merely one compatible endpoint to be used later, in a secure environment, for
 * the M6.1 benchmark. `fetch` is INJECTED, so the provider is fully unit-testable
 * with fake responses and never needs a live network call in CI.
 *
 * Security posture:
 *   - constructed only server-side; the API key lives only in the Authorization
 *     header and is NEVER placed in an error message, log line, or result;
 *   - timeout-bounded (AbortController) and response-size-bounded;
 *   - the model output is UNTRUSTED and is validated by the caller before it is
 *     ever persisted as VALID.
 */
import { OPENAI_COMPATIBLE_CAPABILITIES, type AICapabilities } from "../capabilities.js";
import {
  AIProviderError,
  UNKNOWN_USAGE,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProvider,
  type AIUsage,
} from "../types.js";

/** Minimal fetch signature so the provider does not depend on DOM lib types. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect?: "error" | "follow" | "manual";
  },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface OpenAICompatibleOptions {
  readonly fetch: FetchLike;
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1. Server-only. */
  readonly baseUrl: string;
  /**
   * API key. Server-only; never exposed to the browser or persisted. OPTIONAL:
   * local/self-hosted OpenAI-compatible servers (Ollama, LM Studio, a private
   * vLLM) often need no key — when absent, no Authorization header is sent
   * (ADR-019 "Ollama"). Hosted providers must supply one via configuration.
   */
  readonly apiKey?: string;
  /** Model id, e.g. a cheap hosted model. */
  readonly model: string;
  /** Request timeout in ms (default 30000). */
  readonly timeoutMs?: number;
  /** Maximum response body size in bytes (default 256 KiB). */
  readonly maxBytes?: number;
  /** Stable provider id for provenance. Default "openai-compatible". */
  readonly providerId?: string;
  /** Declared model capabilities (ADR-019). Default: OpenAI-compatible defaults. */
  readonly capabilities?: AICapabilities;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 256 * 1024;

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: AICapabilities;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;
  readonly #apiKey: string | undefined;
  readonly #model: string;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  constructor(options: OpenAICompatibleOptions) {
    // baseUrl + model are always required; the API key is OPTIONAL so the same
    // adapter can drive a keyless local server (ADR-019).
    if (!options.baseUrl || !options.model) {
      throw new AIProviderError("not-configured", "baseUrl and model are required");
    }
    this.id = options.providerId ?? "openai-compatible";
    this.modelId = options.model;
    this.capabilities = options.capabilities ?? OPENAI_COMPATIBLE_CAPABILITIES;
    this.#fetch = options.fetch;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey && options.apiKey.length > 0 ? options.apiKey : undefined;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    const url = `${this.#baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.#model,
      temperature: 0,
      max_tokens: request.maxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.userContent },
      ],
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    // Only send Authorization when a key is configured (keyless local servers).
    if (this.#apiKey !== undefined) {
      headers.Authorization = `Bearer ${this.#apiKey}`;
    }

    let response: FetchLikeResponse;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });
    } catch (error) {
      const aborted =
        error instanceof Error && (error.name === "AbortError" || controller.signal.aborted);
      throw aborted
        ? new AIProviderError("timeout", "request timed out")
        : new AIProviderError("network", "network failure contacting the AI provider");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw this.#statusError(response.status);
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch {
      throw new AIProviderError("network", "failed to read the AI provider response");
    }
    // Cap by UTF-8 byte length after reading (test fakes have no stream).
    if (new TextEncoder().encode(rawBody).byteLength > this.#maxBytes) {
      throw new AIProviderError("too-large", "AI provider response exceeded the size budget");
    }

    return this.#parseEnvelope(rawBody);
  }

  #statusError(status: number): AIProviderError {
    if (status === 401 || status === 403) {
      return new AIProviderError("unauthorized", "AI provider rejected the credentials");
    }
    if (status === 429) {
      return new AIProviderError("rate-limited", "AI provider rate limit reached");
    }
    if (status >= 500) {
      return new AIProviderError("unavailable", `AI provider unavailable (HTTP ${status})`);
    }
    return new AIProviderError("bad-response", `unexpected AI provider status ${status}`);
  }

  /** Parse the OpenAI-compatible chat-completions envelope. Never trusts content. */
  #parseEnvelope(rawBody: string): AICompletionResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AIProviderError("bad-response", "AI provider returned non-JSON");
    }
    const choices = getProp(parsed, "choices");
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new AIProviderError("bad-response", "AI provider response had no choices");
    }
    const message = getProp(choices[0], "message");
    const content = getProp(message, "content");
    if (typeof content !== "string") {
      throw new AIProviderError("bad-response", "AI provider choice had no text content");
    }
    const finishReason = asStringOrNull(getProp(choices[0], "finish_reason"));
    const model = asStringOrNull(getProp(parsed, "model")) ?? this.#model;
    return {
      rawText: content,
      usage: extractUsage(getProp(parsed, "usage")),
      model,
      finishReason,
    };
  }
}

/**
 * Extract token usage. A field the provider does not report stays NULL — never
 * zero (docs/29 §14). If the whole usage object is absent, all fields are null.
 */
function extractUsage(usage: unknown): AIUsage {
  if (usage === null || typeof usage !== "object") return UNKNOWN_USAGE;
  return {
    inputTokens: asIntOrNull(getProp(usage, "prompt_tokens")),
    outputTokens: asIntOrNull(getProp(usage, "completion_tokens")),
    totalTokens: asIntOrNull(getProp(usage, "total_tokens")),
  };
}

// --- defensive accessors for untrusted parsed JSON ---------------------------

function getProp(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}
function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function asIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
