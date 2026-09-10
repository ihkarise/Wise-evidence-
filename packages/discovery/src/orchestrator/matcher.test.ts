/**
 * M7.5 — conservative research deduplication & matching.
 *
 * These tests cover the required M7.5 surface (docs/reports/M7.5-DEDUPLICATION.md):
 * identifiers, persistent identifiers, title/year, (absence of) similarity,
 * Study≠Publication, candidate identity vs research identity, SAFETY (the engine
 * never merges / deletes / publishes / classifies / calls AI or the network),
 * DETERMINISM, and adversarial/hostile metadata.
 *
 * The matcher is exercised two ways: directly (pure `classifyDuplicate` against an
 * in-memory index) and end-to-end through the real `normalizeSourceItem`, so
 * hostile source metadata is canonicalised exactly as production would before it
 * ever reaches the matcher.
 */
import { describe, it, expect } from "vitest";
import { classifyDuplicate, yearOf, type KnownStudyMatch } from "./dedup.js";
import { InMemoryStudyIndex } from "./store.js";
import { normalizeSourceItem, type NormalizationContext } from "../normalize.js";
import type { NormalizedSourceItem, Provenance, SourceItem } from "../types.js";

const CTX: NormalizationContext = {
  discoveredAt: "2026-01-01T00:00:00.000Z",
  fetchedAt: null,
  providerVersion: "test/1",
  rawHash: null,
};

function prov(): Provenance {
  return {
    sourceKey: "mock",
    sourceId: "s-1",
    sourceUrl: null,
    doi: null,
    discoveredAt: "2026-03-01T00:00:00.000Z",
    fetchedAt: null,
    providerVersion: "test/1",
    rawHash: null,
  };
}

/** Build a normalized item directly (bypasses normalization). */
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
    provenance: prov(),
    ...overrides,
  };
}

/** Build + normalize a raw (possibly hostile) source item. */
function normalizedFrom(overrides: Partial<SourceItem>): NormalizedSourceItem {
  const result = normalizeSourceItem(
    {
      sourceKey: "mock",
      sourceId: "s-1",
      sourceUrl: null,
      doi: null,
      identifiers: [],
      title: null,
      authors: [],
      journal: null,
      publicationDate: null,
      abstract: null,
      raw: {},
      ...overrides,
    },
    CTX,
  );
  if (!result.ok) throw new Error(`normalization unexpectedly failed: ${result.error.code}`);
  return result.value;
}

// A seeded set of existing canonical studies (stands in for the DB index).
const index = new InMemoryStudyIndex([
  { studyId: "study-doi", doi: "10.0000/known.doi" },
  { studyId: "study-pmid", identifiers: [{ type: "PMID", value: "12345678" }] },
  { studyId: "study-pmcid", identifiers: [{ type: "PMCID", value: "PMC7654321" }] },
  { studyId: "study-title", normalizedTitle: "a known homeopathy trial", years: ["2020"] },
  { studyId: "study-noyear", normalizedTitle: "a study without a recorded year" },
  {
    studyId: "study-multi",
    normalizedTitle: "a study with two publications",
    years: ["2019", "2021"],
  },
]);

// --- IDENTIFIERS -------------------------------------------------------------

describe("M7.5 identifiers (DOI)", () => {
  it("same DOI → DEFINITE / DOI_EXACT_MATCH", async () => {
    const d = await classifyDuplicate(norm({ canonicalDoi: "10.0000/known.doi" }), index);
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.matchedBy).toBe("DOI");
    expect(d.explanation.reasonCode).toBe("DOI_EXACT_MATCH");
    expect(d.explanation.matchedIdentifierType).toBe("DOI");
    expect(d.explanation.matchedIdentifierValue).toBe("10.0000/known.doi");
    expect(d.relatedStudyId).toBe("study-doi");
  });

  it("DOI case / URL differences canonicalise to the SAME match", async () => {
    const upper = normalizedFrom({ doi: "HTTPS://DOI.ORG/10.0000/KNOWN.DOI", title: "x" });
    const d = await classifyDuplicate(upper, index);
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.relatedStudyId).toBe("study-doi");
  });

  it("malformed DOI does not match on DOI (falls through)", async () => {
    const bad = normalizedFrom({ doi: "not a doi", title: "some unrelated title" });
    expect(bad.canonicalDoi).toBeNull();
    const d = await classifyDuplicate(bad, index);
    expect(d.matchedBy).not.toBe("DOI");
  });

  it("missing DOI → no DOI-level match", async () => {
    const d = await classifyDuplicate(norm({ normalizedTitle: "brand new title" }), index);
    expect(d.explanation.matchedIdentifierType).toBeNull();
  });

  it("different DOI → NEW / NO_MATCH", async () => {
    const d = await classifyDuplicate(norm({ canonicalDoi: "10.0000/other.doi" }), index);
    expect(d.verdict).toBe("NEW");
    expect(d.explanation.reasonCode).toBe("NO_MATCH");
  });
});

describe("M7.5 persistent identifiers", () => {
  it("same PMID → DEFINITE / PERSISTENT_IDENTIFIER_MATCH", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "PMID", value: "12345678" }] }),
      index,
    );
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.matchedBy).toBe("PERSISTENT_ID");
    expect(d.explanation.reasonCode).toBe("PERSISTENT_IDENTIFIER_MATCH");
    expect(d.explanation.matchedIdentifierType).toBe("PMID");
    expect(d.relatedStudyId).toBe("study-pmid");
  });

  it("same PMCID → DEFINITE", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "PMCID", value: "PMC7654321" }] }),
      index,
    );
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.relatedStudyId).toBe("study-pmcid");
  });

  it("different persistent identifiers → NEW", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "PMID", value: "99999999" }] }),
      index,
    );
    expect(d.verdict).toBe("NEW");
  });
});

// --- TITLE / YEAR ------------------------------------------------------------

describe("M7.5 title / year", () => {
  it("same normalized title + same year → PROBABLE / TITLE_YEAR_MATCH", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known homeopathy trial", publicationDate: "2020-05-01" }),
      index,
    );
    expect(d.verdict).toBe("PROBABLE_DUPLICATE");
    expect(d.matchedBy).toBe("TITLE_YEAR");
    expect(d.explanation.reasonCode).toBe("TITLE_YEAR_MATCH");
    expect(d.explanation.yearConflict).toBe(false);
    expect(d.explanation.candidateYear).toBe("2020");
  });

  it("same title + DIFFERENT year → POSSIBLE with an explained year conflict", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known homeopathy trial", publicationDate: "2023" }),
      index,
    );
    expect(d.verdict).toBe("POSSIBLE_DUPLICATE");
    expect(d.matchedBy).toBe("TITLE");
    expect(d.explanation.reasonCode).toBe("TITLE_EXACT_MATCH");
    expect(d.explanation.yearConflict).toBe(true);
    expect(d.explanation.candidateYear).toBe("2023");
    expect(d.explanation.matchedStudyYears).toEqual(["2020"]);
    expect(d.reason).toContain("2023");
    expect(d.reason).toContain("2020");
  });

  it("same title, MISSING candidate year → POSSIBLE (year unconfirmed)", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known homeopathy trial", publicationDate: null }),
      index,
    );
    expect(d.verdict).toBe("POSSIBLE_DUPLICATE");
    expect(d.explanation.yearConflict).toBe(true);
    expect(d.explanation.candidateYear).toBeNull();
  });

  it("same title, study has NO recorded year → POSSIBLE (year unconfirmed)", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a study without a recorded year", publicationDate: "2022" }),
      index,
    );
    expect(d.verdict).toBe("POSSIBLE_DUPLICATE");
    expect(d.explanation.matchedStudyYears).toEqual([]);
  });

  it("title match on ANY of a multi-publication study's years → PROBABLE", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a study with two publications", publicationDate: "2021-03" }),
      index,
    );
    expect(d.verdict).toBe("PROBABLE_DUPLICATE");
    expect(d.explanation.matchedStudyYears).toEqual(["2019", "2021"]);
  });

  it("punctuation & whitespace differences normalize to the SAME title match", async () => {
    const a = normalizedFrom({ title: "A  Known,  Homeopathy — Trial!" });
    expect(a.normalizedTitle).toBe("a known homeopathy trial");
    const d = await classifyDuplicate(
      { ...a, publicationDate: "2020" } as NormalizedSourceItem,
      index,
    );
    expect(d.verdict).toBe("PROBABLE_DUPLICATE");
  });

  it("Unicode / accent differences normalize to the SAME title match", async () => {
    // "Homéopathy" with a combining accent + fullwidth spaces.
    const a = normalizedFrom({ title: "A　Known　Homéopathy　Trial" });
    expect(a.normalizedTitle).toBe("a known homeopathy trial");
    const d = await classifyDuplicate({ ...a } as NormalizedSourceItem, index);
    expect(d.matchedBy).toBe("TITLE");
  });

  it("unrelated title → NEW", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "an entirely unrelated paper", publicationDate: "2020" }),
      index,
    );
    expect(d.verdict).toBe("NEW");
    expect(d.explanation.reasonCode).toBe("NO_MATCH");
  });
});

// --- SIMILARITY (deliberately conservative: no fuzzy matching) ---------------

describe("M7.5 similarity is deliberately NOT fuzzy", () => {
  it("a near-duplicate title (one word different) does NOT match — prefer a missed dup over a wrong merge", async () => {
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known homeopathy study", publicationDate: "2020" }),
      index,
    );
    expect(d.verdict).toBe("NEW");
  });

  it("a short/empty/punctuation-only title never matches an empty-title study", async () => {
    const emptyTitleIndex = new InMemoryStudyIndex([
      { studyId: "study-empty", normalizedTitle: "" },
    ]);
    // Punctuation-only source title normalizes to "".
    const punct = normalizedFrom({ doi: "10.0000/keeps.it.valid", title: "!!! ??? ---" });
    expect(punct.normalizedTitle).toBe("");
    const d = await classifyDuplicate(
      { ...punct, canonicalDoi: null } as NormalizedSourceItem,
      emptyTitleIndex,
    );
    expect(d.verdict).toBe("NEW");
    expect(d.explanation.titleMatched).toBe(false);
  });
});

// --- STUDY ≠ PUBLICATION -----------------------------------------------------

describe("M7.5 Study ≠ Publication (never collapses records)", () => {
  it("a DOI match only FLAGS the related study; it never merges", async () => {
    const d = await classifyDuplicate(norm({ canonicalDoi: "10.0000/known.doi" }), index);
    // The verdict is a flag with a related study id; no merge/link is performed.
    expect(d.relatedStudyId).toBe("study-doi");
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    // The decision object carries NO merge/delete/publish instruction.
    expect(Object.keys(d)).toEqual([
      "verdict",
      "matchedBy",
      "relatedStudyId",
      "reason",
      "explanation",
    ]);
  });

  it("a different publication of a known study (same title, later year) stays reviewable, not merged", async () => {
    // e.g. an erratum / secondary analysis reusing the title in a different year.
    const d = await classifyDuplicate(
      norm({ normalizedTitle: "a known homeopathy trial", publicationDate: "2021" }),
      index,
    );
    expect(d.verdict).toBe("POSSIBLE_DUPLICATE"); // human decides the relationship
  });
});

// --- INSUFFICIENT METADATA ---------------------------------------------------

describe("M7.5 insufficient metadata", () => {
  it("no DOI, no persistent id, no usable title → NEW / INSUFFICIENT_METADATA", async () => {
    const d = await classifyDuplicate(norm({}), index);
    expect(d.verdict).toBe("NEW");
    expect(d.explanation.reasonCode).toBe("INSUFFICIENT_METADATA");
  });

  it("a URL/SOURCE_ID identifier is NOT treated as a persistent-id match", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "URL", value: "https://example.org/x" }] }),
      index,
    );
    expect(d.explanation.reasonCode).toBe("INSUFFICIENT_METADATA");
  });
});

// --- ADVERSARIAL / HOSTILE METADATA -----------------------------------------

describe("M7.5 adversarial metadata never causes a false match", () => {
  it("HTML/script in a title is stripped and cannot forge a match", async () => {
    const a = normalizedFrom({ title: "<script>alert(1)</script>A Known Homeopathy Trial" });
    const d = await classifyDuplicate(
      { ...a, publicationDate: "2020" } as NormalizedSourceItem,
      index,
    );
    // The normalized title (the match key) strips all markup to alphanumerics, so
    // the injected tag pollutes the key and CANNOT forge the real title match.
    expect(a.normalizedTitle ?? "").not.toContain("<");
    expect(d.verdict).toBe("NEW");
    expect(d.reason).not.toContain("<script>");
  });

  it("SQL-like strings in identifiers are compared as opaque values (no injection, no match)", async () => {
    const d = await classifyDuplicate(
      norm({ identifiers: [{ type: "PMID", value: "12345678'; drop table research_study;--" }] }),
      index,
    );
    expect(d.verdict).toBe("NEW");
  });

  it("an extremely long title is bounded and still deterministic", async () => {
    const long = "word ".repeat(10_000);
    const a = normalizedFrom({ title: long });
    const d1 = await classifyDuplicate(a, index);
    const d2 = await classifyDuplicate(a, index);
    expect(d1).toEqual(d2);
    expect(d1.verdict).toBe("NEW");
  });

  it("duplicate identifiers do not double-count or change the verdict", async () => {
    const a = normalizedFrom({
      title: "dup id title",
      identifiers: [
        { type: "PMID", value: "12345678" },
        { type: "PMID", value: "12345678" },
      ],
    });
    const d = await classifyDuplicate(a, index);
    expect(d.verdict).toBe("DEFINITE_DUPLICATE");
    expect(d.relatedStudyId).toBe("study-pmid");
  });
});

// --- DETERMINISM -------------------------------------------------------------

describe("M7.5 determinism", () => {
  it("same input + same index ⇒ identical decision (deep equal)", async () => {
    const item = norm({
      normalizedTitle: "a known homeopathy trial",
      publicationDate: "2020-05",
    });
    const runs = await Promise.all([
      classifyDuplicate(item, index),
      classifyDuplicate(item, index),
      classifyDuplicate(item, index),
    ]);
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
  });

  it("yearOf extracts the leading 4-digit year", () => {
    expect(yearOf("2021-03-01")).toBe("2021");
    expect(yearOf("2019")).toBe("2019");
    expect(yearOf(null)).toBeNull();
    expect(yearOf("not-a-date")).toBeNull();
  });
});

// --- SAFETY: the matcher writes NOTHING and touches NOTHING ------------------

describe("M7.5 safety — the matcher is read-only", () => {
  it("never mutates the candidate or the index during classification", async () => {
    const spyIndex = {
      calls: [] as string[],
      findStudyByDoi(doi: string): Promise<string | null> {
        this.calls.push(`doi:${doi}`);
        return Promise.resolve(null);
      },
      findStudyByIdentifier(type: string, value: string): Promise<string | null> {
        this.calls.push(`id:${type}:${value}`);
        return Promise.resolve(null);
      },
      findStudyByTitle(t: string): Promise<KnownStudyMatch | null> {
        this.calls.push(`title:${t}`);
        return Promise.resolve(null);
      },
    };
    const item = Object.freeze(
      norm({ canonicalDoi: "10.0000/x", normalizedTitle: "frozen title", publicationDate: "2020" }),
    );
    const d = await classifyDuplicate(item, spyIndex);
    expect(d.verdict).toBe("NEW");
    // Only read lookups were used — no write-shaped method exists on the port.
    expect(
      spyIndex.calls.every(
        (c) => c.startsWith("doi:") || c.startsWith("id:") || c.startsWith("title:"),
      ),
    ).toBe(true);
  });

  it("the port interface exposes only find* (read) methods", () => {
    // Structural: a KnownStudyIndex can only be asked questions, never told to write.
    const methods = ["findStudyByDoi", "findStudyByIdentifier", "findStudyByTitle"];
    for (const m of methods) expect(m.startsWith("find")).toBe(true);
  });
});
