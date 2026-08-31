/**
 * Run budgets (M7.3; docs/30 §Phase 4). Every discovery run is hard-bounded: a
 * caller supplies partial overrides, and each field is clamped to a conservative
 * default and a HARD MAXIMUM it cannot exceed. There is no "unlimited" — no
 * unbounded pages, rows, requests, candidates, or duration.
 */
import type { DiscoveryBudget } from "./types.js";

/** Conservative defaults for an interactive/admin run. */
export const DEFAULT_BUDGET: DiscoveryBudget = {
  maxPages: 5,
  maxItems: 100,
  maxCandidates: 100,
  maxRequests: 50,
  maxDurationMs: 60_000,
  maxRetriesPerRequest: 3,
  pageSize: 20,
};

/** Hard ceilings. A requested budget is clamped down to these; never up past. */
export const HARD_MAX_BUDGET: DiscoveryBudget = {
  maxPages: 50,
  maxItems: 1000,
  maxCandidates: 1000,
  maxRequests: 500,
  maxDurationMs: 600_000,
  maxRetriesPerRequest: 6,
  pageSize: 100,
};

function clampField(requested: number | undefined, fallback: number, hardMax: number): number {
  const value =
    requested === undefined || !Number.isFinite(requested) ? fallback : Math.trunc(requested);
  if (value < 1) return 1;
  return Math.min(value, hardMax);
}

/**
 * Resolve a full, bounded budget from partial overrides. Each field falls back to
 * `DEFAULT_BUDGET` and is clamped to `[1, HARD_MAX_BUDGET]`, so an accidental or
 * malicious huge/negative value can never launch an unbounded run.
 */
export function resolveBudget(overrides: Partial<DiscoveryBudget> | undefined): DiscoveryBudget {
  const o = overrides ?? {};
  return {
    maxPages: clampField(o.maxPages, DEFAULT_BUDGET.maxPages, HARD_MAX_BUDGET.maxPages),
    maxItems: clampField(o.maxItems, DEFAULT_BUDGET.maxItems, HARD_MAX_BUDGET.maxItems),
    maxCandidates: clampField(
      o.maxCandidates,
      DEFAULT_BUDGET.maxCandidates,
      HARD_MAX_BUDGET.maxCandidates,
    ),
    maxRequests: clampField(o.maxRequests, DEFAULT_BUDGET.maxRequests, HARD_MAX_BUDGET.maxRequests),
    maxDurationMs: clampField(
      o.maxDurationMs,
      DEFAULT_BUDGET.maxDurationMs,
      HARD_MAX_BUDGET.maxDurationMs,
    ),
    maxRetriesPerRequest: clampField(
      o.maxRetriesPerRequest,
      DEFAULT_BUDGET.maxRetriesPerRequest,
      HARD_MAX_BUDGET.maxRetriesPerRequest,
    ),
    pageSize: clampField(o.pageSize, DEFAULT_BUDGET.pageSize, HARD_MAX_BUDGET.pageSize),
  };
}
