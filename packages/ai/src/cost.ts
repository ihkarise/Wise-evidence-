/**
 * Cost estimation (docs/21, M6.1). Cost is derived ONLY from provider-reported
 * token usage multiplied by pricing the operator supplies for the current model.
 * Nothing here invents a price or a token count — if usage or pricing is missing,
 * cost is null. Pricing is expressed as USD per 1,000,000 tokens.
 */
import type { AIUsage } from './types.js';

export interface ModelPricing {
  /** USD per 1M input tokens (cache-miss rate). */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

/**
 * Estimated USD cost of one call. Returns null when usage is unavailable or the
 * needed token counts are missing, so a missing measurement is never silently
 * treated as $0.
 */
export function estimateCostUsd(usage: AIUsage | null | undefined, pricing: ModelPricing): number | null {
  if (!usage) return null;
  const inTok = usage.inputTokens;
  const outTok = usage.outputTokens;
  if (inTok === null && outTok === null) return null;
  const inCost = ((inTok ?? 0) / 1_000_000) * pricing.inputPerMillion;
  const outCost = ((outTok ?? 0) / 1_000_000) * pricing.outputPerMillion;
  return inCost + outCost;
}

/**
 * Read model pricing from server-only env (AI_INPUT_PRICE_PER_M /
 * AI_OUTPUT_PRICE_PER_M). Returns null when unset — callers then report cost as
 * "pricing not configured" rather than guessing.
 */
export function pricingFromEnv(env: Record<string, string | undefined>): ModelPricing | null {
  const inp = Number(env.AI_INPUT_PRICE_PER_M);
  const out = Number(env.AI_OUTPUT_PRICE_PER_M);
  if (!Number.isFinite(inp) || !Number.isFinite(out)) return null;
  return { inputPerMillion: inp, outputPerMillion: out };
}
