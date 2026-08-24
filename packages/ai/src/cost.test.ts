import { describe, expect, it } from 'vitest';
import { estimateCostUsd, pricingFromEnv } from './cost.js';

describe('estimateCostUsd', () => {
  const pricing = { inputPerMillion: 1, outputPerMillion: 5 }; // e.g. Haiku 4.5 first-party rate

  it('computes cost from real token usage × pricing', () => {
    const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }, pricing);
    expect(cost).toBeCloseTo(6, 10);
  });

  it('returns null when usage is missing — never treats a missing measurement as $0', () => {
    expect(estimateCostUsd(null, pricing)).toBeNull();
    expect(estimateCostUsd({ inputTokens: null, outputTokens: null, totalTokens: null }, pricing)).toBeNull();
  });

  it('tolerates one missing side (counts only what is known)', () => {
    expect(estimateCostUsd({ inputTokens: 500_000, outputTokens: null, totalTokens: null }, pricing)).toBeCloseTo(0.5, 10);
  });
});

describe('pricingFromEnv', () => {
  it('reads pricing from env or returns null when unset', () => {
    expect(pricingFromEnv({ AI_INPUT_PRICE_PER_M: '0.14', AI_OUTPUT_PRICE_PER_M: '0.28' })).toEqual({
      inputPerMillion: 0.14,
      outputPerMillion: 0.28,
    });
    expect(pricingFromEnv({})).toBeNull();
    expect(pricingFromEnv({ AI_INPUT_PRICE_PER_M: 'abc', AI_OUTPUT_PRICE_PER_M: '1' })).toBeNull();
  });
});
