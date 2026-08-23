/**
 * Prompt registry (docs/10 §5). Critical prompts live in the top-level
 * `prompts/<task>/vN.md` directory — never buried in application code. The active
 * version per task is a constant here (so `ai_job.prompt_version` is always known
 * without touching disk); the prompt *text* is read from the file only when a
 * real provider composes a request. The MockAIProvider never needs the text.
 */
import { readFileSync } from 'node:fs';
import type { AITask } from './types.js';

/** Active prompt version per task. Bump when a prompt file changes (new vN.md). */
export const PROMPT_VERSION: Record<AITask, string> = {
  summary: 'v1',
  'study-type': 'v1',
  'evidence-level': 'v1',
  outcome: 'v1',
  quality: 'v1',
  criticism: 'v1',
};

/** Directory holding versioned prompt files (repo-root `prompts/`). */
function promptsDir(): URL {
  return new URL('../../../prompts/', import.meta.url);
}

/** Load the active prompt text for a task from `prompts/<task>/<version>.md`. */
export function loadPromptText(task: AITask): string {
  const version = PROMPT_VERSION[task];
  const url = new URL(`${task}/${version}.md`, promptsDir());
  return readFileSync(url, 'utf8');
}
