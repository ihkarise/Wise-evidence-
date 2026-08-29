/**
 * Candidate models and their (UNVERIFIED) operator-supplied pricing
 * (M6.1 master prompt §9, §10).
 *
 * The candidate list and prices below are the operator-provided STARTING POINT
 * only. They are NOT authoritative: §9/§10 require every model id and price to be
 * verified against the LIVE OpenRouter catalogue before any recommendation. The
 * `catalogue.ts` verifier does exactly that at run time; until it has run, every
 * price here is treated as `UNVERIFIED` and a model's availability is `unknown`.
 *
 * Nothing here performs I/O.
 */
import type { AIPricing } from "@wise-evidence/ai";

/** A candidate model to benchmark, with its provisional (unverified) pricing. */
export interface CandidateModel {
  /** OpenRouter model id, e.g. "deepseek/deepseek-v4-flash-latest". */
  readonly id: string;
  /**
   * Operator-supplied pricing per 1,000,000 tokens, as first given (master prompt
   * §10). UNVERIFIED until `catalogue.ts` confirms it against the live catalogue.
   * A null field means "not supplied" → cost stays NULL, never guessed.
   */
  readonly provisionalPricing: AIPricing;
}

/**
 * The operator's initial candidate list (master prompt §9). These ids MUST be
 * confirmed against `GET /models` before use; an id that no longer exists is
 * recorded as unavailable, never silently substituted.
 */
export const DEFAULT_CANDIDATES: readonly CandidateModel[] = [
  {
    id: "deepseek/deepseek-v4-flash-latest",
    provisionalPricing: { inputPerMTok: 0.04, outputPerMTok: 0.08 },
  },
  {
    id: "qwen/qwen3.5-35b-a3b",
    provisionalPricing: { inputPerMTok: 0.14, outputPerMTok: 1.0 },
  },
  {
    id: "google/gemini-3.7-flash",
    provisionalPricing: { inputPerMTok: 0.375, outputPerMTok: 1.875 },
  },
] as const;

/**
 * Parse a candidate list from the operator environment, so the run is not pinned
 * to a stale hard-coded list. `BENCH_MODELS` is a comma-separated list of model
 * ids; prices, when supplied, come from the standard AI_PRICE_* env the M6
 * coordinator already reads (applied uniformly — per-model prices are resolved
 * from the live catalogue by `catalogue.ts`). Returns the default list when
 * `BENCH_MODELS` is absent.
 */
export function parseCandidates(
  env: Record<string, string | undefined>,
  fallbackPricing: AIPricing,
): readonly CandidateModel[] {
  const raw = (env.BENCH_MODELS ?? "").trim();
  if (raw.length === 0) return DEFAULT_CANDIDATES;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return ids.map((id) => ({ id, provisionalPricing: fallbackPricing }));
}
