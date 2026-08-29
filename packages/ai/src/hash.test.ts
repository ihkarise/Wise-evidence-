/**
 * Hashing + cache-identity tests (docs/29 §13, §21). The input hash must be
 * deterministic and key-order-independent, and distinct inputs must differ.
 */
import { describe, it, expect } from "vitest";
import { hashInput, canonicalize, sha256Hex } from "./hash.js";

describe("canonicalize", () => {
  it("sorts object keys recursively (order-independent)", () => {
    expect(canonicalize({ a: 1, b: { d: 4, c: 3 } })).toBe(
      canonicalize({ b: { c: 3, d: 4 }, a: 1 }),
    );
  });

  it("preserves array order (order is meaningful)", () => {
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  it("drops undefined object properties", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
  });
});

describe("hashInput", () => {
  it("is deterministic and order-independent", () => {
    const a = hashInput({ title: "T", abstract: "A", year: 2020 });
    const b = hashInput({ year: 2020, abstract: "A", title: "T" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any field changes", () => {
    const base = hashInput({ title: "T", year: 2020 });
    expect(hashInput({ title: "T", year: 2021 })).not.toBe(base);
    expect(hashInput({ title: "T2", year: 2020 })).not.toBe(base);
  });

  it("sha256Hex matches a known vector", () => {
    // echo -n "" | sha256sum
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
