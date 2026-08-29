/**
 * Research workflow service layer (docs/26 §13-21).
 *
 * All M3 business rules and SQL live here, on the narrow SqlExecutor boundary.
 * The Astro pages/API call these functions; they never write SQL themselves.
 * Every mutation:
 *   - re-checks the actor's role (defense in depth on top of RLS),
 *   - keeps outcome / quality / confidence / criticism strictly independent
 *     (no efficacy/combined score anywhere), and
 *   - writes an append-only audit_log entry (and a review row for decisions).
 *
 * Framework-independent: imports only @wise-evidence/domain and local modules;
 * no Astro/React/Supabase/AI.
 */
import { normalizeTitle, toCanonicalDoi } from "@wise-evidence/domain";
import type {
  OutcomeValue,
  ConfidenceLevel,
  CriticismCategory,
  CriticismOrigin,
} from "../constants.js";
import {
  type Actor,
  type SqlExecutor,
  ServiceError,
  requireAdmin,
  requireStaff,
} from "../executor.js";

// --- shapes ------------------------------------------------------------------

export interface DraftInput {
  /** Raw DOI/URL as entered by the staff user (any accepted DOI form). */
  readonly doi: string;
  readonly title: string;
  readonly abstract?: string | null;
  readonly journalTitle?: string | null;
  readonly publisher?: string | null;
  readonly publicationDate?: string | null; // YYYY / YYYY-MM / YYYY-MM-DD
  readonly sourceUrl?: string | null;
  readonly authors?: readonly string[];
  /** Provenance label for the research_source, e.g. "Manual entry (Crossref)". */
  readonly sourceName?: string;
}

export interface CreateDraftResult {
  readonly created: boolean;
  readonly studyId: string;
  /** When a record with this DOI already exists, its study id (nothing created). */
  readonly duplicateOfStudyId?: string;
}

export interface StudySummaryRow {
  readonly id: string;
  readonly canonical_title: string;
  readonly lifecycle_state: string;
  readonly publication_state: string;
  readonly is_demo: boolean;
  readonly updated_at: string;
}

// --- helpers -----------------------------------------------------------------

async function one<T>(db: SqlExecutor, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

async function getStudyStates(
  db: SqlExecutor,
  studyId: string,
): Promise<{ lifecycle_state: string; publication_state: string; is_demo: boolean } | null> {
  return one(
    db,
    "select lifecycle_state, publication_state, is_demo from research_study where id = $1",
    [studyId],
  );
}

async function writeAudit(
  db: SqlExecutor,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
): Promise<void> {
  await db.query(
    `insert into audit_log (actor, action, entity, entity_id, before, after, reason)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor.id,
      action,
      entity,
      entityId,
      before === undefined ? null : JSON.stringify(before),
      after === undefined ? null : JSON.stringify(after),
      reason,
    ],
  );
}

/** Get-or-create the manual research_source used as provenance for a draft. */
async function getOrCreateSource(
  db: SqlExecutor,
  name: string,
  url: string | null,
): Promise<string> {
  const existing = await one<{ id: string }>(
    db,
    "select id from research_source where name = $1 limit 1",
    [name],
  );
  if (existing) return existing.id;
  const created = await one<{ id: string }>(
    db,
    `insert into research_source (name, url, import_method, imported_at)
     values ($1, $2, 'MANUAL', now()) returning id`,
    [name, url],
  );
  if (!created) throw new ServiceError("invalid-input", "failed to create research_source");
  return created.id;
}

async function getOrCreateJournal(db: SqlExecutor, title: string): Promise<string> {
  const normalized = title.trim();
  const existing = await one<{ id: string }>(
    db,
    "select id from journal where normalized_name = lower($1) limit 1",
    [normalized],
  );
  if (existing) return existing.id;
  const created = await one<{ id: string }>(
    db,
    "insert into journal (normalized_name) values (lower($1)) returning id",
    [normalized],
  );
  if (!created) throw new ServiceError("invalid-input", "failed to create journal");
  return created.id;
}

async function getOrCreateAuthor(db: SqlExecutor, displayName: string): Promise<string> {
  const normalized = displayName.trim().toLowerCase();
  const existing = await one<{ id: string }>(
    db,
    "select id from author where normalized_name = $1 limit 1",
    [normalized],
  );
  if (existing) return existing.id;
  const created = await one<{ id: string }>(
    db,
    "insert into author (normalized_name, display_name) values ($1, $2) returning id",
    [normalized, displayName.trim()],
  );
  if (!created) throw new ServiceError("invalid-input", "failed to create author");
  return created.id;
}

// --- deduplication -----------------------------------------------------------

/**
 * Exact-DOI dedup lookup (docs/26 §7). Returns the study id that already owns
 * this canonical DOI, or null. Never mutates.
 */
export async function findStudyByDoi(db: SqlExecutor, rawDoi: string): Promise<string | null> {
  const canonical = toCanonicalDoi(rawDoi);
  if (canonical === null) return null;
  const row = await one<{ study_id: string | null; publication_id: string | null }>(
    db,
    `select ri.study_id, ri.publication_id
       from research_identifier ri
      where ri.type = 'DOI' and ri.value_canonical = $1
      limit 1`,
    [canonical],
  );
  if (!row) return null;
  if (row.study_id) return row.study_id;
  if (row.publication_id) {
    const pub = await one<{ study_id: string }>(
      db,
      "select study_id from publication where id = $1",
      [row.publication_id],
    );
    return pub?.study_id ?? null;
  }
  return null;
}

/** Normalized-title matches (informational only; never auto-merged). */
export async function findStudiesByNormalizedTitle(
  db: SqlExecutor,
  title: string,
): Promise<StudySummaryRow[]> {
  const norm = normalizeTitle(title);
  if (norm.length === 0) return [];
  const { rows } = await db.query<StudySummaryRow>(
    `select id, canonical_title, lifecycle_state, publication_state, is_demo, updated_at
       from research_study where normalized_title = $1`,
    [norm],
  );
  return rows;
}

// --- creation ----------------------------------------------------------------

/**
 * Create a DRAFT research record from (human-reviewed) metadata (docs/26 §13).
 * Fails closed on an invalid DOI and never creates a duplicate for an existing
 * canonical DOI — it returns the existing study instead. Nothing publishes.
 */
export async function createDraftFromMetadata(
  db: SqlExecutor,
  actor: Actor,
  input: DraftInput,
): Promise<CreateDraftResult> {
  requireStaff(actor);

  const canonical = toCanonicalDoi(input.doi);
  if (canonical === null) {
    throw new ServiceError("invalid-input", "a valid DOI is required to create a draft");
  }
  const title = input.title.trim();
  if (title.length === 0) {
    throw new ServiceError("invalid-input", "a title is required");
  }

  const existing = await findStudyByDoi(db, canonical);
  if (existing) {
    return { created: false, studyId: existing, duplicateOfStudyId: existing };
  }

  await db.query("begin");
  try {
    const study = await one<{ id: string }>(
      db,
      `insert into research_study
         (canonical_title, normalized_title, lifecycle_state, publication_state, is_demo)
       values ($1, $2, 'IMPORTED', 'DRAFT', false)
       returning id`,
      [title, normalizeTitle(title)],
    );
    if (!study) throw new ServiceError("invalid-input", "failed to create study");

    const sourceName = input.sourceName ?? "Manual entry";
    const sourceId = await getOrCreateSource(db, sourceName, input.sourceUrl ?? null);
    const journalId = input.journalTitle ? await getOrCreateJournal(db, input.journalTitle) : null;

    const pub = await one<{ id: string }>(
      db,
      `insert into publication
         (study_id, title, abstract, publication_date, journal_id, source_id, is_primary, is_demo)
       values ($1, $2, $3, $4::date, $5, $6, true, false)
       returning id`,
      [
        study.id,
        title,
        input.abstract ?? null,
        toDateOrNull(input.publicationDate),
        journalId,
        sourceId,
      ],
    );
    if (!pub) throw new ServiceError("invalid-input", "failed to create publication");

    await db.query(
      `insert into research_identifier (publication_id, type, value_raw, value_canonical)
       values ($1, 'DOI', $2, $3)`,
      [pub.id, input.doi.trim(), canonical],
    );

    const authors = input.authors ?? [];
    for (let i = 0; i < authors.length; i++) {
      const name = authors[i]?.trim();
      if (!name) continue;
      const authorId = await getOrCreateAuthor(db, name);
      await db.query(
        `insert into publication_author (publication_id, author_id, author_order)
         values ($1, $2, $3)
         on conflict (publication_id, author_id) do nothing`,
        [pub.id, authorId, i],
      );
    }

    await writeAudit(
      db,
      actor,
      "create_draft",
      "research_study",
      study.id,
      null,
      {
        doi: canonical,
        title,
      },
      null,
    );

    await db.query("commit");
    return { created: true, studyId: study.id };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

// --- editing -----------------------------------------------------------------

export interface IdentityPatch {
  readonly title?: string;
  readonly studyTypeCode?: string | null;
  readonly subjectType?: string;
  readonly abstract?: string | null;
  readonly publicationDate?: string | null;
  readonly journalTitle?: string | null;
  readonly summary?: string | null;
}

/** Update identity/study fields on a DRAFT/PENDING study (docs/26 §14). */
export async function updateStudyIdentity(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  patch: IdentityPatch,
): Promise<void> {
  requireStaff(actor);
  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");

  let studyTypeId: string | null | undefined;
  if (patch.studyTypeCode !== undefined) {
    if (patch.studyTypeCode === null) {
      studyTypeId = null;
    } else {
      const st = await one<{ id: string }>(db, "select id from study_type where code = $1", [
        patch.studyTypeCode,
      ]);
      if (!st)
        throw new ServiceError("invalid-input", `unknown study type: ${patch.studyTypeCode}`);
      studyTypeId = st.id;
    }
  }

  if (patch.title !== undefined || studyTypeId !== undefined || patch.subjectType !== undefined) {
    const title = patch.title?.trim();
    await db.query(
      `update research_study set
         canonical_title = coalesce($2, canonical_title),
         normalized_title = case when $2 is null then normalized_title else $3 end,
         study_type_id = case when $4 then $5 else study_type_id end,
         subject_type = coalesce($6::subject_type, subject_type)
       where id = $1`,
      [
        studyId,
        title ?? null,
        title ? normalizeTitle(title) : null,
        studyTypeId !== undefined,
        studyTypeId ?? null,
        patch.subjectType ?? null,
      ],
    );
  }

  if (
    patch.abstract !== undefined ||
    patch.publicationDate !== undefined ||
    patch.journalTitle !== undefined ||
    patch.summary !== undefined
  ) {
    const journalId =
      patch.journalTitle !== undefined && patch.journalTitle
        ? await getOrCreateJournal(db, patch.journalTitle)
        : null;
    await db.query(
      `update publication set
         abstract = case when $2 then $3 else abstract end,
         publication_date = case when $4 then $5::date else publication_date end,
         journal_id = case when $6 then $7 else journal_id end
       where study_id = $1 and is_primary = true`,
      [
        studyId,
        patch.abstract !== undefined,
        patch.abstract ?? null,
        patch.publicationDate !== undefined,
        toDateOrNull(patch.publicationDate ?? null),
        patch.journalTitle !== undefined,
        journalId,
      ],
    );
    if (patch.summary !== undefined) {
      await setHumanSummary(db, actor, studyId, patch.summary);
    }
  }

  await writeAudit(db, actor, "edit_identity", "research_study", studyId, null, patch, null);
}

/**
 * Store the human-authored summary (docs/26 §17) in research_study.human_summary
 * (added in migration 0010). It is exposed on the public detail page for
 * published studies and carries no classification/score meaning.
 */
async function setHumanSummary(
  db: SqlExecutor,
  _actor: Actor,
  studyId: string,
  summary: string | null,
): Promise<void> {
  const trimmed = summary?.trim();
  await db.query("update research_study set human_summary = $2 where id = $1", [
    studyId,
    trimmed && trimmed.length > 0 ? trimmed : null,
  ]);
}

// --- classification (independent dimensions) ---------------------------------

/**
 * Set the human final OUTCOME + its confidence (docs/26 §15).
 *
 * `aiResultId` is OPTIONAL provenance (docs/29 §19): when a human accepts or
 * edits an AI suggestion, the originating ai_result id is recorded on the
 * canonical row. It is ALWAYS the human running this operation who writes the
 * canonical value — the AI never does. The AI's numeric confidence is NOT copied
 * here: `confidence` is the independent evidence-confidence dimension the human
 * sets, kept distinct from AI confidence (docs/29 §confidence separation).
 */
export async function setOutcome(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  outcome: OutcomeValue,
  confidence: ConfidenceLevel | null,
  explanation: string | null,
  aiResultId: string | null = null,
): Promise<void> {
  requireStaff(actor);
  if (!(await getStudyStates(db, studyId))) throw new ServiceError("not-found", "study not found");
  const before = await one<{ final_value: string | null }>(
    db,
    "select final_value from classification where study_id = $1 and dimension = 'OUTCOME'",
    [studyId],
  );
  await db.query(
    `insert into classification (study_id, dimension, final_value, final_actor, confidence, explanation, ai_result_id)
     values ($1, 'OUTCOME', $2, $3, $4::confidence_level, $5, $6)
     on conflict (study_id, dimension) do update set
       final_value = excluded.final_value,
       final_actor = excluded.final_actor,
       confidence = excluded.confidence,
       explanation = excluded.explanation,
       ai_result_id = excluded.ai_result_id`,
    [studyId, outcome, actor.id, confidence, explanation, aiResultId],
  );
  await writeAudit(
    db,
    actor,
    "set_outcome",
    "classification",
    studyId,
    before?.final_value ?? null,
    aiResultId ? { outcome, ai_result_id: aiResultId } : outcome,
    explanation,
  );
}

/** Set the coarse QUALITY summary classification (independent of outcome). */
export async function setQualitySummary(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  quality: "HIGH" | "MODERATE" | "LOW" | "UNCLEAR",
  explanation: string | null,
  aiResultId: string | null = null,
): Promise<void> {
  requireStaff(actor);
  if (!(await getStudyStates(db, studyId))) throw new ServiceError("not-found", "study not found");
  await db.query(
    `insert into classification (study_id, dimension, final_value, final_actor, explanation, ai_result_id)
     values ($1, 'QUALITY', $2, $3, $4, $5)
     on conflict (study_id, dimension) do update set
       final_value = excluded.final_value,
       final_actor = excluded.final_actor,
       explanation = excluded.explanation,
       ai_result_id = excluded.ai_result_id`,
    [studyId, quality, actor.id, explanation, aiResultId],
  );
  await writeAudit(
    db,
    actor,
    "set_quality",
    "classification",
    studyId,
    null,
    aiResultId ? { quality, ai_result_id: aiResultId } : quality,
    explanation,
  );
}

// --- criticism (a separate object) -------------------------------------------

export interface CriticismInput {
  readonly category: CriticismCategory;
  readonly origin: CriticismOrigin;
  readonly text: string;
  readonly sourceReference?: string | null;
  readonly sourceUrl?: string | null;
  /** Optional AI-suggestion provenance when a human accepts an AI criticism. */
  readonly aiResultId?: string | null;
}

/** Add a criticism row. Never mutates any outcome value (docs/26 §16). */
export async function addCriticism(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  input: CriticismInput,
): Promise<string> {
  requireStaff(actor);
  if (!(await getStudyStates(db, studyId))) throw new ServiceError("not-found", "study not found");
  const text = input.text.trim();
  if (text.length === 0) throw new ServiceError("invalid-input", "criticism text is required");
  const row = await one<{ id: string }>(
    db,
    `insert into criticism (study_id, category, origin, text, source_reference, source_url, actor, ai_result_id, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE') returning id`,
    [
      studyId,
      input.category,
      input.origin,
      text,
      input.sourceReference ?? null,
      input.sourceUrl ?? null,
      actor.id,
      input.aiResultId ?? null,
    ],
  );
  if (!row) throw new ServiceError("invalid-input", "failed to add criticism");
  await writeAudit(
    db,
    actor,
    "add_criticism",
    "criticism",
    row.id,
    null,
    { category: input.category },
    null,
  );
  return row.id;
}

/** Withdraw a criticism (status change; the row is retained, never deleted). */
export async function withdrawCriticism(
  db: SqlExecutor,
  actor: Actor,
  criticismId: string,
): Promise<void> {
  requireStaff(actor);
  const { rows } = await db.query(
    "update criticism set status = 'WITHDRAWN' where id = $1 and status = 'ACTIVE' returning id",
    [criticismId],
  );
  if (rows.length === 0) throw new ServiceError("not-found", "active criticism not found");
  await writeAudit(
    db,
    actor,
    "withdraw_criticism",
    "criticism",
    criticismId,
    "ACTIVE",
    "WITHDRAWN",
    null,
  );
}

// --- taxonomy links ----------------------------------------------------------

export async function linkCondition(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  conditionSlug: string,
): Promise<void> {
  requireStaff(actor);
  const cond = await one<{ id: string }>(db, "select id from condition where slug = $1", [
    conditionSlug,
  ]);
  if (!cond) throw new ServiceError("invalid-input", `unknown condition: ${conditionSlug}`);
  await db.query(
    "insert into study_condition (study_id, condition_id) values ($1, $2) on conflict do nothing",
    [studyId, cond.id],
  );
}

export async function linkIntervention(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  interventionSlug: string,
): Promise<void> {
  requireStaff(actor);
  const iv = await one<{ id: string }>(db, "select id from intervention where slug = $1", [
    interventionSlug,
  ]);
  if (!iv) throw new ServiceError("invalid-input", `unknown intervention: ${interventionSlug}`);
  await db.query(
    "insert into study_intervention (study_id, intervention_id) values ($1, $2) on conflict do nothing",
    [studyId, iv.id],
  );
}

// --- lifecycle transitions ---------------------------------------------------

/** DRAFT → PENDING_REVIEW (reviewer or admin) (docs/26 §18). */
export async function submitForReview(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
): Promise<void> {
  requireStaff(actor);
  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");
  if (states.publication_state !== "DRAFT") {
    throw new ServiceError(
      "invalid-state",
      `can only submit a DRAFT (was ${states.publication_state})`,
    );
  }
  await transition(
    db,
    actor,
    studyId,
    "PENDING_REVIEW",
    "PENDING_REVIEW",
    "SUBMIT",
    null,
    states.publication_state,
  );
}

/** PENDING_REVIEW → DRAFT (reviewer requests changes). */
export async function requestChanges(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  reason: string,
): Promise<void> {
  requireStaff(actor);
  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");
  if (states.publication_state !== "PENDING_REVIEW") {
    throw new ServiceError("invalid-state", "can only request changes on a PENDING_REVIEW study");
  }
  await transition(
    db,
    actor,
    studyId,
    "PROCESSING",
    "DRAFT",
    "REQUEST_CHANGES",
    reason,
    states.publication_state,
  );
}

/** → REJECTED (reviewer or admin). */
export async function rejectStudy(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  reason: string,
): Promise<void> {
  requireStaff(actor);
  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");
  if (states.publication_state === "PUBLISHED") {
    throw new ServiceError("invalid-state", "cannot reject a published study; archive it instead");
  }
  await transition(
    db,
    actor,
    studyId,
    "REJECTED",
    "REJECTED",
    "REJECT",
    reason,
    states.publication_state,
  );
}

/** ARCHIVED (admin only). */
export async function archiveStudy(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  reason: string,
): Promise<void> {
  requireAdmin(actor);
  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");
  await transition(
    db,
    actor,
    studyId,
    "ARCHIVED",
    "ARCHIVED",
    "EDIT",
    reason,
    states.publication_state,
  );
}

/** Shared transition writer: update states, log review + audit atomically. */
async function transition(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  lifecycle: string,
  publication: string,
  action: string,
  reason: string | null,
  fromPublication: string,
): Promise<void> {
  await db.query("begin");
  try {
    await db.query(
      "update research_study set lifecycle_state = $2::study_lifecycle_state, publication_state = $3::publication_state where id = $1",
      [studyId, lifecycle, publication],
    );
    await db.query(
      `insert into review (study_id, reviewer_id, action, before_snapshot, after_snapshot, reason)
       values ($1, $2, $3::review_action, $4, $5, $6)`,
      [
        studyId,
        actor.id,
        action === "SUBMIT" || action === "REQUEST_CHANGES" ? "EDIT" : action,
        JSON.stringify({ publication_state: fromPublication }),
        JSON.stringify({ publication_state: publication }),
        reason,
      ],
    );
    await writeAudit(
      db,
      actor,
      action.toLowerCase(),
      "research_study",
      studyId,
      { publication_state: fromPublication },
      { publication_state: publication },
      reason,
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

// --- publication (fail-closed) ----------------------------------------------

export interface PublishRequirements {
  /** Require at least one identifier (DOI/PMID). Missing-DOI records may set this false. */
  readonly requireIdentifier?: boolean;
}

/**
 * Approve + publish (ADMIN only), fail-closed (docs/26 §19). Runs in ONE
 * transaction and aborts entirely unless every required condition holds. Demo
 * records are explicitly refused (docs/26 §20). The database publish-guard
 * trigger backstops this independently.
 */
export async function approveAndPublish(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  requirements: PublishRequirements = {},
): Promise<void> {
  requireAdmin(actor);
  const requireIdentifier = requirements.requireIdentifier ?? true;

  const states = await getStudyStates(db, studyId);
  if (!states) throw new ServiceError("not-found", "study not found");
  if (states.is_demo) {
    throw new ServiceError("demo-protected", "refusing to publish a demo record");
  }
  if (states.publication_state !== "PENDING_REVIEW") {
    throw new ServiceError(
      "invalid-state",
      `a study must be PENDING_REVIEW before publishing (was ${states.publication_state})`,
    );
  }

  // Required canonical data: a primary publication with a title.
  const pub = await one<{ id: string; title: string }>(
    db,
    "select id, title from publication where study_id = $1 and is_primary = true",
    [studyId],
  );
  if (!pub || pub.title.trim().length === 0) {
    throw new ServiceError("precondition-failed", "a primary publication with a title is required");
  }

  // Required provenance: a research_source on the primary publication.
  const prov = await one<{ source_id: string | null }>(
    db,
    "select source_id from publication where id = $1",
    [pub.id],
  );
  if (!prov?.source_id) {
    throw new ServiceError("precondition-failed", "provenance (research_source) is required");
  }

  // Required identifier.
  if (requireIdentifier) {
    const ident = await one<{ n: string }>(
      db,
      `select count(*)::text n from research_identifier
        where study_id = $1 or publication_id = $2`,
      [studyId, pub.id],
    );
    if (!ident || Number(ident.n) === 0) {
      throw new ServiceError(
        "precondition-failed",
        "at least one identifier (DOI/PMID) is required",
      );
    }
  }

  // Required human outcome classification.
  const outcome = await one<{ final_value: string | null }>(
    db,
    "select final_value from classification where study_id = $1 and dimension = 'OUTCOME'",
    [studyId],
  );
  if (!outcome || outcome.final_value === null) {
    throw new ServiceError(
      "precondition-failed",
      "a human-reviewed OUTCOME classification is required before publishing",
    );
  }

  await db.query("begin");
  try {
    // The publish-guard trigger enforces admin-or-service + non-demo + state.
    await db.query(
      "update research_study set lifecycle_state = 'PUBLISHED', publication_state = 'PUBLISHED' where id = $1",
      [studyId],
    );
    await db.query(
      `insert into review (study_id, reviewer_id, action, before_snapshot, after_snapshot, reason)
       values ($1, $2, 'PUBLISH', $3, $4, null)`,
      [
        studyId,
        actor.id,
        JSON.stringify({ publication_state: "PENDING_REVIEW" }),
        JSON.stringify({ publication_state: "PUBLISHED" }),
      ],
    );
    await writeAudit(
      db,
      actor,
      "publish",
      "research_study",
      studyId,
      { publication_state: "PENDING_REVIEW" },
      { publication_state: "PUBLISHED" },
      null,
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  }
}

// --- utilities ---------------------------------------------------------------

function toDateOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  // Accept YYYY, YYYY-MM, YYYY-MM-DD → normalize to a full date for ::date.
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return null;
}
