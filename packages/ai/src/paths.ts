/**
 * Filesystem locators for the versioned prompt registry (docs/29 §6).
 *
 * Prompts live in the repository's top-level `prompts/` directory, tracked and
 * reviewable in diffs, never buried in application code. This module only
 * resolves paths; the loader in `registry.ts` reads and hashes them.
 */
import { fileURLToPath } from "node:url";

/** Absolute path to the top-level `prompts/` directory. */
export const PROMPTS_DIR = fileURLToPath(new URL("../../../prompts/", import.meta.url));
