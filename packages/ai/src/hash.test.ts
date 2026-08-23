import { describe, expect, it } from 'vitest';
import { computeInputHash } from './hash.js';
import type { AIEnrichmentRequest, StudyInput } from './types.js';

const input: StudyInput = {
  title: 'A study',
  summary: 'summary',
  studyType: null,
  subject: 'HUMAN',
  journal: 'J',
  year: '2020',
  abstract: null,
};

const req = (over: Partial<AIEnrichmentRequest> = {}): AIEnrichmentRequest => ({
  task: 'outcome',
  input,
  allowedValues: ['POSITIVE', 'NEGATIVE'],
  ...over,
});

describe('computeInputHash', () => {
  it('is a 64-char hex SHA-256 string', async () => {
    const h = await computeInputHash(req());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical requests (cache hit)', async () => {
    expect(await computeInputHash(req())).toBe(await computeInputHash(req()));
  });

  it('changes when the task changes', async () => {
    expect(await computeInputHash(req({ task: 'outcome' }))).not.toBe(await computeInputHash(req({ task: 'quality' })));
  });

  it('changes when the input content changes', async () => {
    const other = await computeInputHash(req({ input: { ...input, summary: 'different' } }));
    expect(other).not.toBe(await computeInputHash(req()));
  });
});
