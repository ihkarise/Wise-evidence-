/**
 * M4 Public Research Explorer tests (docs/27 §14). The explorer is a
 * PostgreSQL-only, PUBLISHED-only query layer. These tests drive it two ways:
 *
 *   - through the ANON role the Supabase shim recreates (production RLS is the
 *     authoritative gate — the realistic public path), and
 *   - through the privileged owner path when arranging fixtures.
 *
 * Coverage (task brief): published-only results; drafts/pending/rejected/
 * archived excluded; exact DOI lookup; title / metadata search; every filter
 * and combinations; each sort; pagination + out-of-range pages; empty results;
 * invalid parameters; SQL-injection-style input; one-study-multiple-publications
 * yields a single card; correct counts; and RLS/public visibility.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";
import {
  parseSearchParams,
  searchPublishedResearch,
  getFilterOptions,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createDraftFromMetadata,
  updateStudyIdentity,
  setOutcome,
  setQualitySummary,
  linkCondition,
  linkIntervention,
  submitForReview,
  approveAndPublish,
  rejectStudy,
  archiveStudy,
  type Actor,
  type SearchQuery,
} from "../src/index.js";

const ADMIN: Actor = { id: "10000000-0000-0000-0000-0000000000ad", role: "ADMIN" };
const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" }; // seeded

const DRAFT_DEMO = "20000000-0000-0000-0000-000000000009";
const MULTIPUB_STUDY = "20000000-0000-0000-0000-000000000006";

let db: TestDatabase;

/** Run a service mutation on the privileged (post-authorization) server path. */
function svc<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asServiceRole(fn);
}
/** Run a search on the public anon path — RLS-enforced, exactly like production. */
function pub<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asAnon(fn);
}

/** Fully create + publish a real (non-demo) study via the service layer. */
async function publishStudy(opts: {
  doi: string;
  title: string;
  abstract?: string;
  journalTitle?: string;
  authors?: string[];
  outcome?: Parameters<typeof setOutcome>[3];
  quality?: Parameters<typeof setQualitySummary>[3];
  condition?: string;
  intervention?: string;
  studyType?: string;
  publicationDate?: string;
}): Promise<string> {
  const created = await svc((s) =>
    createDraftFromMetadata(s, REVIEWER, {
      doi: opts.doi,
      title: opts.title,
      abstract: opts.abstract ?? null,
      journalTitle: opts.journalTitle ?? null,
      publicationDate: opts.publicationDate ?? "2022-01-01",
      authors: opts.authors ?? [],
      sourceName: "Manual entry (test)",
    }),
  );
  const id = created.studyId;
  if (opts.studyType) {
    await svc((s) => updateStudyIdentity(s, REVIEWER, id, { studyTypeCode: opts.studyType }));
  }
  await svc((s) => setOutcome(s, REVIEWER, id, opts.outcome ?? "POSITIVE", "MODERATE", null));
  if (opts.quality) await svc((s) => setQualitySummary(s, REVIEWER, id, opts.quality!, null));
  if (opts.condition) await svc((s) => linkCondition(s, REVIEWER, id, opts.condition!));
  if (opts.intervention) await svc((s) => linkIntervention(s, REVIEWER, id, opts.intervention!));
  await svc((s) => submitForReview(s, REVIEWER, id));
  await svc((s) => approveAndPublish(s, ADMIN, id));
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  await db.query(
    "insert into app_user (id, email, display_name, role) values ($1, 'admin@example.invalid', 'Admin', 'ADMIN')",
    [ADMIN.id],
  );
  // A real published study with full metadata (authors + journal) so metadata
  // search and the quality filter have coverage the DEMO fixtures lack.
  await publishStudy({
    doi: "10.1234/wise.m4.zinc",
    title: "Zinc Lozenges And Recovery: A Randomized Controlled Trial",
    abstract: "A randomized controlled trial investigating recovery outcomes.",
    journalTitle: "Journal Of Integrative Testing",
    authors: ["Ada Lovelace", "Grace Hopper"],
    outcome: "POSITIVE",
    quality: "HIGH",
    condition: "migraine",
    intervention: "arnica-montana",
    studyType: "RCT",
    publicationDate: "2023-05-01",
  });
});
afterAll(async () => {
  await db.close();
});

function run(raw: Record<string, string | undefined>) {
  return pub((s) => searchPublishedResearch(s, parseSearchParams(raw)));
}

describe("published-only visibility (RLS + explicit predicate)", () => {
  it("returns only published studies, never drafts/pending/rejected/archived", async () => {
    const res = await run({ pageSize: "50" });
    expect(res.items.length).toBeGreaterThan(0);
    // The demo draft (…0009) must never appear.
    expect(res.items.some((c) => c.id === DRAFT_DEMO)).toBe(false);
  });

  it("excludes a freshly created DRAFT even when it matches the query text", async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, {
        doi: "10.1234/wise.m4.secretdraft",
        title: "Unpublishable Secret Draft About Zinc",
      }),
    );
    const res = await run({ q: "Unpublishable Secret Draft" });
    expect(res.items.some((c) => c.id === created.studyId)).toBe(false);
    expect(res.total).toBe(0);
  });

  it("excludes a REJECTED study", async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, {
        doi: "10.1234/wise.m4.rejected",
        title: "Rejected Study About Copper",
      }),
    );
    await svc((s) => submitForReview(s, REVIEWER, created.studyId));
    await svc((s) => rejectStudy(s, ADMIN, created.studyId, "scope"));
    const res = await run({ q: "Copper" });
    expect(res.total).toBe(0);
  });

  it("excludes an ARCHIVED study that was previously published", async () => {
    const id = await publishStudy({
      doi: "10.1234/wise.m4.archiveme",
      title: "Archived Study About Selenium",
    });
    expect((await run({ q: "Selenium" })).total).toBe(1);
    await svc((s) => archiveStudy(s, ADMIN, id, "superseded"));
    expect((await run({ q: "Selenium" })).total).toBe(0);
  });
});

describe("DOI search (exact-match priority)", () => {
  it("finds a study by its exact canonical DOI (bare form)", async () => {
    const res = await run({ q: "10.0000/wise.demo.positive" });
    expect(res.total).toBe(1);
    expect(res.items[0]?.id).toBe("20000000-0000-0000-0000-000000000001");
  });

  it("finds a study by a doi.org URL form of the same DOI", async () => {
    const res = await run({ q: "https://doi.org/10.0000/wise.demo.negative" });
    expect(res.total).toBe(1);
    expect(res.items[0]?.id).toBe("20000000-0000-0000-0000-000000000002");
  });

  it("returns nothing for a well-formed but unknown DOI (no fuzzy fallback)", async () => {
    expect((await run({ q: "10.0000/wise.demo.doesnotexist" })).total).toBe(0);
  });
});

describe("title & metadata search", () => {
  it("matches on title full-text", async () => {
    const res = await run({ q: "zinc lozenges" });
    expect(res.items.some((c) => c.title.includes("Zinc Lozenges"))).toBe(true);
  });

  it("matches on abstract full-text", async () => {
    const res = await run({ q: "recovery outcomes" });
    expect(res.items.some((c) => c.title.includes("Zinc Lozenges"))).toBe(true);
  });

  it("matches on author name (metadata)", async () => {
    const res = await run({ q: "Grace Hopper" });
    expect(res.items.some((c) => c.authors.includes("Grace Hopper"))).toBe(true);
  });

  it("matches on journal name (metadata)", async () => {
    const res = await run({ q: "integrative testing" });
    expect(res.items.some((c) => c.title.includes("Zinc Lozenges"))).toBe(true);
  });

  it("matches on linked condition/intervention (metadata)", async () => {
    const byCondition = await run({ q: "asthma" }); // demo …0001/…0002 link asthma
    expect(byCondition.total).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty result set for a no-match query", async () => {
    const res = await run({ q: "zzzznevermatchesanything" });
    expect(res.items).toHaveLength(0);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(0);
  });
});

describe("filters (canonical taxonomy / enum vocabularies)", () => {
  it("filters by reported outcome (never called effectiveness)", async () => {
    const res = await run({ outcome: "NEGATIVE", pageSize: "50" });
    expect(res.total).toBeGreaterThanOrEqual(1);
    // every returned card that exposes an outcome must be NEGATIVE
    for (const c of res.items) if (c.outcome) expect(c.outcome).toBe("NEGATIVE");
  });

  it("filters by study type (code from study_type reference table)", async () => {
    const res = await run({ studyType: "RCT", pageSize: "50" });
    expect(res.total).toBeGreaterThan(0);
    for (const c of res.items) expect(c.studyTypeCode).toBe("RCT");
  });

  it("filters by evidence level", async () => {
    const res = await run({ evidenceLevel: "RCT", pageSize: "50" });
    expect(res.total).toBeGreaterThan(0);
  });

  it("filters by quality summary (independent of outcome)", async () => {
    const res = await run({ quality: "HIGH", pageSize: "50" });
    expect(res.items.some((c) => c.title.includes("Zinc Lozenges"))).toBe(true);
    for (const c of res.items) if (c.qualitySummary) expect(c.qualitySummary).toBe("HIGH");
  });

  it("filters by condition slug", async () => {
    const res = await run({ condition: "asthma", pageSize: "50" });
    expect(res.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by intervention slug", async () => {
    const res = await run({ intervention: "individualized-homeopathy", pageSize: "50" });
    expect(res.total).toBeGreaterThanOrEqual(2);
  });

  it("filters by publication year", async () => {
    const res = await run({ year: "2021", pageSize: "50" });
    expect(res.items.every((c) => c.year === 2021)).toBe(true);
    expect(res.total).toBeGreaterThanOrEqual(1);
  });

  it("combines multiple filters (AND semantics)", async () => {
    const res = await run({ studyType: "RCT", condition: "migraine", pageSize: "50" });
    expect(res.items.some((c) => c.title.includes("Zinc Lozenges"))).toBe(true);
    for (const c of res.items) expect(c.studyTypeCode).toBe("RCT");
  });

  it("an unknown taxonomy filter value yields zero results (not everything)", async () => {
    expect((await run({ condition: "no-such-condition-slug" })).total).toBe(0);
    expect((await run({ studyType: "NOT_A_REAL_CODE" })).total).toBe(0);
  });
});

describe("sorting (neutral sorts only)", () => {
  it("newest orders by publication date descending", async () => {
    const res = await run({ sort: "newest", pageSize: "50" });
    const years = res.items.map((c) => c.year).filter((y): y is number => y !== null);
    const sorted = [...years].sort((a, b) => b - a);
    expect(years).toEqual(sorted);
  });

  it("oldest orders by publication date ascending", async () => {
    const res = await run({ sort: "oldest", pageSize: "50" });
    const years = res.items.map((c) => c.year).filter((y): y is number => y !== null);
    const sorted = [...years].sort((a, b) => a - b);
    expect(years).toEqual(sorted);
  });

  it("title sorts alphabetically A–Z", async () => {
    const res = await run({ sort: "title", pageSize: "50" });
    const titles = res.items.map((c) => c.title.toLowerCase());
    expect(titles).toEqual([...titles].sort());
  });

  it("relevance is the default when a text query is present", async () => {
    const parsed = parseSearchParams({ q: "trial" });
    expect(parsed.sort).toBe("relevance");
  });
});

describe("pagination (server-side, clamped, filter-preserving)", () => {
  it("returns at most pageSize items and a correct total", async () => {
    const page1 = await run({ pageSize: "2", page: "1" });
    expect(page1.items.length).toBeLessThanOrEqual(2);
    expect(page1.pageSize).toBe(2);
    const all = await run({ pageSize: "50" });
    expect(page1.total).toBe(all.total);
    expect(page1.totalPages).toBe(Math.ceil(all.total / 2));
  });

  it("returns disjoint items across pages", async () => {
    const p1 = await run({ pageSize: "2", page: "1", sort: "title" });
    const p2 = await run({ pageSize: "2", page: "2", sort: "title" });
    const overlap = p1.items.filter((a) => p2.items.some((b) => b.id === a.id));
    expect(overlap).toHaveLength(0);
  });

  it("an out-of-range page returns no items but the true total", async () => {
    const res = await run({ pageSize: "5", page: "999" });
    expect(res.items).toHaveLength(0);
    expect(res.total).toBeGreaterThan(0);
  });

  it("clamps pageSize above the maximum and coerces bad page/size input", async () => {
    expect(parseSearchParams({ pageSize: "9999" }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parseSearchParams({ pageSize: "0" }).pageSize).toBe(1);
    expect(parseSearchParams({ pageSize: "abc" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseSearchParams({ page: "-5" }).page).toBe(1);
    expect(parseSearchParams({ page: "notanumber" }).page).toBe(1);
  });
});

describe("invalid / untrusted parameters", () => {
  it("drops an invalid enum outcome filter (treated as not filtered)", async () => {
    const parsed = parseSearchParams({ outcome: "DROP TABLE" });
    expect(parsed.filters.outcome).toBeUndefined();
  });

  it("drops an invalid quality filter and out-of-range year", async () => {
    expect(parseSearchParams({ quality: "AMAZING" }).filters.quality).toBeUndefined();
    expect(parseSearchParams({ year: "99999" }).filters.year).toBeUndefined();
    expect(parseSearchParams({ year: "notayear" }).filters.year).toBeUndefined();
  });

  it("falls back to a safe default sort for an unknown sort value", async () => {
    expect(parseSearchParams({ sort: "most_effective" }).sort).toBe("newest");
    expect(parseSearchParams({ sort: "strongest_evidence", q: "x" }).sort).toBe("relevance");
  });
});

describe("SQL-injection-style input is inert", () => {
  it("treats a classic injection query string as a harmless literal", async () => {
    const res = await run({ q: "'; drop table research_study; --" });
    expect(res.total).toBe(0);
    // the table is intact and still holds published rows
    const check = await db.query<{ n: string }>(
      "select count(*)::text n from research_study where publication_state = 'PUBLISHED'",
    );
    expect(Number(check.rows[0]?.n)).toBeGreaterThan(0);
  });

  it("treats an injection attempt in a filter value as a literal (matches nothing)", async () => {
    const res = await run({ condition: "asthma' or '1'='1" });
    expect(res.total).toBe(0); // did NOT leak all rows
  });

  it("does not error on quotes/backslashes/percent in the query", async () => {
    await expect(run({ q: '100%_\\ "weird" o\'brien' })).resolves.toBeDefined();
  });
});

describe("one study with multiple publications yields a single card", () => {
  it("does not duplicate the multi-publication demo study", async () => {
    const res = await run({ q: "multiple publications", pageSize: "50" });
    const hits = res.items.filter((c) => c.id === MULTIPUB_STUDY);
    expect(hits).toHaveLength(1);
    expect(res.total).toBe(res.items.length); // count matches distinct cards on one page
  });
});

describe("filter options come from canonical reference data", () => {
  it("loads study types, evidence levels, conditions, interventions, enums, years", async () => {
    const opts = await pub((s) => getFilterOptions(s));
    expect(opts.studyTypes.some((o) => o.value === "RCT")).toBe(true);
    expect(opts.evidenceLevels.some((o) => o.value === "META_ANALYSIS")).toBe(true);
    expect(opts.conditions.some((o) => o.value === "asthma")).toBe(true);
    expect(opts.interventions.some((o) => o.value === "arnica-montana")).toBe(true);
    expect(opts.outcomes.some((o) => o.value === "NEGATIVE")).toBe(true);
    expect(opts.outcomes.some((o) => o.value === "UNCLASSIFIED")).toBe(false);
    expect(opts.qualities.map((o) => o.value)).toContain("HIGH");
    expect(opts.years.length).toBeGreaterThan(0);
  });
});

describe("card shape keeps dimensions separate", () => {
  it("exposes outcome and quality as distinct fields, never a merged score", async () => {
    const res = await run({ q: "zinc lozenges" });
    const card = res.items.find((c) => c.title.includes("Zinc Lozenges"))!;
    expect(card).toBeDefined();
    expect(card.outcome).toBe("POSITIVE");
    expect(card.qualitySummary).toBe("HIGH");
    // No combined/efficacy field exists on the card at all.
    expect(Object.keys(card)).not.toContain("score");
    expect(Object.keys(card)).not.toContain("efficacy");
    expect(card.doi).toBe("10.1234/wise.m4.zinc");
  });
});

describe("parseSearchParams DOI detection", () => {
  it("recognises a DOI-shaped query and exposes its canonical form", () => {
    const parsed: SearchQuery = parseSearchParams({ q: " https://doi.org/10.1234/AbC " });
    expect(parsed.doiExact).toBe("10.1234/abc");
  });
  it("leaves doiExact null for ordinary text", () => {
    expect(parseSearchParams({ q: "homeopathy asthma" }).doiExact).toBeNull();
  });
});
