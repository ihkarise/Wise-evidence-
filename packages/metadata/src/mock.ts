/**
 * MockMetadataProvider — deterministic, offline metadata for local dev and CI
 * (docs/26 §5, docs/21 local-dev rule). It makes NO network request and costs
 * nothing, so the whole manual DOI flow runs without a live provider.
 *
 * It returns sanitized `NormalizedMetadata` for a small fixture set keyed by
 * canonical DOI, and `not-found` for anything else — mirroring the real
 * provider's contract exactly.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import type { MetadataLookupResult, MetadataProvider, NormalizedMetadata } from "./types.js";
import { LIMITS, sanitizeMarkupToText, sanitizeText } from "./sanitize.js";

/** A relaxed fixture shape; values are sanitized on the way out. */
export interface MockFixture {
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly journalTitle?: string | null;
  readonly publisher?: string | null;
  readonly publicationDate?: string | null;
  readonly abstract?: string | null;
  readonly url?: string | null;
}

/**
 * Default fixtures. DOIs use the reserved, non-existent `10.0000/…` registrant
 * so they can never collide with a real DOI (same convention as the DEMO
 * fixtures, docs/25 §9).
 */
export const DEFAULT_MOCK_FIXTURES: Record<string, MockFixture> = {
  "10.0000/wise.mock.positive": {
    title: "A randomized placebo-controlled trial of an individualized intervention",
    authors: ["Jane Q. Smith", "Robert A. Müller"],
    journalTitle: "Journal of Example Research",
    publisher: "Example Press",
    publicationDate: "2021-03-01",
    abstract: "This mock abstract describes a fictional randomized controlled trial.",
    url: "https://doi.org/10.0000/wise.mock.positive",
  },
  "10.0000/wise.mock.minimal": {
    title: "A record with only a title",
  },
};

export class MockMetadataProvider implements MetadataProvider {
  readonly name = "mock";
  readonly #fixtures: Record<string, MockFixture>;

  constructor(fixtures: Record<string, MockFixture> = DEFAULT_MOCK_FIXTURES) {
    this.#fixtures = fixtures;
  }

  fetchByDoi(doi: string): Promise<MetadataLookupResult> {
    const canonical = toCanonicalDoi(doi);
    if (canonical === null) {
      return Promise.resolve({ ok: false, reason: "invalid-doi" });
    }
    const fixture = this.#fixtures[canonical];
    if (!fixture) {
      return Promise.resolve({ ok: false, reason: "not-found" });
    }

    const metadata: NormalizedMetadata = {
      doi: canonical,
      title: sanitizeText(fixture.title, LIMITS.title) ?? "",
      authors: (fixture.authors ?? [])
        .slice(0, LIMITS.maxAuthors)
        .map((name, order) => ({
          displayName: sanitizeText(name, LIMITS.authorName) ?? "",
          order,
        }))
        .filter((a) => a.displayName.length > 0),
      journalTitle: sanitizeText(fixture.journalTitle, LIMITS.journalTitle),
      publisher: sanitizeText(fixture.publisher, LIMITS.publisher),
      publicationDate: sanitizeText(fixture.publicationDate, 10),
      abstract: sanitizeMarkupToText(fixture.abstract, LIMITS.abstract),
      url: fixture.url ? sanitizeText(fixture.url, LIMITS.url) : null,
      provider: this.name,
    };
    return Promise.resolve({ ok: true, metadata });
  }
}
