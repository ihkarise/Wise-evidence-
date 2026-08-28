import { describe, it, expect } from "vitest";
import { normalizeDoi, toCanonicalDoi, isValidDoi } from "./normalizeDoi";

const CANONICAL = "10.1234/abcd.5678";

describe("normalizeDoi — accepted input forms", () => {
  it("accepts a bare DOI", () => {
    expect(normalizeDoi("10.1234/abcd.5678")).toEqual({ ok: true, doi: CANONICAL });
  });

  it("accepts a doi: prefixed DOI", () => {
    expect(normalizeDoi("doi:10.1234/abcd.5678")).toEqual({ ok: true, doi: CANONICAL });
  });

  it("accepts an https doi.org URL", () => {
    expect(normalizeDoi("https://doi.org/10.1234/abcd.5678")).toEqual({
      ok: true,
      doi: CANONICAL,
    });
  });

  it("accepts an http doi.org URL", () => {
    expect(normalizeDoi("http://doi.org/10.1234/abcd.5678")).toEqual({
      ok: true,
      doi: CANONICAL,
    });
  });

  it("accepts the legacy dx.doi.org resolver host", () => {
    expect(normalizeDoi("https://dx.doi.org/10.1234/abcd.5678")).toEqual({
      ok: true,
      doi: CANONICAL,
    });
    expect(normalizeDoi("http://dx.doi.org/10.1234/abcd.5678")).toEqual({
      ok: true,
      doi: CANONICAL,
    });
  });

  it("accepts a schemeless doi.org host", () => {
    expect(normalizeDoi("doi.org/10.1234/abcd.5678")).toEqual({ ok: true, doi: CANONICAL });
  });
});

describe("normalizeDoi — casing and whitespace", () => {
  it("lower-cases the DOI", () => {
    expect(normalizeDoi("10.1234/ABCD.5678")).toEqual({ ok: true, doi: CANONICAL });
  });

  it("lower-cases the scheme and resolver host", () => {
    expect(normalizeDoi("DOI:10.1234/ABCD.5678")).toEqual({ ok: true, doi: CANONICAL });
    expect(normalizeDoi("HTTPS://DOI.ORG/10.1234/ABCD.5678")).toEqual({
      ok: true,
      doi: CANONICAL,
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDoi("   10.1234/abcd.5678   ")).toEqual({ ok: true, doi: CANONICAL });
    expect(normalizeDoi("\t\n 10.1234/abcd.5678 \n")).toEqual({ ok: true, doi: CANONICAL });
  });

  it("tolerates whitespace after the doi: scheme", () => {
    expect(normalizeDoi("doi: 10.1234/abcd.5678")).toEqual({ ok: true, doi: CANONICAL });
  });
});

describe("normalizeDoi — canonical convergence", () => {
  it("maps every accepted form of the same DOI to one identical output", () => {
    const forms = [
      "10.1234/abcd.5678",
      " 10.1234/ABCD.5678 ",
      "doi:10.1234/abcd.5678",
      "DOI:10.1234/ABCD.5678",
      "https://doi.org/10.1234/abcd.5678",
      "http://doi.org/10.1234/ABCD.5678",
      "https://dx.doi.org/10.1234/abcd.5678",
      "doi.org/10.1234/ABCD.5678",
    ];

    const outputs = new Set(
      forms.map((form) => {
        const result = normalizeDoi(form);
        expect(result.ok).toBe(true);
        return result.ok ? result.doi : "";
      }),
    );

    expect(outputs.size).toBe(1);
    expect([...outputs][0]).toBe(CANONICAL);
  });

  it("is idempotent: normalizing a canonical DOI returns the same value", () => {
    const once = toCanonicalDoi("https://doi.org/10.1234/abcd.5678");
    expect(once).not.toBeNull();
    expect(toCanonicalDoi(once as string)).toBe(CANONICAL);
  });
});

describe("normalizeDoi — rejected input", () => {
  it("rejects an empty string", () => {
    expect(normalizeDoi("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a whitespace-only string", () => {
    expect(normalizeDoi("    ")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeDoi("\t\n")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a non-string input defensively", () => {
    // Force the runtime boundary guard (callers may be untyped JS).
    expect(normalizeDoi(undefined as unknown as string)).toEqual({ ok: false, reason: "empty" });
    expect(normalizeDoi(null as unknown as string)).toEqual({ ok: false, reason: "empty" });
    expect(normalizeDoi(42 as unknown as string)).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a DOI with no registrant/suffix", () => {
    expect(normalizeDoi("10.1234")).toEqual({ ok: false, reason: "invalid-format" });
    expect(normalizeDoi("10.1234/")).toEqual({ ok: false, reason: "invalid-format" });
    expect(normalizeDoi("10./abcd")).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects values that do not start with the 10. prefix", () => {
    expect(normalizeDoi("11.1234/abcd")).toEqual({ ok: false, reason: "invalid-format" });
    expect(normalizeDoi("not-a-doi")).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects a DOI carried on a non-resolver host", () => {
    expect(normalizeDoi("https://evil.example.com/10.1234/abcd")).toEqual({
      ok: false,
      reason: "invalid-format",
    });
  });

  it("rejects DOI-like values with embedded whitespace", () => {
    expect(normalizeDoi("10.1234/ab cd")).toEqual({ ok: false, reason: "invalid-format" });
  });

  it("rejects unsafe scheme-injection attempts", () => {
    expect(normalizeDoi("javascript:alert(1)//10.1234/abcd")).toEqual({
      ok: false,
      reason: "invalid-format",
    });
  });
});

describe("helper wrappers", () => {
  it("toCanonicalDoi returns the string or null", () => {
    expect(toCanonicalDoi("https://doi.org/10.1234/abcd.5678")).toBe(CANONICAL);
    expect(toCanonicalDoi("nope")).toBeNull();
  });

  it("isValidDoi reflects acceptance", () => {
    expect(isValidDoi("10.1234/abcd.5678")).toBe(true);
    expect(isValidDoi("nope")).toBe(false);
  });
});
