// Public API of @wise-evidence/ai (provider-neutral AI enrichment, ADR-016).
// Suggestion-only: nothing here writes to the database or produces a canonical
// value. Persistence lives in @wise-evidence/database (ai-jobs); orchestration in
// the web server. The domain package stays provider-free.

export type {
  AITask,
  AIConfidence,
  StudyInput,
  CriticismItem,
  AIEnrichmentRequest,
  AISuggestion,
  AIErrorCode,
  AIUsage,
  AIProviderResult,
  AIProvider,
} from './types.js';
export { estimateCostUsd, pricingFromEnv, type ModelPricing } from './cost.js';
export { AI_TASKS, TASK_OPERATION, TASK_DIMENSION } from './types.js';
export { validateOutput, CRITICISM_CATEGORIES, type ValidationResult } from './schemas.js';
export { computeInputHash } from './hash.js';
export { PROMPT_VERSION, loadPromptText } from './prompts.js';
export { renderUntrustedInput, sanitizeField, DATA_OPEN, DATA_CLOSE } from './injection.js';
export { MockAIProvider } from './mock.js';
export { OpenAICompatibleProvider, type OpenAICompatibleOptions } from './openai-compatible.js';
