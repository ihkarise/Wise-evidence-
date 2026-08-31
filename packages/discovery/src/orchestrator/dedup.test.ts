import { describe, it, expect } from "vitest";
import { classifyDuplicate, yearOf } from "./dedup.js";
import { InMemoryStudyIndex } from "./store.js";
import type { NormalizedSourceItem, Provenance } from "../types.js";

function prov(sourceId: string, doi: string | null): Provenance {
  return {
    sourceKey: "mock",
    sourceId,
    sourceUrl: null,
    doi,
    discoveredAt: "2026-03-01T00:00:00.000Z",
    fetchedAt: null,
    providerVersion: "test/1",
    rawHash: null,
  };
}

function norm(overrides: Partial<NormalizedSourceItem>): NormalizedSourceItem {
  return {
    canonicalDoi: null,
    normalizedTitle: null,
    title: "",
    authors: [],
    journal: null,
    publicationDate: null,
    abstract: null,
    url: null,
    identifiers: [],
    provenance: prov("s-1", null),
    ...overrides,
  };
}

describe("classifyDuplicate (graded, conservative)", () => {
  const index = new InMemoryStudyIndex([
    { studyId: "study-doi", doi: "10.0000/known.doi" },
    { studyId: "study-pmid", identifiers: [{ type: "PMID", value: "12345678" }] },
    { studyId: "study-title", normalizedTitle: "a known trial", year: "2020" },
  ]);

  it("DEFINITE on exact DOI", async () => {
    const d = await classifyDuplicate(norm({ canonicalDoi: "10.0000/known.doi" }), index);
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.matchedBy).toBe("DOI");
    expect(d.relatedStudyId).toBe("study-doi");
  });

  it("DEFINITE on exact PMID", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "PMID", value: "12345678" }] }),
      index,
    );
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.matchedBy).toBe("PERSISTENT_ID");
  });

  it("PROBABLE on normalized title + year", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known trial", publicationDate: "2020-05" }),
      index,
    );
    expect(d.verdict).toBe("PROBABLE_DUPLICATE");
    expect(d.matchedBy).toBe("TITLE_YEAR");
  });

  it("POSSIBLE on normalized title only (year unconfirmed)", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known trial", publicationDate: null }),
      index,
    );
    expect(d.verdict).toBe("POSSIBLE_DUPLICATE");
    expect(d.matchedBy).toBe("TITLE");
  });

  it("NEW when nothing matches", async () => {
    const d = await classifyDuplicate(norm({ canonicalDoi: "10.0000/unknown" }), index);
    expect(d.verdict).toBe("NEW");
    expect(d.relatedStudyId).toBeNull();
  });

  it("yearOf extracts the leading 4-digit year", () => {
    expect(yearOf("2021-03-01")).toBe("2021");
    expect(yearOf("2019")).toBe("2019");
    expect(yearOf(null)).toBeNull();
  });
});
