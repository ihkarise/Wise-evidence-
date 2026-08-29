/**
 * Cost-derivation tests (docs/29 §16, §21). Cost comes ONLY from real usage +
 * operator pricing; unknown usage or unknown pricing → null, never a guessed $0.
 */
import { describe, it, expect } from "vitest";
import { deriveCost, parsePricing } from "./cost.js";

const pricing = { inputPerMTok: 1, outputPerMTok: 2 };

describe("deriveCost", () => {
  it("computes cost from usage and pricing", () => {
    const cost = deriveCost(
      { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: null },
      pricing,
    );
    expect(cost).toBeCloseTo(1 * 1 + 0.5 * 2, 10); // 2.0
  });

  it("is null when usage is unavailable (never zero)", () => {
    expect(
      deriveCost({ inputTokens: null, outputTokens: 5, totalTokens: null }, pricing),
    ).toBeNull();
    expect(
      deriveCost({ inputTokens: 5, outputTokens: null, totalTokens: null }, pricing),
    ).toBeNull();
  });

  it("is null when pricing is unavailable (never guessed)", () => {
    expect(deriveCost({ inputTokens: 10, outputTokens: 10, totalTokens: 20 }, null)).toBeNull();
    expect(
      deriveCost(
        { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        {
          inputPerMTok: null,
          outputPerMTok: 2,
        },
      ),
    ).toBeNull();
  });

  it("treats a real zero-token count as zero cost (not null)", () => {
    expect(deriveCost({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, pricing)).toBe(0);
  });
});

describe("parsePricing", () => {
  it("parses numeric strings and rejects empty/invalid as null", () => {
    expect(parsePricing("1.5", "3")).toEqual({ inputPerMTok: 1.5, outputPerMTok: 3 });
    expect(parsePricing("", undefined)).toEqual({ inputPerMTok: null, outputPerMTok: null });
    expect(parsePricing("abc", "-1")).toEqual({ inputPerMTok: null, outputPerMTok: null });
  });
});
