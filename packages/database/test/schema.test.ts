/**
 * Schema, constraint, and integrity tests (docs/20 §3).
 *
 * Verifies: migrations apply; expected tables exist; reference taxonomy is
 * present; the deduplication identifier constraint; the Study/Publication
 * relationship; classification-value validation; and append-only enforcement on
 * audit_log and ai_result.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase } from "./harness.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.close();
});

const EXPECTED_TABLES = [
  "taxonomy_version",
  "evidence_level",
  "study_type",
  "condition",
  "intervention",
  "tag",
  "author",
  "journal",
  "research_source",
  "research_study",
  "publication",
  "publication_author",
  "research_identifier",
  "study_condition",
  "study_intervention",
  "study_tag",
  "classification",
  "evidence_quality_assessment",
  "criticism",
  "app_user",
  "review",
  "correction",
  "audit_log",
  "import_job",
  "import_candidate",
  "ai_job",
  "ai_result",
];

describe("migrations & schema", () => {
  it("creates every expected table", async () => {
    const res = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const present = new Set(res.rows.map((r) => r.table_name));
    for (const t of EXPECTED_TABLES) {
      expect(present.has(t), `missing table ${t}`).toBe(true);
    }
  });

  it("seeds the canonical taxonomy-v1 reference data", async () => {
    const st = await db.query<{ n: string }>("select count(*)::text n from study_type");
    expect(st.rows[0]?.n).toBe("13");
    const el = await db.query<{ n: string }>("select count(*)::text n from evidence_level");
    expect(el.rows[0]?.n).toBe("10");
    const rct = await db.query<{ rank: number }>(
      `select pyramid_rank rank from evidence_level where code = 'RCT'`,
    );
    expect(rct.rows[0]?.rank).toBe(3);
  });

  it("maps every study type to an evidence level (versioned taxonomy)", async () => {
    const orphan = await db.query<{ n: string }>(
      "select count(*)::text n from study_type where evidence_level_id is null",
    );
    expect(orphan.rows[0]?.n).toBe("0");
  });
});

describe("deduplication constraint", () => {
  it("rejects a duplicate (type, value_canonical) identifier", async () => {
    await db.query(
      `insert into research_study (id, canonical_title)
       values ('a1000000-0000-0000-0000-000000000001', 'dedup host')`,
    );
    await db.query(
      `insert into research_identifier (study_id, type, value_raw, value_canonical)
       values ('a1000000-0000-0000-0000-000000000001', 'DOI', '10.1234/x', '10.1234/x')`,
    );
    await expect(
      db.query(
        `insert into research_identifier (study_id, type, value_raw, value_canonical)
         values ('a1000000-0000-0000-0000-000000000001', 'DOI', 'doi:10.1234/X', '10.1234/x')`,
      ),
    ).rejects.toThrow();
  });

  it("allows the same canonical value under a different identifier type", async () => {
    await expect(
      db.query(
        `insert into research_identifier (study_id, type, value_raw, value_canonical)
         values ('a1000000-0000-0000-0000-000000000001', 'OTHER', '10.1234/x', '10.1234/x')`,
      ),
    ).resolves.toBeDefined();
  });
});

describe("Study vs Publication relationship", () => {
  it("links many publications to one study", async () => {
    await db.query(
      `insert into research_study (id, canonical_title)
       values ('a2000000-0000-0000-0000-000000000001', 'multi pub host')`,
    );
    await db.query(
      `insert into publication (study_id, title) values
       ('a2000000-0000-0000-0000-000000000001', 'pub A'),
       ('a2000000-0000-0000-0000-000000000001', 'pub B')`,
    );
    const res = await db.query<{ n: string }>(
      `select count(*)::text n from publication
       where study_id = 'a2000000-0000-0000-0000-000000000001'`,
    );
    expect(res.rows[0]?.n).toBe("2");
  });

  it("requires a publication to reference an existing study (FK)", async () => {
    await expect(
      db.query(
        `insert into publication (study_id, title)
         values ('ffffffff-0000-0000-0000-000000000000', 'orphan')`,
      ),
    ).rejects.toThrow();
  });
});

describe("classification value validation", () => {
  const studyId = "a3000000-0000-0000-0000-000000000001";
  beforeAll(async () => {
    await db.query(`insert into research_study (id, canonical_title) values ($1, 'class host')`, [
      studyId,
    ]);
  });

  it("accepts a valid OUTCOME enum value", async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'OUTCOME', 'POSITIVE')`,
        [studyId],
      ),
    ).resolves.toBeDefined();
  });

  it("rejects an OUTCOME value that is not in the outcome enum", async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'CONFIDENCE', 'DEFINITELY_WORKS')`,
        [studyId],
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown STUDY_TYPE code but accepts a real one", async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'STUDY_TYPE', 'NOT_A_REAL_CODE')`,
        [studyId],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'STUDY_TYPE', 'RCT')`,
        [studyId],
      ),
    ).resolves.toBeDefined();
  });

  it("allows a NULL final_value (AI suggestion pending human review)", async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'QUALITY', null)`,
        [studyId],
      ),
    ).resolves.toBeDefined();
  });

  it("enforces one row per (study, dimension)", async () => {
    await expect(
      db.query(
        `insert into classification (study_id, dimension, final_value)
         values ($1, 'OUTCOME', 'NEGATIVE')`,
        [studyId],
      ),
    ).rejects.toThrow();
  });
});

describe("append-only tables", () => {
  it("rejects UPDATE and DELETE on audit_log", async () => {
    await db.query(
      `insert into audit_log (id, action, entity)
       values ('a4000000-0000-0000-0000-000000000001', 'test', 'thing')`,
    );
    await expect(
      db.query(
        `update audit_log set action = 'x' where id = 'a4000000-0000-0000-0000-000000000001'`,
      ),
    ).rejects.toThrow();
    await expect(
      db.query(`delete from audit_log where id = 'a4000000-0000-0000-0000-000000000001'`),
    ).rejects.toThrow();
  });

  it("rejects UPDATE on ai_result (immutable AI history)", async () => {
    await db.query(
      `insert into research_study (id, canonical_title)
       values ('a5000000-0000-0000-0000-000000000001', 'ai host')`,
    );
    await db.query(
      `insert into ai_job (id, research_study_id, operation, provider, model, prompt_version, input_hash)
       values ('a6000000-0000-0000-0000-000000000001','a5000000-0000-0000-0000-000000000001','op','mock','m','v1','h')`,
    );
    await db.query(
      `insert into ai_result (id, job_id, structured_output)
       values ('a7000000-0000-0000-0000-000000000001','a6000000-0000-0000-0000-000000000001','{}')`,
    );
    await expect(
      db.query(
        `update ai_result set confidence = 0.9 where id = 'a7000000-0000-0000-0000-000000000001'`,
      ),
    ).rejects.toThrow();
  });
});

describe("no efficacy score exists", () => {
  it("has no aggregate score/weight column on research_study or classification", async () => {
    const res = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name in ('research_study', 'publication', 'classification')`,
    );
    const cols = res.rows.map((r) => r.column_name.toLowerCase());
    for (const banned of ["score", "efficacy", "weight", "rating", "net_outcome"]) {
      expect(
        cols.some((c) => c.includes(banned)),
        `unexpected column *${banned}*`,
      ).toBe(false);
    }
  });
});
