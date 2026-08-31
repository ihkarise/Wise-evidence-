/**
 * Normalization + provenance tests (M7.1). These prove the CANDIDATE boundary:
 * source-derived metadata is sanitized and canonicalised, provenance is complete
 * and traceable, and no outcome/efficacy/AI value is ever produced.
 */
import { describe, it, expect } from "vitest";
import { normalizeSourceItem } from "./normalize.js";
import type { NormalizationContext, SourceItem } from "./index.js";

const CTX: NormalizationContext = {
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fetchedAt: "2026-01-01T00:05:00.000Z",
  providerVersion: "mock-discovery/1",
  rawHash: "a".repeat(64),
};

function item(overrides: Partial<SourceItem>): SourceItem {
  return {
    sourceKey: "mock",
    sourceId: "s-1",
    sourceUrl: null,
    doi: null,
    identifiers: [],
    title: "A title",
    authors: [],
    journal: null,
    publicationDate: null,
    abstract: null,
    raw: {},
    ...overrides,
  };
}

describe("normalizeSourceItem", () => {
  it("canonicalises a DOI and derives a normalized title", () => {
    const result = normalizeSourceItem(
      item({ doi: "https://doi.org/10.0000/Wise.Norm.A", title: "  A   Spaced   Title " }),
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.canonicalDoi).toBe("10.0000/wise.norm.a");
    expect(result.value.title).toBe("A Spaced Title");
    expect(result.value.normalizedTitle).toBeTypeOf("string");
  });

  it("keeps the item when the DOI is invalid but a title exists (canonicalDoi null)", () => {
    const result = normalizeSourceItem(item({ doi: "not-a-doi", title: "Has a title" }), CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.canonicalDoi).toBeNull();
    expect(result.value.title).toBe("Has a title");
  });

  it("adds a canonical DOI identifier and de-duplicates identifiers", () => {
    const result = normalizeSourceItem(
      item({
        doi: "10.0000/wise.norm.b",
        identifiers: [
          { type: "DOI", value: "10.0000/wise.norm.b" },
          { type: "SOURCE_ID", value: "abc" },
          { type: "SOURCE_ID", value: "abc" },
        ],
      }),
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dois = result.value.identifiers.filter((i) => i.type === "DOI");
    const sids = result.value.identifiers.filter((i) => i.type === "SOURCE_ID");
    expect(dois).toHaveLength(1);
    expect(sids).toHaveLength(1);
  });

  it("strips markup from the abstract (never emits HTML)", () => {
    const result = normalizeSourceItem(
      item({ abstract: "<jats:p>Hello <b>world</b></jats:p><script>alert(1)</script>" }),
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.abstract).not.toContain("<");
    expect(result.value.abstract).toContain("Hello");
  });

  it("only accepts http(s) source URLs", () => {
    const bad = normalizeSourceItem(item({ sourceUrl: "javascript:alert(1)" }), CTX);
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.value.url).toBeNull();
  });

  it("builds complete, traceable provenance", () => {
    const result = normalizeSourceItem(
      item({
        sourceId: "prov-1",
        doi: "10.0000/wise.norm.c",
        sourceUrl: "https://doi.org/10.0000/wise.norm.c",
      }),
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance).toEqual({
      sourceKey: "mock",
      sourceId: "prov-1",
      sourceUrl: "https://doi.org/10.0000/wise.norm.c",
      doi: "10.0000/wise.norm.c",
      discoveredAt: CTX.discoveredAt,
      fetchedAt: CTX.fetchedAt,
      providerVersion: "mock-discovery/1",
      rawHash: "a".repeat(64),
    });
  });

  it("rejects an item with no source id (NORMALIZATION_FAILED)", () => {
    const result = normalizeSourceItem(item({ sourceId: "  " }), CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NORMALIZATION_FAILED");
  });

  it("rejects an item with neither a valid DOI nor a title (INSUFFICIENT_METADATA)", () => {
    const result = normalizeSourceItem(item({ doi: null, title: null }), CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_METADATA");
  });

  it("produces NO outcome/efficacy/quality/criticism field (discovery ≠ classification)", () => {
    const result = normalizeSourceItem(item({ doi: "10.0000/wise.norm.d" }), CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = Object.keys(result.value);
    for (const forbidden of [
      "outcome",
      "efficacy",
      "quality",
      "criticism",
      "confidence",
      "score",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
