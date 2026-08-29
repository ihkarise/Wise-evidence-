/**
 * Core AI-subsystem contracts (docs/29 §3, §5; ADR-017).
 *
 * This module is provider- and framework-independent: no Astro, React, Supabase,
 * database, or provider-SDK imports, and no I/O. It defines the swappable
 * `AIProvider` boundary, the six task identities, and shared limits.
 *
 * The overriding rule (docs/29 §1): AI is a SUGGESTION ENGINE, never an
 * authority. Nothing in this package writes canonical data, publishes, or has any
 * database privilege — it only produces validated suggestions for a human to
 * accept, edit, or reject.
 */

/**
 * The six approved enrichment tasks (docs/10 §5, docs/29 §5). This list is
 * closed: adding a task requires an architecture change (a new prompt, schema,
 * and ADR). The string values are the stable task identifiers stored on
 * `ai_job.operation` and used in the cache key.
 */
export const AI_TASKS = [
  "research-summary",
  "outcome-classification",
  "evidence-quality",
  "criticism-extraction",
  "metadata-extraction",
  "duplicate-detection",
] as const;
export type AITaskId = (typeof AI_TASKS)[number];

/** Type guard: is `value` one of the six approved task ids? */
export function isAiTask(value: unknown): value is AITaskId {
  return typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);
}

/**
 * Token usage as reported by a provider. Each field is `null` when the provider
 * does not report it — NEVER zero (docs/29 §14). Zero is a real measurement.
 */
export interface AIUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

/** A usage object with everything unknown — the honest default. */
export const UNKNOWN_USAGE: AIUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
};

/**
 * A single provider completion request. `system` is TRUSTED task instruction
 * text (from the prompt registry); `userContent` is UNTRUSTED research data,
 * already delimiter-wrapped by the orchestrator (docs/29 §10). A provider must
 * treat `userContent` as data and must never fetch a URL found inside it.
 */
export interface AICompletionRequest {
  readonly task: AITaskId;
  readonly system: string;
  readonly userContent: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

/**
 * A raw provider completion. `rawText` is UNTRUSTED model output and MUST be
 * validated before it is persisted as VALID (docs/29 §11). `usage`/`model` are
 * provenance; `model` is what the provider actually served.
 */
export interface AICompletionResponse {
  readonly rawText: string;
  readonly usage: AIUsage;
  readonly model: string;
  readonly finishReason: string | null;
}

/** Machine-readable provider failure reason (never leaks secrets — docs/29 §18). */
export type AIProviderErrorReason =
  | "timeout" // request exceeded the time budget
  | "rate-limited" // provider signalled 429 / rate limit
  | "unavailable" // provider 5xx / service down
  | "unauthorized" // provider rejected credentials (config problem)
  | "too-large" // response exceeded the byte budget
  | "network" // transport failure
  | "bad-response" // unparseable / unexpected provider envelope
  | "unsupported-capability" // model cannot satisfy a required task capability
  | "not-configured"; // provider missing required configuration

/**
 * A typed provider error. The `detail` is safe, non-secret text for operational
 * logs/UI — it never contains an API key, base URL credential, or raw payload.
 */
export class AIProviderError extends Error {
  readonly reason: AIProviderErrorReason;
  constructor(reason: AIProviderErrorReason, message: string) {
    super(message);
    this.name = "AIProviderError";
    this.reason = reason;
  }
}

/**
 * A swappable AI provider (docs/29 §3, ADR-005, ADR-019). This is the STABLE,
 * application-facing contract: the orchestrator, coordinator, and benchmark depend
 * on it and never on OpenRouter/OpenAI/Gemini/Ollama specifics. Implementations:
 *   - `MockAIProvider` — deterministic, offline, the dev/CI default;
 *   - `OpenAICompatibleProvider` — any OpenAI-compatible endpoint (OpenRouter,
 *     Ollama, vLLM, LM Studio, a self-hosted server), selected purely by
 *     configuration, constructed only server-side, with an injected `fetch`.
 * A future DIRECT_API adapter (Gemini/Anthropic native) implements this same
 * interface, so it can be added without changing the orchestrator (ADR-019).
 * The application and domain never import a provider SDK — only this interface.
 */
export interface AIProvider {
  /** Stable provider id stored as provenance on `ai_job.provider`. */
  readonly id: string;
  /**
   * The model id this provider will use — part of the cache key and stored on
   * `ai_job.model`. Known up front (before the call) so the cache can be checked
   * without contacting the provider.
   */
  readonly modelId: string;
  /**
   * Declared model capabilities (ADR-019). Optional so a minimal test double need
   * not supply them; when present, the orchestrator negotiates required task
   * capabilities against it before calling the model. The type is
   * `AICapabilities` (see `capabilities.ts`); kept structural here to avoid a
   * circular import.
   */
  readonly capabilities?: {
    readonly structuredOutput: boolean;
    readonly jsonSchema: boolean;
    readonly toolCalling: boolean;
    readonly vision: boolean;
    readonly maxContextTokens: number | null;
    readonly maxOutputTokens: number | null;
  };
  /**
   * Produce a completion. Implementations throw `AIProviderError` for the
   * expected failure cases (timeout, rate limit, unavailable, …) rather than
   * leaking transport errors, so the orchestrator can map them to a safe result.
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}

/**
 * Shared size limits for untrusted text — mirror the metadata package so an AI
 * input built from bibliographic fields is bounded before it ever leaves the
 * process, and model output is capped before validation (docs/29 §11–12).
 */
export const AI_LIMITS = {
  /** Max chars of any single input field forwarded to a provider. */
  inputTitle: 1000,
  inputAbstract: 20000,
  inputSummary: 20000,
  inputShort: 500,
  /** Max chars of raw model output accepted for parsing (oversized → rejected). */
  maxOutputChars: 20000,
  /** Max chars of any single string field inside a validated AI output. */
  maxOutputStringChars: 4000,
  /** Max items in an AI output array (e.g. criticisms, duplicate candidates). */
  maxOutputItems: 25,
} as const;
