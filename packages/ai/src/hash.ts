/**
 * Deterministic input hashing for the AI cache identity (docs/29 §12–13).
 *
 * The cache key is `research_id + operation + input_hash + model +
 * prompt_version` (the M2 `ai_job` unique constraint). `input_hash` is the
 * SHA-256 of the CANONICALLY serialised, minimised task input, so the same
 * logical input always yields the same hash regardless of key insertion order.
 *
 * We store the hash, not the input (data minimisation, docs/29 §12).
 *
 * Framework-independent: uses only `node:crypto`. No network, no provider, no DB.
 */
import { createHash } from "node:crypto";

/**
 * Serialise any JSON-compatible value with object keys sorted recursively, so
 * `{a:1,b:2}` and `{b:2,a:1}` produce identical text. Arrays keep their order
 * (order is meaningful). `undefined` object properties are dropped;
 * `undefined` inside arrays becomes `null` (matching JSON semantics).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : sortValue(v)));
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const v = record[key];
    if (v === undefined) continue;
    out[key] = sortValue(v);
  }
  return out;
}

/** SHA-256 (hex) of a canonical UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The `input_hash` for a task input object: SHA-256 of its canonical form.
 * Deterministic and order-independent (a test asserts this).
 */
export function hashInput(input: unknown): string {
  return sha256Hex(canonicalize(input));
}
