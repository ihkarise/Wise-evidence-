/**
 * @wise-evidence/ai — the provider-independent AI subsystem (Milestone 6).
 *
 * AI is a SUGGESTION ENGINE, never an authority (docs/29 §1, ADR-017). This
 * package produces validated, provenance-bearing suggestions only. It has NO
 * database privilege: it never writes canonical data, never publishes, never
 * changes lifecycle/publication state, and never enters the M5 statistics. The
 * database service layer persists suggestions; a human accepts, edits, or rejects
 * them; only the human decision becomes canonical.
 *
 * Public surface: the provider boundary + the two providers, the versioned prompt
 * registry, the six task identities, structured-output validation, deterministic
 * input hashing (cache identity), cost derivation, and the pure task orchestrator.
 * No Astro, React, Supabase, or provider-SDK imports.
 */
export {
  AI_TASKS,
  isAiTask,
  AIProviderError,
  AI_LIMITS,
  UNKNOWN_USAGE,
  type AITaskId,
  type AIUsage,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProvider,
  type AIProviderErrorReason,
} from "./types.js";

export { MockAIProvider, type MockProviderOptions } from "./providers/mock.js";
export {
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
  type FetchLike,
  type FetchLikeResponse,
} from "./providers/openai.js";

export {
  DEFAULT_PROMPT_VERSIONS,
  loadPrompt,
  loadRegistryManifest,
  verifyRegistry,
  type LoadedPrompt,
  type RegistryVerification,
} from "./registry.js";
export { PROMPTS_DIR } from "./paths.js";

export {
  validateTaskOutput,
  type ValidationResult,
  type AITaskOutput,
  type SummaryOutput,
  type OutcomeOutput,
  type QualityOutput,
  type CriticismItem,
  type CriticismOutput,
  type MetadataOutput,
  type DuplicateItem,
  type DuplicateOutput,
} from "./validation.js";

export { hashInput, canonicalize, sha256Hex } from "./hash.js";
export { deriveCost, parsePricing, type AIPricing } from "./cost.js";
export {
  runTask,
  buildUserContent,
  type AIExecution,
  type RunTaskOptions,
} from "./orchestrator.js";
