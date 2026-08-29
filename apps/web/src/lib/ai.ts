/**
 * Server-side AI enrichment coordinator (docs/29 §2, §7).
 *
 * SERVER ONLY. It reads server-only AI configuration (never `PUBLIC_*`, never
 * sent to the browser), constructs the provider, and wires the two boundaries:
 * `@wise-evidence/ai` (provider, prompt registry, validation, hashing, cost) and
 * `@wise-evidence/database` (minimised input, cache, immutable job/result
 * persistence). AI produces suggestions only — this coordinator never writes a
 * canonical value, never publishes, and never changes lifecycle state.
 *
 * The default provider is the offline MockAIProvider, so the app runs the whole
 * pipeline with no key and no network.
 */
import {
  loadPrompt,
  runTask,
  hashInput,
  isAiTask,
  resolveProviderFromEnv,
  type AIProvider,
  type AIPricing,
  type AITaskId,
  type FetchLike,
} from "@wise-evidence/ai";
import {
  getEnrichmentInput,
  findCachedSuggestion,
  recordExecution,
  type Actor,
  type SqlExecutor,
  type StoredSuggestion,
  ServiceError,
} from "@wise-evidence/database";
import { asService } from "./db.js";

const env = import.meta.env;

/** Configured provider preset id (server-side; default "mock"). */
export const aiProviderId = (env.AI_PROVIDER ?? "mock").trim() || "mock";

/**
 * The server-only AI configuration, as a plain record for the provider-agnostic
 * resolver. Only these keys are read; the API key lives here and is NEVER exposed
 * to the browser (never `PUBLIC_*`, never sent in island props or responses).
 */
function aiEnv(): Record<string, string | undefined> {
  return {
    AI_PROVIDER: env.AI_PROVIDER,
    AI_BASE_URL: env.AI_BASE_URL,
    AI_MODEL: env.AI_MODEL,
    AI_API_KEY: env.AI_API_KEY,
    AI_REQUEST_TIMEOUT_MS: env.AI_REQUEST_TIMEOUT_MS,
    AI_PRICE_INPUT_PER_MTOK: env.AI_PRICE_INPUT_PER_MTOK,
    AI_PRICE_OUTPUT_PER_MTOK: env.AI_PRICE_OUTPUT_PER_MTOK,
  };
}

function timeoutMs(): number {
  const n = Number(env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}
function maxOutputTokens(): number {
  const n = Number(env.AI_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? n : 1024;
}

/** Resolve the configured provider + its model config/pricing via the registry. */
function resolveAi(): { provider: AIProvider; pricing: AIPricing | null } {
  const resolved = resolveProviderFromEnv(aiEnv(), {
    fetch: globalThis.fetch as unknown as FetchLike,
  });
  return { provider: resolved.provider, pricing: resolved.pricing };
}

/** Build the configured provider. Throws a safe error if it is misconfigured. */
export function getAiProvider(): AIProvider {
  return resolveAi().provider;
}

export interface EnrichmentOutcome {
  readonly ok: boolean;
  readonly cached: boolean;
  readonly task: AITaskId;
  /** Safe, non-secret message for the admin UI. */
  readonly message: string;
}

/**
 * Run (or reuse a cached) enrichment for one task on one study. Staff-only (the
 * service layer re-checks the role; RLS/service_role governs writes). Returns a
 * safe outcome — provider/credential detail never surfaces to the caller.
 */
export async function runEnrichment(
  actor: Actor,
  studyId: string,
  task: string,
): Promise<EnrichmentOutcome> {
  if (!isAiTask(task)) {
    return { ok: false, cached: false, task: task as AITaskId, message: "Unknown AI task." };
  }

  let provider: AIProvider;
  let pricing: AIPricing | null;
  try {
    ({ provider, pricing } = resolveAi());
  } catch {
    return { ok: false, cached: false, task, message: "AI provider is not configured." };
  }

  const prompt = await loadPrompt(task);

  return asService(async (db: SqlExecutor) => {
    const input = await getEnrichmentInput(db, studyId, task);
    if (input === null) {
      return { ok: false, cached: false, task, message: "Study not found." };
    }
    const inputHash = hashInput(input);
    const key = {
      studyId,
      operation: task,
      inputHash,
      model: provider.modelId,
      promptVersion: prompt.version,
    };

    // Cache: a hit makes no provider call (docs/29 §13).
    const cached = await findCachedSuggestion(db, key);
    if (cached) {
      return {
        ok: cached.validationStatus === "VALID",
        cached: true,
        task,
        message:
          cached.validationStatus === "VALID"
            ? "Loaded cached suggestion."
            : "Cached run was invalid.",
      };
    }

    const execution = await runTask(provider, prompt, input, {
      maxOutputTokens: maxOutputTokens(),
      timeoutMs: timeoutMs(),
      pricing,
    });

    try {
      if (execution.kind === "result") {
        await recordExecution(db, actor, {
          key,
          provider: execution.provider,
          promptContentHash: execution.promptContentHash,
          result: {
            validationStatus: execution.validationStatus,
            output: execution.output,
            confidence: execution.confidence,
            usage: execution.usage,
            costEstimate: execution.costEstimate,
            validationError: execution.errorDetail,
            rawOutputSha256: execution.rawOutputSha256,
          },
        });
        return {
          ok: execution.validationStatus === "VALID",
          cached: false,
          task,
          message:
            execution.validationStatus === "VALID"
              ? "AI suggestion generated for review."
              : "AI returned output that failed validation; recorded for review.",
        };
      }
      // Hard provider failure — recorded as a failed job, study untouched.
      await recordExecution(db, actor, {
        key,
        provider: execution.provider,
        promptContentHash: execution.promptContentHash,
        failure: {
          reason: execution.reason,
          errorDetail: execution.errorDetail,
          usage: execution.usage,
        },
      });
      return {
        ok: false,
        cached: false,
        task,
        message: "AI provider was unavailable; please retry.",
      };
    } catch (error) {
      // A concurrent run already created the job (unique cache key) — reuse it.
      if (error instanceof ServiceError && error.reason === "duplicate") {
        return { ok: true, cached: true, task, message: "Suggestion already generated." };
      }
      throw error;
    }
  });
}

export type { StoredSuggestion };
