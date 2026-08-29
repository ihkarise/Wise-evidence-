/**
 * Model capability negotiation (ADR-019; docs/29 §3, §11).
 *
 * A provider/model is NOT assumed to support everything. Before a task runs the
 * coordinator resolves the model, reads its declared `AICapabilities`, and checks
 * the capabilities the task requires. If a required capability is missing the run
 * fails CLEARLY (a typed `unsupported-capability` provider error) — it is NEVER
 * silently downgraded. WiseEvidence application-level validation is mandatory
 * regardless of what a provider claims (a provider "supports JSON schema" is a
 * reason to use it, never a reason to trust the output).
 *
 * Pure: no network, no provider, no DB.
 */
import { AIProviderError, type AITaskId } from "./types.js";

/**
 * What a provider/model can do. `maxContextTokens` / `maxOutputTokens` are `null`
 * when unknown — never a guessed number (the honest-null rule, docs/29 §14).
 */
export interface AICapabilities {
  /** The model can be asked for structured (JSON) output at all. */
  readonly structuredOutput: boolean;
  /** The model honours a strict JSON-schema / json_object response format. */
  readonly jsonSchema: boolean;
  /** The model supports tool/function calling. */
  readonly toolCalling: boolean;
  /** The model accepts image input. */
  readonly vision: boolean;
  /** Maximum input context in tokens, or null when unknown. */
  readonly maxContextTokens: number | null;
  /** Maximum output tokens the model will emit, or null when unknown. */
  readonly maxOutputTokens: number | null;
}

/** The capabilities a task needs. Absent booleans default to "not required". */
export interface RequiredCapabilities {
  readonly structuredOutput?: boolean;
  readonly jsonSchema?: boolean;
  readonly toolCalling?: boolean;
  readonly vision?: boolean;
}

/**
 * Per-task capability requirements. All six tasks return structured JSON that the
 * validator checks, so every task requires `structuredOutput`. None requires a
 * strict JSON schema at the provider (the adapter may fall back to the strongest
 * structured-output mechanism it has — json_object — and our validator is the real
 * gate), tool calling, or vision. Widening a requirement is an architecture change.
 */
export const TASK_CAPABILITY_REQUIREMENTS: Readonly<Record<AITaskId, RequiredCapabilities>> = {
  "research-summary": { structuredOutput: true },
  "outcome-classification": { structuredOutput: true },
  "evidence-quality": { structuredOutput: true },
  "criticism-extraction": { structuredOutput: true },
  "metadata-extraction": { structuredOutput: true },
  "duplicate-detection": { structuredOutput: true },
};

/** Capabilities a plain OpenAI-compatible chat endpoint reliably offers. */
export const OPENAI_COMPATIBLE_CAPABILITIES: AICapabilities = {
  structuredOutput: true,
  jsonSchema: true,
  toolCalling: false,
  vision: false,
  maxContextTokens: null,
  maxOutputTokens: null,
};

/**
 * Conservative capabilities for an unknown local/self-hosted model: it can emit
 * JSON (json_object), but we do not assume strict schema, tool calling, or vision.
 */
export const LOCAL_MODEL_CAPABILITIES: AICapabilities = {
  structuredOutput: true,
  jsonSchema: false,
  toolCalling: false,
  vision: false,
  maxContextTokens: null,
  maxOutputTokens: null,
};

/** Full capabilities for the deterministic mock (it always returns valid JSON). */
export const MOCK_CAPABILITIES: AICapabilities = {
  structuredOutput: true,
  jsonSchema: true,
  toolCalling: false,
  vision: false,
  maxContextTokens: null,
  maxOutputTokens: null,
};

/**
 * Return the list of capability names a task requires but `caps` does not provide.
 * Empty ⇒ the model can run the task.
 */
export function missingCapabilities(
  task: AITaskId,
  caps: AICapabilities,
): readonly (keyof RequiredCapabilities)[] {
  const required = TASK_CAPABILITY_REQUIREMENTS[task];
  const missing: (keyof RequiredCapabilities)[] = [];
  if (required.structuredOutput && !caps.structuredOutput) missing.push("structuredOutput");
  if (required.jsonSchema && !caps.jsonSchema) missing.push("jsonSchema");
  if (required.toolCalling && !caps.toolCalling) missing.push("toolCalling");
  if (required.vision && !caps.vision) missing.push("vision");
  return missing;
}

/**
 * Throw a typed, safe `unsupported-capability` error if `caps` cannot satisfy the
 * task. The message names the missing capabilities only — never a secret, key, or
 * base URL (docs/29 §18).
 */
export function assertCapabilities(task: AITaskId, caps: AICapabilities): void {
  const missing = missingCapabilities(task, caps);
  if (missing.length > 0) {
    throw new AIProviderError(
      "unsupported-capability",
      `model lacks required capability for ${task}: ${missing.join(", ")}`,
    );
  }
}
