/**
 * Versioned prompt registry (docs/29 §6).
 *
 * - Prompts live in the top-level `prompts/<task>/vN.md`.
 * - Every AI result records the exact prompt version that produced it.
 * - A material prompt change is a NEW version file (v2.md), never an edit to a
 *   released version. `prompts/registry.json` pins the content hash of each
 *   released `(task, version)`; `verifyRegistry()` recomputes the hashes and
 *   reports any drift, so an accidental edit to a released prompt is caught in CI
 *   (the "prompt version isolation / stability" test).
 *
 * Pure and offline: reads the prompt files, computes SHA-256, and hands back the
 * trusted system text. No network, no provider, no DB.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "./hash.js";
import { PROMPTS_DIR } from "./paths.js";
import { AI_TASKS, type AITaskId } from "./types.js";

/** The default prompt version for each task. Bump when a v2 is introduced. */
export const DEFAULT_PROMPT_VERSIONS: Record<AITaskId, string> = {
  "research-summary": "v1",
  "outcome-classification": "v1",
  "evidence-quality": "v1",
  "criticism-extraction": "v1",
  "metadata-extraction": "v1",
  "duplicate-detection": "v1",
};

/** A loaded prompt: its identity, trusted system text, and content hash. */
export interface LoadedPrompt {
  readonly task: AITaskId;
  readonly version: string;
  readonly text: string;
  readonly contentHash: string;
}

function keyOf(task: AITaskId, version: string): string {
  return `${task}/${version}`;
}

/** Read + hash the prompt file for `(task, version)`. Throws if missing. */
export async function loadPrompt(task: AITaskId, version?: string): Promise<LoadedPrompt> {
  const v = version ?? DEFAULT_PROMPT_VERSIONS[task];
  const path = join(PROMPTS_DIR, task, `${v}.md`);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`prompt not found: ${keyOf(task, v)}`);
  }
  return { task, version: v, text, contentHash: sha256Hex(text) };
}

/** Read the pinned `(task/version) → content-hash` manifest. */
export async function loadRegistryManifest(): Promise<Record<string, string>> {
  const path = join(PROMPTS_DIR, "registry.json");
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("registry.json is not an object");
  }
  return parsed as Record<string, string>;
}

export interface RegistryVerification {
  readonly ok: boolean;
  /** Human-readable descriptions of any drift (missing file or hash mismatch). */
  readonly mismatches: readonly string[];
}

/**
 * Recompute the content hash of every default `(task, version)` and compare it
 * to the pinned manifest. A mismatch means a released prompt was edited without a
 * version bump — a policy violation (docs/29 §6).
 */
export async function verifyRegistry(): Promise<RegistryVerification> {
  const manifest = await loadRegistryManifest();
  const mismatches: string[] = [];
  for (const task of AI_TASKS) {
    const version = DEFAULT_PROMPT_VERSIONS[task];
    const key = keyOf(task, version);
    const pinned = manifest[key];
    if (pinned === undefined) {
      mismatches.push(`${key}: not pinned in registry.json`);
      continue;
    }
    let loaded: LoadedPrompt;
    try {
      loaded = await loadPrompt(task, version);
    } catch (error) {
      mismatches.push(`${key}: ${(error as Error).message}`);
      continue;
    }
    if (loaded.contentHash !== pinned) {
      mismatches.push(`${key}: content hash drift (edit a released prompt → bump the version)`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
