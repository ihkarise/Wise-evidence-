/**
 * Deterministic input hashing for the AI cache key (docs/10 §8). The cache key is
 * `study_id + operation + input_hash + model + prompt_version`; this computes the
 * `input_hash` over the task + normalized study input, so identical inputs reuse
 * a prior result and any change produces a fresh job. Uses Web Crypto SHA-256
 * (a global in Node 22 and the browser); no node:crypto import.
 */
import type { AIEnrichmentRequest } from './types.js';

/** Stable JSON: object keys sorted, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 hex of the canonical `{ task, input, allowedValues }`. */
export async function computeInputHash(req: AIEnrichmentRequest): Promise<string> {
  const payload = canonical({ task: req.task, input: req.input, allowedValues: req.allowedValues ?? [] });
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}
