/**
 * M3 research workflow tests (docs/26 §24). Drives the service layer against the
 * deterministic PGlite database via the privileged (service_role) executor —
 * the same path the Astro server uses after it authorizes the actor. Covers the
 * full human-controlled lifecycle: create draft → edit → classify → criticism →
 * submit → (reject) → approve → publish → public visibility.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDatabase, type TestDatabase, type RoleScopedDb } from "./harness.js";
import {
  createDraftFromMetadata,
  updateStudyIdentity,
  setOutcome,
  setQualitySummary,
  addCriticism,
  linkCondition,
  linkIntervention,
  submitForReview,
  requestChanges,
  rejectStudy,
  approveAndPublish,
  archiveStudy,
  findStudyByDoi,
  getStudyDetail,
  listStudies,
  ServiceError,
  type Actor,
} from "../src/index.js";

const ADMIN: Actor = { id: "10000000-0000-0000-0000-0000000000ad", role: "ADMIN" };
const REVIEWER: Actor = { id: "10000000-0000-0000-0000-000000000001", role: "REVIEWER" }; // seeded
const PUBLIC: Actor = { id: "10000000-0000-0000-0000-0000000000bb", role: "PUBLIC" };

let db: TestDatabase;
/** Run a service call on the privileged server path (post-authorization). */
function svc<T>(fn: (db: RoleScopedDb) => Promise<T>): Promise<T> {
  return db.asServiceRole(fn);
}

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  // An ADMIN app_user (the seed ships only a REVIEWER).
  await db.query(
    "insert into app_user (id, email, display_name, role) values ($1, 'admin@example.invalid', 'Admin', 'ADMIN')",
    [ADMIN.id],
  );
});
afterAll(async () => {
  await db.close();
});

const DOI = "10.1234/wise.m3.happy";

describe("full manual research lifecycle", () => {
  let studyId: string;

  it("creates a DRAFT from metadata (no auto-publish)", async () => {
    const result = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, {
        doi: `https://doi.org/${DOI}`,
        title: "A Controlled Trial Of A Homeopathic Intervention",
        abstract: "Invented abstract.",
        journalTitle: "Journal of Example",
        publicationDate: "2021-03",
        sourceUrl: "https://doi.org/" + DOI,
        authors: ["Jane Smith", "Bob Jones"],
        sourceName: "Manual entry (test)",
      }),
    );
    expect(result.created).toBe(true);
    studyId = result.studyId;

    const detail = await svc((s) => getStudyDetail(s, studyId));
    expect(detail?.publicationState).toBe("DRAFT");
    expect(detail?.doi).toBe(DOI);
    expect(detail?.authors.map((a) => a.displayName)).toEqual(["Jane Smith", "Bob Jones"]);
    expect(detail?.isDemo).toBe(false);
  });

  it("dedups an identical DOI instead of creating a second study", async () => {
    const again = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, { doi: DOI, title: "dup attempt" }),
    );
    expect(again.created).toBe(false);
    expect(again.duplicateOfStudyId).toBe(studyId);
    expect(await svc((s) => findStudyByDoi(s, DOI))).toBe(studyId);
  });

  it("edits identity, sets independent classifications, and adds criticism", async () => {
    await svc((s) =>
      updateStudyIdentity(s, REVIEWER, studyId, {
        studyTypeCode: "RCT",
        subjectType: "HUMAN",
        summary: "Human-authored plain-language summary of the study.",
      }),
    );
    await svc((s) => setOutcome(s, REVIEWER, studyId, "POSITIVE", "MODERATE", "Primary endpoint favoured intervention"));
    await svc((s) => setQualitySummary(s, REVIEWER, studyId, "MODERATE", "Some risk of bias"));
    await svc((s) => addCriticism(s, REVIEWER, studyId, {
      category: "SAMPLE_SIZE",
      origin: "REVIEWER_ASSESSED",
      text: "Small sample limits strength.",
    }));
    await svc((s) => linkCondition(s, REVIEWER, studyId, "asthma"));
    await svc((s) => linkIntervention(s, REVIEWER, studyId, "individualized-homeopathy"));

    const detail = await svc((s) => getStudyDetail(s, studyId));
    // Independent dimensions, never collapsed.
    expect(detail?.outcome).toBe("POSITIVE");
    expect(detail?.outcomeConfidence).toBe("MODERATE");
    expect(detail?.qualitySummary).toBe("MODERATE");
    expect(detail?.criticism).toHaveLength(1);
    expect(detail?.humanSummary).toContain("plain-language");
    expect(detail?.studyTypeCode).toBe("RCT");
    expect(detail?.conditions).toContain("Asthma");
    expect(detail?.interventions).toContain("Individualized Homeopathy");
  });

  it("submits for review (DRAFT → PENDING_REVIEW)", async () => {
    await svc((s) => submitForReview(s, REVIEWER, studyId));
    const detail = await svc((s) => getStudyDetail(s, studyId));
    expect(detail?.publicationState).toBe("PENDING_REVIEW");
  });

  it("refuses reviewer publish, allows admin publish", async () => {
    await expect(svc((s) => approveAndPublish(s, REVIEWER, studyId))).rejects.toBeInstanceOf(
      ServiceError,
    );
    // still pending
    expect((await svc((s) => getStudyDetail(s, studyId)))?.publicationState).toBe("PENDING_REVIEW");

    await svc((s) => approveAndPublish(s, ADMIN, studyId));
    const detail = await svc((s) => getStudyDetail(s, studyId));
    expect(detail?.publicationState).toBe("PUBLISHED");
    expect(detail?.lifecycleState).toBe("PUBLISHED");
  });

  it("is now visible on the public (anon) read path with separated dimensions", async () => {
    const detail = await db.asAnon((s) => getStudyDetail(s, studyId));
    expect(detail).not.toBeNull();
    expect(detail?.title).toContain("Controlled Trial");
    expect(detail?.outcome).toBe("POSITIVE");
    expect(detail?.qualitySummary).toBe("MODERATE");
    expect(detail?.criticism).toHaveLength(1);
    expect(detail?.humanSummary).toContain("plain-language");
  });

  it("wrote an append-only audit trail", async () => {
    const audit = await svc((s) =>
      s.query<{ action: string }>("select action from audit_log where entity_id = $1", [studyId]),
    );
    const actions = new Set(audit.rows.map((r) => r.action));
    expect(actions.has("create_draft")).toBe(true);
    expect(actions.has("set_outcome")).toBe(true);
    expect(actions.has("publish")).toBe(true);
  });
});

describe("review decisions", () => {
  async function freshPending(doi: string): Promise<string> {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, { doi, title: "Pending study " + doi }),
    );
    await svc((s) => setOutcome(s, REVIEWER, created.studyId, "NEUTRAL_INCONCLUSIVE", "LOW", null));
    await svc((s) => submitForReview(s, REVIEWER, created.studyId));
    return created.studyId;
  }

  it("reject moves a study to REJECTED and it stays invisible to anon", async () => {
    const id = await freshPending("10.1234/wise.m3.reject");
    await svc((s) => rejectStudy(s, ADMIN, id, "Out of scope"));
    expect((await svc((s) => getStudyDetail(s, id)))?.publicationState).toBe("REJECTED");
    expect(await db.asAnon((s) => getStudyDetail(s, id))).toBeNull();
  });

  it("request-changes returns a study to DRAFT", async () => {
    const id = await freshPending("10.1234/wise.m3.changes");
    await svc((s) => requestChanges(s, REVIEWER, id, "Needs a clearer summary"));
    expect((await svc((s) => getStudyDetail(s, id)))?.publicationState).toBe("DRAFT");
  });

  it("archive is admin-only and hides a published study from anon", async () => {
    const id = await freshPending("10.1234/wise.m3.archive");
    await svc((s) => approveAndPublish(s, ADMIN, id));
    await expect(svc((s) => archiveStudy(s, REVIEWER, id, "x"))).rejects.toBeInstanceOf(ServiceError);
    await svc((s) => archiveStudy(s, ADMIN, id, "Superseded"));
    expect((await svc((s) => getStudyDetail(s, id)))?.publicationState).toBe("ARCHIVED");
    expect(await db.asAnon((s) => getStudyDetail(s, id))).toBeNull();
  });
});

describe("fail-closed publication", () => {
  it("refuses to publish without a human OUTCOME classification", async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, { doi: "10.1234/wise.m3.nooutcome", title: "No outcome" }),
    );
    await svc((s) => submitForReview(s, REVIEWER, created.studyId));
    const err = await svc((s) => approveAndPublish(s, ADMIN, created.studyId)).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).reason).toBe("precondition-failed");
    expect((await svc((s) => getStudyDetail(s, created.studyId)))?.publicationState).toBe("PENDING_REVIEW");
  });

  it("refuses to publish a study that is not PENDING_REVIEW", async () => {
    const created = await svc((s) =>
      createDraftFromMetadata(s, REVIEWER, { doi: "10.1234/wise.m3.stillDraft", title: "Draft" }),
    );
    await svc((s) => setOutcome(s, REVIEWER, created.studyId, "POSITIVE", "HIGH", null));
    const err = await svc((s) => approveAndPublish(s, ADMIN, created.studyId)).catch((e) => e);
    expect((err as ServiceError).reason).toBe("invalid-state");
  });

  it("a PUBLIC actor cannot create a draft", async () => {
    await expect(
      svc((s) => createDraftFromMetadata(s, PUBLIC, { doi: "10.1234/wise.m3.public", title: "x" })),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("admin listing", () => {
  it("lists pending-review studies for the queue", async () => {
    const pending = await svc((s) => listStudies(s, { publicationState: "PENDING_REVIEW" }));
    expect(pending.every((r) => r.publicationState === "PENDING_REVIEW")).toBe(true);
  });
});
