/**
 * Cost derivation (docs/29 §16).
 *
 * Cost is derived ONLY from real provider-reported usage and operator-supplied
 * current pricing:
 *
 *   cost = (input_tokens × input_price) + (output_tokens × output_price)
 *
 * If usage is unavailable → cost = null. If pricing is unavailable → cost = null.
 * Never guess; never silently write $0; a missing cost is NOT free inference.
 *
 * Pure: no network, no provider, no DB.
 */
import type { AIUsage } from "./types.js";

/**
 * Operator-supplied pricing, in currency units per 1,000,000 tokens (per-MTok),
 * the way providers publish it. Both fields must be present for a cost to be
 * derivable; a null/absent price yields a null cost.
 */
export interface AIPricing {
  readonly inputPerMTok: number | null;
  readonly outputPerMTok: number | null;
}

/**
 * Derive the cost estimate, or `null` when it cannot be honestly computed.
 * Returns null unless BOTH token counts AND both prices are known finite numbers.
 */
export function deriveCost(usage: AIUsage, pricing: AIPricing | null): number | null {
  if (pricing === null) return null;
  const { inputTokens, outputTokens } = usage;
  const { inputPerMTok, outputPerMTok } = pricing;
  if (!isFiniteNumber(inputTokens) || !isFiniteNumber(outputTokens)) return null;
  if (!isFiniteNumber(inputPerMTok) || !isFiniteNumber(outputPerMTok)) return null;
  const cost =
    (inputTokens * inputPerMTok) / 1_000_000 + (outputTokens * outputPerMTok) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

/**
 * Parse operator pricing from raw env-style strings. An empty/absent/invalid
 * value becomes null (→ cost null), never a guessed number.
 */
export function parsePricing(
  inputPerMTok: string | undefined | null,
  outputPerMTok: string | undefined | null,
): AIPricing {
  return {
    inputPerMTok: parsePrice(inputPerMTok),
    outputPerMTok: parsePrice(outputPerMTok),
  };
}

function parsePrice(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
