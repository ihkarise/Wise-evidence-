/**
 * Catalogue + pricing verification tests (master prompt §5, §9, §10, §28).
 *
 * All offline with an injected fake fetch. Verifies: OpenRouter body parsing and
 * per-token→per-MTok conversion; a missing candidate is unavailable (never
 * substituted); incomplete pricing is unverified (never guessed); a failed/blocked
 * catalogue call marks every candidate unavailable with the exact error.
 */
import { describe, it, expect } from "vitest";
import {
  fetchCatalogue,
  parseCatalogue,
  verifyCandidates,
  type CatalogueFetch,
} from "./catalogue.js";

const OPENROUTER_BODY = JSON.stringify({
  data: [
    {
      id: "deepseek/deepseek-v4-flash-latest",
      pricing: { prompt: "0.00000004", completion: "0.00000008" },
    },
    { id: "qwen/qwen3.5-35b-a3b", pricing: { prompt: "0.00000014", completion: "0.000001" } },
    { id: "no-price/model", pricing: {} },
  ],
});

function fakeFetch(body: string, ok = true, status = 200): CatalogueFetch {
  return () => Promise.resolve({ ok, status, text: () => Promise.resolve(body) });
}

describe("parseCatalogue", () => {
  it("parses ids and converts per-token USD prices to per-MTok", () => {
    const result = parseCatalogue(OPENROUTER_BODY);
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(3);
    const deepseek = result.entries.get("deepseek/deepseek-v4-flash-latest");
    expect(deepseek?.livePricing).toEqual({ inputPerMTok: 0.04, outputPerMTok: 0.08 });
  });

  it("rejects non-JSON and a missing data array", () => {
    expect(parseCatalogue("<html>").ok).toBe(false);
    expect(parseCatalogue(JSON.stringify({ nope: true })).ok).toBe(false);
  });
});

describe("verifyCandidates", () => {
  it("marks a present, fully-priced model available and pricing-verified", () => {
    const cat = parseCatalogue(OPENROUTER_BODY);
    const [v] = verifyCandidates(["deepseek/deepseek-v4-flash-latest"], cat);
    expect(v!.available).toBe(true);
    expect(v!.pricingVerified).toBe(true);
    expect(v!.livePricing).toEqual({ inputPerMTok: 0.04, outputPerMTok: 0.08 });
  });

  it("marks an absent model unavailable and does NOT substitute", () => {
    const cat = parseCatalogue(OPENROUTER_BODY);
    const [v] = verifyCandidates(["ghost/removed-model"], cat);
    expect(v!.available).toBe(false);
    expect(v!.livePricing).toBeNull();
    expect(v!.note).toMatch(/not found/i);
  });

  it("marks a present model with incomplete pricing unverified (never guessed)", () => {
    const cat = parseCatalogue(OPENROUTER_BODY);
    const [v] = verifyCandidates(["no-price/model"], cat);
    expect(v!.available).toBe(true);
    expect(v!.pricingVerified).toBe(false);
  });

  it("marks every candidate unavailable when the catalogue call failed", () => {
    const cat = { ok: false, error: "catalogue HTTP 403", entries: new Map(), modelCount: 0 };
    const vs = verifyCandidates(["a", "b"], cat);
    expect(vs.every((v) => !v.available)).toBe(true);
    expect(vs[0]!.note).toContain("403");
  });
});

describe("fetchCatalogue (injected fetch)", () => {
  it("returns parsed entries on a 200", async () => {
    const result = await fetchCatalogue(fakeFetch(OPENROUTER_BODY), "https://x/api/v1", null);
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBe(3);
  });

  it("returns a structured error (never throws) on an HTTP failure", async () => {
    const result = await fetchCatalogue(fakeFetch("denied", false, 403), "https://x/api/v1", null);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
  });

  it("returns a network error when fetch rejects", async () => {
    const throwing: CatalogueFetch = () => Promise.reject(new Error("boom"));
    const result = await fetchCatalogue(throwing, "https://x/api/v1", null);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network/i);
  });
});
