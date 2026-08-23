import { describe, expect, it } from 'vitest';
import { validateOutput } from './schemas.js';

const OUTCOMES = ['STRONG_POSITIVE', 'POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'NEGATIVE'];

describe('validateOutput', () => {
  it('accepts a well-formed summary and uses it as the suggested value', () => {
    const r = validateOutput('summary', { summary: '  A neutral summary.  ', confidence: 'moderate' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.suggestion.suggestedValue).toBe('A neutral summary.');
      expect(r.suggestion.confidence).toBe('MODERATE');
    }
  });

  it('rejects an empty summary', () => {
    expect(validateOutput('summary', { summary: '   ' }).ok).toBe(false);
    expect(validateOutput('summary', {}).ok).toBe(false);
  });

  it('accepts a classification value inside the allowed set', () => {
    const r = validateOutput('outcome', { value: 'POSITIVE', confidence: 'HIGH' }, OUTCOMES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.suggestion.suggestedValue).toBe('POSITIVE');
  });

  it('rejects a classification value outside the allowed set (taxonomy guard)', () => {
    const r = validateOutput('outcome', { value: 'MADE_UP' }, OUTCOMES);
    expect(r.ok).toBe(false);
  });

  it('rejects a missing classification value', () => {
    expect(validateOutput('quality', { confidence: 'LOW' }, ['ADEQUATE']).ok).toBe(false);
  });

  it('normalizes and filters criticism items, dropping invalid categories', () => {
    const r = validateOutput('criticism', {
      items: [
        { category: 'sample_size', note: 'Small n.' },
        { category: 'NOT_A_CATEGORY', note: 'ignored' },
        { category: 'BLINDING', note: '   ' },
      ],
      confidence: 'LOW',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const items = (r.suggestion.output as { items: { category: string }[] }).items;
      expect(items).toHaveLength(1);
      expect(items[0]?.category).toBe('SAMPLE_SIZE');
      expect(r.suggestion.suggestedValue).toBeNull();
    }
  });

  it('accepts an empty criticism list as a valid "nothing found" result', () => {
    const r = validateOutput('criticism', { items: [] });
    expect(r.ok).toBe(true);
  });

  it('rejects non-object output', () => {
    expect(validateOutput('summary', 'not json').ok).toBe(false);
    expect(validateOutput('outcome', ['array'], OUTCOMES).ok).toBe(false);
  });

  it('drops an invalid confidence rather than trusting it', () => {
    const r = validateOutput('outcome', { value: 'POSITIVE', confidence: 'VERY_SURE' }, OUTCOMES);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.suggestion.confidence).toBeNull();
  });
});
