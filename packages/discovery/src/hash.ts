/**
 * Deterministic raw-payload hashing for discovery provenance (M7.1; docs/30).
 *
 * We record a SHA-256 of a source item's raw payload so a normalized item is
 * traceable and auditable WITHOUT storing full papers or copyrighted full text
 * (data minimisation; docs/17). The hash is over a CANONICAL serialisation, so
 * the same logical payload always yields the same hash regardless of key order.
 *
 * Framework-independent: uses only `node:crypto`. No network, no provider, no DB.
 * (Mirrors packages/ai/src/hash.ts so the two subsystems agree on canonical form.)
 */
import { createHash } from "node:crypto";

/**
 * Serialise any JSON-compatible value with object keys sorted recursively, so
 * `{a:1,b:2}` and `{b:2,a:1}` produce identical text. Arrays keep their order.
 * `undefined` object properties are dropped; `undefined` inside arrays becomes
 * `null` (matching JSON semantics).
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

/** The provenance hash for a raw payload: SHA-256 of its canonical form. */
export function hashRawPayload(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}
