/**
 * Candidate-model / pricing config tests (master prompt §9, §10). The default
 * candidates match the operator list; env can override; provisional pricing is
 * carried but never treated as verified here.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_CANDIDATES, parseCandidates } from "./models.js";

describe("candidate models", () => {
  it("default candidates are the operator-supplied three", () => {
    expect(DEFAULT_CANDIDATES.map((c) => c.id)).toEqual([
      "deepseek/deepseek-v4-flash-latest",
      "qwen/qwen3.5-35b-a3b",
      "google/gemini-3.7-flash",
    ]);
  });

  it("carries provisional pricing per MTok (unverified until catalogue check)", () => {
    const deepseek = DEFAULT_CANDIDATES[0]!;
    expect(deepseek.provisionalPricing).toEqual({ inputPerMTok: 0.04, outputPerMTok: 0.08 });
  });

  it("falls back to the default list when BENCH_MODELS is absent", () => {
    const got = parseCandidates({}, { inputPerMTok: null, outputPerMTok: null });
    expect(got).toBe(DEFAULT_CANDIDATES);
  });

  it("parses a comma-separated override and applies fallback pricing", () => {
    const got = parseCandidates(
      { BENCH_MODELS: " a/one , b/two " },
      { inputPerMTok: 1, outputPerMTok: 2 },
    );
    expect(got.map((c) => c.id)).toEqual(["a/one", "b/two"]);
    expect(got[0]!.provisionalPricing).toEqual({ inputPerMTok: 1, outputPerMTok: 2 });
  });
});
