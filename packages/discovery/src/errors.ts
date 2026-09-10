/**
 * Provider-neutral discovery errors (M7.1; docs/16 §8, docs/30).
 *
 * Discovery has two idioms for failure, mirroring the rest of the platform:
 *
 *   - Expected, per-operation failures (a source is down, a response is
 *     malformed, an item lacks enough metadata) are returned as a
 *     `DiscoveryResult` FAILURE branch carrying a `DiscoveryError` — callers
 *     always handle them explicitly rather than catching (cf. the metadata
 *     provider contract, docs/26 §5).
 *   - The registry throws a `DiscoveryError` with code `NOT_CONFIGURED` when
 *     asked for a provider that has no adapter registered (cf. the AI provider
 *     registry, ADR-019) — a programming/configuration fault, not a data path.
 *
 * A `DiscoveryError` message MUST be safe to log: it never contains secrets,
 * API keys, authorization headers, or credentials. Descriptors carry no
 * secrets in M7.1, but `redactMessage()` is applied defensively so that if a
 * future provider ever threads a token near an error, it cannot leak.
 *
 * Framework-independent: no Astro, React, Supabase, web, or AI imports; no I/O.
 */

/**
 * The closed set of provider-neutral discovery error codes. These describe the
 * FAILURE, never the source's identity in a way that couples callers to one
 * provider. `NOT_CONFIGURED` is the registry/seam failure; the rest are
 * data-path failures a provider may report.
 */
export type DiscoveryErrorCode =
  | "SOURCE_UNAVAILABLE" // the source could not be reached / is down
  | "RATE_LIMITED" // the source (or our own budget) refused for rate reasons
  | "TIMEOUT" // the operation exceeded the descriptor time budget
  | "MALFORMED_RESPONSE" // a response parsed but did not match the expected shape
  | "FORBIDDEN_SOURCE" // a URL/host is not permitted by the descriptor policy
  | "INVALID_IDENTIFIER" // a supplied identifier (e.g. DOI) is not well-formed
  | "INSUFFICIENT_METADATA" // an item lacks the minimum fields to be useful
  | "FETCH_FAILED" // fetching a single item's detail record failed
  | "NORMALIZATION_FAILED" // an item could not be normalized (structural fault)
  | "NOT_CONFIGURED"; // no adapter/provider is registered for the requested type

/** Codes whose failures are commonly transient and may be retried later. */
const RETRYABLE_CODES: ReadonlySet<DiscoveryErrorCode> = new Set([
  "SOURCE_UNAVAILABLE",
  "RATE_LIMITED",
  "TIMEOUT",
]);

/** Tokens that must never appear in a discovery error message. */
const SECRET_HINT = /(authorization|api[-_ ]?key|bearer\s+\S+|secret|password|token)/i;

/**
 * Defensively strip anything that looks like a secret from an error message.
 * We do not attempt to preserve meaning — a message that trips the heuristic is
 * replaced wholesale with a safe, generic string keyed by nothing sensitive.
 */
export function redactMessage(message: string): string {
  return SECRET_HINT.test(message)
    ? "[redacted: message withheld to avoid leaking a secret]"
    : message;
}

export interface DiscoveryErrorOptions {
  /** The source this error is attributed to, when known. */
  readonly source?: string | null;
  /** Safe, non-sensitive detail for logs/UX (also redacted). */
  readonly detail?: string;
  /** Underlying cause, retained for debugging but never serialized to callers. */
  readonly cause?: unknown;
}

/**
 * A structured, provider-neutral discovery error. It is a real `Error` (so it
 * can be thrown by the registry) and also the payload of a failure result.
 * Its `message` and `detail` are always redacted.
 */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  readonly source: string | null;
  readonly detail: string | null;
  readonly retryable: boolean;

  constructor(code: DiscoveryErrorCode, message: string, options: DiscoveryErrorOptions = {}) {
    super(
      redactMessage(message),
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "DiscoveryError";
    this.code = code;
    this.source = options.source ?? null;
    this.detail = options.detail !== undefined ? redactMessage(options.detail) : null;
    this.retryable = RETRYABLE_CODES.has(code);
  }

  /** A safe, serializable view — never includes `cause` or a stack. */
  toJSON(): {
    readonly name: string;
    readonly code: DiscoveryErrorCode;
    readonly message: string;
    readonly source: string | null;
    readonly detail: string | null;
    readonly retryable: boolean;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      source: this.source,
      detail: this.detail,
      retryable: this.retryable,
    };
  }
}

/** Narrow an unknown thrown value to a `DiscoveryError`. */
export function isDiscoveryError(value: unknown): value is DiscoveryError {
  return value instanceof DiscoveryError;
}
