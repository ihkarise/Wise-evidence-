/**
 * Bounded retry with backoff (M7.3; docs/30 §Phase 17). M7.2 deferred retry to
 * the orchestrator; this is it. It retries ONLY transient provider failures
 * (`DiscoveryError.retryable`: SOURCE_UNAVAILABLE / RATE_LIMITED / TIMEOUT),
 * never malformed data, invalid identifiers, or a forbidden source. Backoff is
 * bounded exponential with jitter and honours a `Retry-After` hint when the
 * provider surfaced one; it never retries indefinitely.
 *
 * `sleep` and `rng` are injected so tests are deterministic and use no real
 * timers. Each attempt (including retries) is counted by the caller against the
 * run's request budget.
 */
import type { DiscoveryError } from "../errors.js";
import type { DiscoveryResult } from "../types.js";

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Await a delay. Injected; defaults to a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0,1). Injected; defaults to Math.random. */
  readonly rng?: () => number;
  /** Called once per retry (after a retryable failure) for counting. */
  readonly onRetry?: (attempt: number, delayMs: number) => void;
  /**
   * Budget gate: return false to stop retrying (e.g. the run's request budget is
   * exhausted). Checked before each retry.
   */
  readonly canRetry?: () => boolean;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Parse a bounded `Retry-After` seconds hint from a safe error detail string. */
export function parseRetryAfterMs(detail: string | null, maxDelayMs: number): number | null {
  if (detail === null) return null;
  const match = detail.match(/retry-after\s+(\d{1,6})/i);
  if (match === null) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, maxDelayMs);
}

/** Compute the backoff delay for a given zero-based attempt. */
function backoffMs(attempt: number, opts: RetryOptions): number {
  const rng = opts.rng ?? Math.random;
  const exp = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
  const jitter = Math.floor(rng() * opts.baseDelayMs);
  return Math.min(exp + jitter, opts.maxDelayMs);
}

/**
 * Run `operation` with bounded retries. Returns the final `DiscoveryResult`
 * (success, or the last failure after retries are exhausted / not retryable /
 * budget-blocked) together with the number of retries actually performed.
 */
export async function withRetry<T>(
  operation: () => Promise<DiscoveryResult<T>>,
  opts: RetryOptions,
): Promise<{ readonly result: DiscoveryResult<T>; readonly retries: number }> {
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  let retries = 0;

  for (let attempt = 0; ; attempt += 1) {
    const result = await operation();
    if (result.ok) return { result, retries };

    const error: DiscoveryError = result.error;
    const outOfRetries = attempt >= opts.maxRetries;
    const budgetBlocked = opts.canRetry !== undefined && !opts.canRetry();
    if (!error.retryable || outOfRetries || budgetBlocked) {
      return { result, retries };
    }

    const hinted = parseRetryAfterMs(error.detail, opts.maxDelayMs);
    const delay = hinted ?? backoffMs(attempt, opts);
    retries += 1;
    opts.onRetry?.(attempt + 1, delay);
    await sleep(delay);
  }
}
