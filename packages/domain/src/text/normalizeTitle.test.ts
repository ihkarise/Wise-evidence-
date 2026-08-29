import { describe, it, expect } from "vitest";
import { normalizeTitle } from "./normalizeTitle.js";

describe("normalizeTitle", () => {
  it("lower-cases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeTitle("  A  Trial: Of Something! ")).toBe("a trial of something");
  });

  it("folds accents so equivalent titles converge", () => {
    expect(normalizeTitle("Étude Contrôlée")).toBe(normalizeTitle("Etude Controlee"));
  });

  it("reduces symbols to spaces", () => {
    expect(normalizeTitle("Homeopathy & Asthma")).toBe("homeopathy asthma");
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeTitle("   ")).toBe("");
    expect(normalizeTitle("")).toBe("");
  });
});
