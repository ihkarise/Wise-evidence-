import { describe, expect, it } from 'vitest';
import { PROMPT_VERSION, loadPromptText } from './prompts.js';
import { AI_TASKS } from './types.js';

describe('prompt registry', () => {
  it('has a version for every task', () => {
    for (const task of AI_TASKS) expect(PROMPT_VERSION[task]).toMatch(/^v\d+$/);
  });

  it('loads a non-trivial prompt file for every task', () => {
    for (const task of AI_TASKS) {
      const text = loadPromptText(task);
      expect(text.length).toBeGreaterThan(50);
      // Each prompt reinforces the untrusted-data boundary.
      expect(text).toContain('UNTRUSTED_RESEARCH_DATA');
    }
  });

  it('classification prompts instruct a single allowed value', () => {
    for (const task of ['outcome', 'study-type', 'evidence-level', 'quality'] as const) {
      expect(loadPromptText(task).toLowerCase()).toContain('allowed value');
    }
  });
});
