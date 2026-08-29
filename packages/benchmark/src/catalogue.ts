/**
 * Live model-catalogue and pricing verification (M6.1 master prompt §5, §9, §10, §28).
 *
 * Before any recommendation, every candidate model id and price MUST be confirmed
 * against the LIVE OpenRouter catalogue (`GET {baseUrl}/models`). This module does
 * that with an INJECTED fetch (so it is unit-testable offline with a fake catalogue
 * response and never needs a live call in CI). It NEVER invents a model or a price:
 *
 *   - a candidate id absent from the catalogue → `available: false` (not substituted);
 *   - a candidate with no catalogue price → `livePricing: null`, `pricingVerified: false`;
 *   - a catalogue call that fails or is blocked → `ok: false` with the exact error,
 *     and the whole live benchmark is BLOCKED (master prompt §28, §30).
 *
 * OpenRouter reports per-token USD prices as strings (e.g. "0.00000004"); we convert
 * to per-1,000,000-tokens to match `AIPricing`. No network, provider, or DB import.
 */
import type { AIPricing } from "@wise-evidence/ai";

/** Minimal fetch signature for a GET — a subset of the global fetch/undici shape. */
export type CatalogueFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

/** One catalogue entry as read back from `GET /models`. */
export interface CatalogueEntry {
  readonly id: string;
  /** Live pricing per 1,000,000 tokens, or null when the catalogue omits it. */
  readonly livePricing: AIPricing | null;
}

/** The result of reading the catalogue. On failure, `ok` is false with `error`. */
export interface CatalogueResult {
  readonly ok: boolean;
  readonly error: string | null;
  /** id → entry, empty when the call failed. */
  readonly entries: ReadonlyMap<string, CatalogueEntry>;
  readonly modelCount: number;
}

/** Verification of one candidate against the live catalogue. */
export interface ModelVerification {
  readonly id: string;
  readonly available: boolean;
  readonly livePricing: AIPricing | null;
  readonly pricingVerified: boolean;
  readonly note: string;
}

/**
 * Read `GET {baseUrl}/models`. Returns a structured result — it never throws for a
 * network/HTTP/parse failure, so the caller can record the exact blocker and stop.
 */
export async function fetchCatalogue(
  fetch: CatalogueFetch,
  baseUrl: string,
  apiKey: string | null,
  timeoutMs = 30_000,
): Promise<CatalogueResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body: string;
  try {
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!res.ok) {
      return fail(`catalogue HTTP ${res.status}`);
    }
    body = await res.text();
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return fail(aborted ? "catalogue request timed out" : "catalogue request failed (network)");
  } finally {
    clearTimeout(timer);
  }

  return parseCatalogue(body);
}

/** Parse the OpenRouter-shaped `{ data: [{ id, pricing }] }` body. Pure. */
export function parseCatalogue(body: string): CatalogueResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail("catalogue response was not JSON");
  }
  const data = getProp(parsed, "data");
  if (!Array.isArray(data)) return fail("catalogue response had no data array");

  const entries = new Map<string, CatalogueEntry>();
  for (const item of data) {
    const id = getProp(item, "id");
    if (typeof id !== "string" || id.length === 0) continue;
    entries.set(id, { id, livePricing: parsePricingBlock(getProp(item, "pricing")) });
  }
  return { ok: true, error: null, entries, modelCount: entries.size };
}

/**
 * Verify each candidate against the catalogue result. When the catalogue call
 * failed, every candidate is `available: false` with the catalogue error noted —
 * never assumed present.
 */
export function verifyCandidates(
  candidateIds: readonly string[],
  catalogue: CatalogueResult,
): ModelVerification[] {
  return candidateIds.map((id) => {
    if (!catalogue.ok) {
      return {
        id,
        available: false,
        livePricing: null,
        pricingVerified: false,
        note: `catalogue unavailable: ${catalogue.error ?? "unknown error"}`,
      };
    }
    const entry = catalogue.entries.get(id);
    if (!entry) {
      return {
        id,
        available: false,
        livePricing: null,
        pricingVerified: false,
        note: "not found in live catalogue (do not substitute)",
      };
    }
    const pricingVerified =
      entry.livePricing !== null &&
      entry.livePricing.inputPerMTok !== null &&
      entry.livePricing.outputPerMTok !== null;
    return {
      id,
      available: true,
      livePricing: entry.livePricing,
      pricingVerified,
      note: pricingVerified
        ? "verified against live catalogue"
        : "present; live pricing incomplete",
    };
  });
}

// --- internals ---------------------------------------------------------------

/** Convert an OpenRouter `pricing` block (per-token USD strings) to per-MTok. */
function parsePricingBlock(pricing: unknown): AIPricing | null {
  if (pricing === null || typeof pricing !== "object") return null;
  const input = perMTok(getProp(pricing, "prompt"));
  const output = perMTok(getProp(pricing, "completion"));
  if (input === null && output === null) return null;
  return { inputPerMTok: input, outputPerMTok: output };
}

/** Parse a per-token USD price (string or number) into a per-1,000,000-token price. */
function perMTok(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n * 1_000_000;
}

function getProp(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && key in value) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

function fail(error: string): CatalogueResult {
  return { ok: false, error, entries: new Map(), modelCount: 0 };
}
