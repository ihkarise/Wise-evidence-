/**
 * Provider health and fallback provenance (ADR-019; docs/29 §18, §19).
 *
 * Two small, safe result types:
 *   - `ProviderHealth`  — a category-only status for admin diagnostics. It NEVER
 *     carries a raw secret, base-URL credential, or raw provider error string.
 *   - `FallbackRecord`  — provenance for a deliberate provider/model fallback.
 *     WiseEvidence performs NO automatic, uncontrolled fallback for canonical
 *     classification (a different model can classify differently). When a fallback
 *     IS used it must be explicit and this record must be preserved alongside the
 *     AI provenance so a reviewer can see exactly what produced a suggestion.
 *
 * Pure: no network, no provider, no DB.
 */
import type { AIProviderErrorReason } from "./types.js";

/** Safe, category-only provider health status (ADR-019 "Provider health"). */
export type ProviderHealthStatus =
  | "available"
  | "unavailable"
  | "authentication_error"
  | "timeout"
  | "rate_limited"
  | "unsupported_capability"
  | "provider_error";

export interface ProviderHealth {
  readonly providerId: string;
  readonly modelId: string;
  readonly status: ProviderHealthStatus;
  /** Safe category detail for admin diagnostics — never a secret or raw payload. */
  readonly detail: string | null;
}

/** Map a typed provider-error reason to a safe health category. */
export function healthStatusFromReason(reason: AIProviderErrorReason): ProviderHealthStatus {
  switch (reason) {
    case "unauthorized":
      return "authentication_error";
    case "timeout":
      return "timeout";
    case "rate-limited":
      return "rate_limited";
    case "unavailable":
      return "unavailable";
    case "unsupported-capability":
      return "unsupported_capability";
    case "not-configured":
    case "network":
    case "bad-response":
    case "too-large":
      return "provider_error";
  }
}

/** A healthy result. */
export function healthy(providerId: string, modelId: string): ProviderHealth {
  return { providerId, modelId, status: "available", detail: null };
}

/**
 * A record of a deliberate fallback from one provider/model to another. Carries no
 * secret — only ids and the safe reason category (ADR-019 "Fallback").
 */
export interface FallbackRecord {
  readonly originalProviderId: string;
  readonly originalModelId: string;
  readonly fallbackProviderId: string;
  readonly fallbackModelId: string;
  readonly reason: AIProviderErrorReason;
}
