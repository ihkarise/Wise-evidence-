/**
 * Task orchestration (docs/29 §7, §10, §11, §18).
 *
 * `runTask` builds a provider request from a TRUSTED prompt plus UNTRUSTED,
 * delimiter-wrapped research data, calls the provider with a bounded retry,
 * validates the output, derives cost, and returns a persistence-ready
 * `AIExecution`. It is PURE with respect to the database: it never touches
 * `ai_job`/`ai_result` — the database service layer does that. It never
 * publishes, never writes canonical data, and never has any DB privilege.
 *
 * Failure isolation (docs/29 §18): a provider failure or a malformed output
 * yields a typed, safe result (no secret leakage). The caller records it and
 * leaves the study untouched.
 */
import { deriveCost, type AIPricing } from "./cost.js";
import { canonicalize, sha256Hex } from "./hash.js";
import type { LoadedPrompt } from "./registry.js";
import {
  AIProviderError,
  UNKNOWN_USAGE,
  type AICompletionResponse,
  type AIProvider,
  type AIProviderErrorReason,
  type AITaskId,
  type AIUsage,
} from "./types.js";
import { validateTaskOutput } from "./validation.js";

export interface RunTaskOptions {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  /** Total attempts = 1 + maxRetries. Default 1 retry (2 attempts). */
  readonly maxRetries?: number;
  /** Operator pricing for cost derivation; absent → cost null (docs/29 §16). */
  readonly pricing?: AIPricing | null;
}

/**
 * A completed execution, ready for the database layer to persist. Discriminated:
 *   - `kind: "result"` → the provider answered and the output was validated
 *     (VALID or INVALID). An `ai_result` row is stored either way (INVALID is a
 *     recorded, immutable outcome); the job SUCCEEDED for VALID, FAILED for
 *     INVALID.
 *   - `kind: "provider-error"` → the provider failed to answer (timeout, rate
 *     limit, unavailable, …). No `ai_result` is stored; the job FAILED with a
 *     safe `errorDetail`.
 */
export type AIExecution =
  | {
      readonly kind: "result";
      readonly task: AITaskId;
      readonly provider: string;
      readonly model: string;
      readonly promptVersion: string;
      readonly promptContentHash: string;
      readonly validationStatus: "VALID" | "INVALID";
      readonly output: unknown;
      readonly confidence: number | null;
      readonly usage: AIUsage;
      readonly costEstimate: number | null;
      /** SHA-256 of the exact raw model output (integrity, no secret) — docs/29 §8.1. */
      readonly rawOutputSha256: string;
      readonly errorDetail: string | null;
      readonly attempts: number;
    }
  | {
      readonly kind: "provider-error";
      readonly task: AITaskId;
      readonly provider: string;
      readonly model: string;
      readonly promptVersion: string;
      readonly promptContentHash: string;
      readonly reason: AIProviderErrorReason;
      readonly errorDetail: string;
      readonly usage: AIUsage;
      readonly attempts: number;
    };

/** Provider errors worth retrying — transient conditions only (docs/29 §18). */
const TRANSIENT: ReadonlySet<AIProviderErrorReason> = new Set([
  "timeout",
  "rate-limited",
  "unavailable",
  "network",
]);

/**
 * Wrap the minimised, canonical input as clearly-delimited UNTRUSTED data. The
 * model is told (by the prompt) that everything here is data, never instructions
 * (docs/29 §10).
 */
export function buildUserContent(input: unknown): string {
  return `<research_data>\n${canonicalize(input)}\n</research_data>`;
}

export async function runTask(
  provider: AIProvider,
  prompt: LoadedPrompt,
  input: unknown,
  options: RunTaskOptions,
): Promise<AIExecution> {
  const maxRetries = options.maxRetries ?? 1;
  const userContent = buildUserContent(input);
  const base = {
    task: prompt.task,
    provider: provider.id,
    model: provider.modelId,
    promptVersion: prompt.version,
    promptContentHash: prompt.contentHash,
  } as const;

  let attempts = 0;
  let lastResult: Extract<AIExecution, { kind: "result" }> | null = null;
  let lastError: { reason: AIProviderErrorReason; detail: string; usage: AIUsage } | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++;
    let response: AICompletionResponse;
    try {
      response = await provider.complete({
        task: prompt.task,
        system: prompt.text,
        userContent,
        maxOutputTokens: options.maxOutputTokens,
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      const reason: AIProviderErrorReason =
        error instanceof AIProviderError ? error.reason : "network";
      const detail =
        error instanceof AIProviderError ? error.message : "unexpected provider failure";
      lastError = { reason, detail, usage: UNKNOWN_USAGE };
      if (TRANSIENT.has(reason) && attempt < maxRetries) continue;
      break;
    }

    const validation = validateTaskOutput(prompt.task, response.rawText);
    if (validation.ok) {
      return {
        ...base,
        kind: "result",
        validationStatus: "VALID",
        output: validation.output,
        confidence: validation.confidence,
        usage: response.usage,
        costEstimate: deriveCost(response.usage, options.pricing ?? null),
        rawOutputSha256: sha256Hex(response.rawText),
        errorDetail: null,
        attempts,
      };
    }
    // Invalid output: record it, and retry if attempts remain.
    lastResult = {
      ...base,
      kind: "result",
      validationStatus: "INVALID",
      output: { raw: truncate(response.rawText) },
      confidence: null,
      usage: response.usage,
      costEstimate: deriveCost(response.usage, options.pricing ?? null),
      rawOutputSha256: sha256Hex(response.rawText),
      errorDetail: validation.error,
      attempts,
    };
    if (attempt < maxRetries) continue;
    return lastResult;
  }

  if (lastResult !== null) return lastResult;
  const err = lastError ?? {
    reason: "network" as const,
    detail: "no response",
    usage: UNKNOWN_USAGE,
  };
  return {
    ...base,
    kind: "provider-error",
    reason: err.reason,
    errorDetail: err.detail,
    usage: err.usage,
    attempts,
  };
}

/** Keep a bounded snapshot of malformed output for diagnostics (no secrets). */
function truncate(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
