/**
 * Prompt-registry tests (docs/29 §6, §21). Every released prompt is pinned by
 * content hash; a released prompt edited without a version bump is caught. Unknown
 * tasks/versions are refused, and every result records the prompt version.
 */
import { describe, it, expect } from "vitest";
import {
  loadPrompt,
  loadRegistryManifest,
  verifyRegistry,
  DEFAULT_PROMPT_VERSIONS,
} from "./registry.js";
import { AI_TASKS } from "./types.js";

describe("prompt registry", () => {
  it("loads every task's default prompt with a content hash", async () => {
    for (const task of AI_TASKS) {
      const p = await loadPrompt(task);
      expect(p.version).toBe(DEFAULT_PROMPT_VERSIONS[task]);
      expect(p.text.length).toBeGreaterThan(0);
      expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("refuses an unknown version", async () => {
    await expect(loadPrompt("research-summary", "v99")).rejects.toThrow(/not found/);
  });

  it("pins every default (task, version) in the manifest", async () => {
    const manifest = await loadRegistryManifest();
    for (const task of AI_TASKS) {
      expect(manifest[`${task}/${DEFAULT_PROMPT_VERSIONS[task]}`]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("verifyRegistry passes: no released prompt drifted from its pinned hash", async () => {
    const result = await verifyRegistry();
    expect(result.ok, result.mismatches.join("; ")).toBe(true);
  });

  it("the loaded content hash matches the pinned manifest hash (version isolation)", async () => {
    const manifest = await loadRegistryManifest();
    for (const task of AI_TASKS) {
      const p = await loadPrompt(task);
      expect(p.contentHash).toBe(manifest[`${task}/${p.version}`]);
    }
  });
});
