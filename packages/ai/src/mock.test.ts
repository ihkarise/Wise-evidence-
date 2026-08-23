import { describe, expect, it } from 'vitest';
import { MockAIProvider } from './mock.js';
import { validateOutput } from './schemas.js';
import { AI_TASKS, type AIEnrichmentRequest, type StudyInput } from './types.js';

const input: StudyInput = {
  title: 'Individualized homeopathy for allergic rhinitis: a randomized trial',
  summary: 'A double-blind randomized trial with 120 participants.',
  studyType: null,
  subject: 'HUMAN',
  journal: 'Journal of Example Medicine',
  year: '2019',
  abstract: null,
};

const ALLOWED: Record<string, string[]> = {
  outcome: ['POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'NEGATIVE'],
  quality: ['ADEQUATE', 'UNCLEAR', 'INADEQUATE'],
  'study-type': ['RCT', 'OBSERVATIONAL', 'CASE_REPORT'],
  'evidence-level': ['L1', 'L2', 'L3'],
};

describe('MockAIProvider', () => {
  it('produces schema-valid output for every task', async () => {
    const p = new MockAIProvider();
    for (const task of AI_TASKS) {
      const req: AIEnrichmentRequest = { task, input, allowedValues: ALLOWED[task] };
      const res = await p.enrich(req);
      expect(res.ok).toBe(true);
      if (res.ok) {
        const v = validateOutput(task, res.raw, req.allowedValues);
        expect(v.ok).toBe(true);
      }
    }
  });

  it('is deterministic — same request yields identical output (cache-friendly)', async () => {
    const p = new MockAIProvider();
    const req: AIEnrichmentRequest = { task: 'outcome', input, allowedValues: ALLOWED.outcome };
    const a = await p.enrich(req);
    const b = await p.enrich(req);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('only ever suggests a value from the allowed set for classification tasks', async () => {
    const p = new MockAIProvider();
    const res = await p.enrich({ task: 'quality', input, allowedValues: ALLOWED.quality });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const v = validateOutput('quality', res.raw, ALLOWED.quality);
      expect(v.ok).toBe(true);
      if (v.ok) expect(ALLOWED.quality).toContain(v.suggestion.suggestedValue);
    }
  });
});
