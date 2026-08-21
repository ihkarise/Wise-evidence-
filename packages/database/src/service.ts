import { normalizeDoi } from '@wise-evidence/domain';
import type { QueryExecutor } from './db.js';
import { toCanonicalIdentifier } from './identifiers.js';
import type {
  AppRole,
  ClassificationDimension,
  CriticismCategory,
  CriticismOrigin,
  IdentifierType,
  OutcomeValue,
  ResearchStudyRow,
} from './types.js';

/**
 * Research workflow service (Milestone 3). Every mutation enforces the M3
 * permission model (docs/12 §9a) at THIS layer, in addition to the database RLS
 * boundary (migration 0011) — defense in depth. Publication is fail-closed
 * (§approveAndPublish). The executor is expected to already carry the caller's
 * RLS role/claims context (in tests, via the PGlite harness `asRole`).
 */

/** The authenticated staff member performing an operation. */
export interface ActorContext {
  /** app_user.id (used as audit actor and classification final_actor). */
  appUserId: string;
  /** app role governing what the actor may do. */
  role: AppRole;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class PublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const CAN_EDIT: AppRole[] = ['REVIEWER', 'ADMIN'];
const CAN_PUBLISH: AppRole[] = ['ADMIN'];

function requireRole(actor: ActorContext, allowed: AppRole[], op: string): void {
  if (!allowed.includes(actor.role)) {
    throw new PermissionError(`Role ${actor.role} may not perform ${op}.`);
  }
}

async function audit(
  exec: QueryExecutor,
  actor: ActorContext,
  action: string,
  entity: string,
  entityId: string,
  opts: { field?: string; before?: string; after?: string; reason?: string } = {}
): Promise<void> {
  await exec.query(
    `insert into audit_log (actor, action, entity, entity_id, field, before_value, after_value, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      actor.appUserId,
      action,
      entity,
      entityId,
      opts.field ?? null,
      opts.before ?? null,
      opts.after ?? null,
      opts.reason ?? null,
    ]
  );
}

export interface CreateDraftInput {
  title: string;
  doi?: string;
  url?: string;
  sourceName?: string;
  sourceUrl?: string;
  publicationTitle?: string;
  abstract?: string;
  publicationDate?: string | null;
}

export interface CreatedDraft {
  studyId: string;
  publicationId: string;
}

const MAX_TITLE = 1000;
const MAX_TEXT = 20000;

/** Create a DRAFT study + primary publication from manual/metadata-prefilled input. */
export async function createDraft(
  exec: QueryExecutor,
  actor: ActorContext,
  input: CreateDraftInput
): Promise<CreatedDraft> {
  requireRole(actor, CAN_EDIT, 'createDraft');
  const title = input.title?.trim();
  if (!title) throw new ValidationError('Title is required.');
  if (title.length > MAX_TITLE) throw new ValidationError('Title too long.');
  if (input.abstract && input.abstract.length > MAX_TEXT) {
    throw new ValidationError('Abstract too long.');
  }

  const study = await exec.query<{ id: string }>(
    `insert into research_study (canonical_title, lifecycle_state, is_demo)
     values ($1, 'IMPORTED', false) returning id`,
    [title]
  );
  const studyId = study.rows[0]!.id;

  // Optional provenance source.
  let sourceId: string | null = null;
  if (input.sourceName || input.sourceUrl) {
    const src = await exec.query<{ id: string }>(
      `insert into research_source (source_name, source_url, import_method)
       values ($1, $2, 'MANUAL') returning id`,
      [input.sourceName ?? 'Manual entry', input.sourceUrl ?? null]
    );
    sourceId = src.rows[0]!.id;
  }

  const pub = await exec.query<{ id: string }>(
    `insert into publication (study_id, title, abstract, publication_date, source_id, publication_state, is_primary)
     values ($1, $2, $3, $4, $5, 'DRAFT', true) returning id`,
    [studyId, input.publicationTitle?.trim() || title, input.abstract ?? null, input.publicationDate ?? null, sourceId]
  );
  const publicationId = pub.rows[0]!.id;

  // Optional identifiers (DOI normalized via domain; URL trimmed/validated).
  if (input.doi) {
    const canonical = toCanonicalIdentifier('DOI', input.doi);
    if (!canonical) throw new ValidationError('Malformed DOI.');
    await exec.query(
      `insert into research_identifier (publication_id, id_type, value_raw, value_canonical)
       values ($1, 'DOI', $2, $3)`,
      [publicationId, canonical.value_raw, canonical.value_canonical]
    );
  }
  if (input.url) {
    const canonical = toCanonicalIdentifier('URL', input.url);
    if (canonical) {
      await exec.query(
        `insert into research_identifier (publication_id, id_type, value_raw, value_canonical)
         values ($1, 'URL', $2, $3)`,
        [publicationId, canonical.value_raw, canonical.value_canonical]
      );
    }
  }

  await audit(exec, actor, 'CREATE', 'research_study', studyId, { after: title });
  return { studyId, publicationId };
}

export interface UpdateDraftPatch {
  title?: string;
  summary?: string | null;
  studyTypeCode?: string | null;
  subject?: string | null;
}

/** Edit an in-progress study (not PUBLISHED/ARCHIVED — enforced by RLS too). */
export async function updateDraft(
  exec: QueryExecutor,
  actor: ActorContext,
  studyId: string,
  patch: UpdateDraftPatch
): Promise<void> {
  requireRole(actor, CAN_EDIT, 'updateDraft');
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new ValidationError('Title cannot be empty.');
    if (t.length > MAX_TITLE) throw new ValidationError('Title too long.');
    await exec.query(`update research_study set canonical_title = $2, updated_at = now() where id = $1`, [studyId, t]);
  }
  if (patch.summary !== undefined) {
    if (patch.summary && patch.summary.length > MAX_TEXT) throw new ValidationError('Summary too long.');
    await exec.query(`update research_study set summary = $2, updated_at = now() where id = $1`, [studyId, patch.summary]);
  }
  if (patch.studyTypeCode !== undefined) {
    if (patch.studyTypeCode) await assertTaxonomyCode(exec, 'study_type', patch.studyTypeCode);
    await exec.query(`update research_study set study_type_code = $2, updated_at = now() where id = $1`, [studyId, patch.studyTypeCode]);
  }
  if (patch.subject !== undefined) {
    await exec.query(`update research_study set subject = $2::subject_type, updated_at = now() where id = $1`, [studyId, patch.subject]);
  }
  await audit(exec, actor, 'UPDATE', 'research_study', studyId);
}

async function assertTaxonomyCode(exec: QueryExecutor, table: 'study_type' | 'evidence_level', code: string): Promise<void> {
  const r = await exec.query<{ n: string }>(`select count(*)::text n from ${table} where code = $1`, [code]);
  if (Number(r.rows[0]!.n) === 0) throw new ValidationError(`Unknown ${table} code: ${code}`);
}

export interface SetClassificationInput {
  dimension: ClassificationDimension;
  value: string;
  judgementConfidence?: 'LOW' | 'MODERATE' | 'HIGH' | null;
  explanation?: string | null;
  aiResultId?: string | null;
  finalReason?: string | null;
}

/** Upsert a human-reviewed classification for a study dimension (final_actor = actor). */
export async function setClassification(
  exec: QueryExecutor,
  actor: ActorContext,
  studyId: string,
  input: SetClassificationInput
): Promise<void> {
  requireRole(actor, CAN_EDIT, 'setClassification');
  // Referential validation for taxonomy-backed dimensions (docs/05 §15).
  if (input.dimension === 'EVIDENCE_LEVEL') await assertTaxonomyCode(exec, 'evidence_level', input.value);
  if (input.dimension === 'STUDY_TYPE') await assertTaxonomyCode(exec, 'study_type', input.value);

  await exec.query(
    `insert into classification (study_id, dimension, value, judgement_confidence, explanation, ai_result_id, final_actor, final_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (study_id, dimension) do update
       set value = excluded.value,
           judgement_confidence = excluded.judgement_confidence,
           explanation = excluded.explanation,
           ai_result_id = excluded.ai_result_id,
           final_actor = excluded.final_actor,
           final_reason = excluded.final_reason,
           updated_at = now()`,
    [
      studyId,
      input.dimension,
      input.value,
      input.judgementConfidence ?? null,
      input.explanation ?? null,
      input.aiResultId ?? null,
      actor.appUserId,
      input.finalReason ?? null,
    ]
  );
  await audit(exec, actor, 'CLASSIFY', 'classification', studyId, { field: input.dimension, after: input.value });
}

export interface AddCriticismInput {
  category: CriticismCategory;
  origin: CriticismOrigin;
  body: string;
  sourceReference?: string | null;
}

/** Attach a criticism to a study (separate dimension; never changes outcome). */
export async function addCriticism(
  exec: QueryExecutor,
  actor: ActorContext,
  studyId: string,
  input: AddCriticismInput
): Promise<string> {
  requireRole(actor, CAN_EDIT, 'addCriticism');
  if (!input.body?.trim()) throw new ValidationError('Criticism body is required.');
  const r = await exec.query<{ id: string }>(
    `insert into criticism (study_id, category, origin, body, source_reference, actor)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [studyId, input.category, input.origin, input.body.trim(), input.sourceReference ?? null, actor.appUserId]
  );
  await audit(exec, actor, 'CRITICISM_ADD', 'criticism', studyId, { after: input.category });
  return r.rows[0]!.id;
}

/** Move a draft into the review queue. */
export async function submitForReview(exec: QueryExecutor, actor: ActorContext, studyId: string): Promise<void> {
  requireRole(actor, CAN_EDIT, 'submitForReview');
  await exec.query(`update research_study set lifecycle_state = 'PENDING_REVIEW', updated_at = now() where id = $1`, [studyId]);
  await exec.query(`update publication set publication_state = 'PENDING_REVIEW', updated_at = now() where study_id = $1`, [studyId]);
  await audit(exec, actor, 'SUBMIT_FOR_REVIEW', 'research_study', studyId, { after: 'PENDING_REVIEW' });
}

/** Reject a study (send back / out of the queue). Reviewer or admin. */
export async function reject(exec: QueryExecutor, actor: ActorContext, studyId: string, reason: string): Promise<void> {
  requireRole(actor, CAN_EDIT, 'reject');
  await exec.query(`update research_study set lifecycle_state = 'REJECTED', updated_at = now() where id = $1`, [studyId]);
  await exec.query(`update publication set publication_state = 'REJECTED', updated_at = now() where study_id = $1`, [studyId]);
  await audit(exec, actor, 'REJECT', 'research_study', studyId, { after: 'REJECTED', reason });
}

/**
 * Approve and publish a study — ADMIN only. Fail-closed: every precondition must
 * hold or the operation throws and nothing changes (docs/23 Phase 17).
 */
export async function approveAndPublish(exec: QueryExecutor, actor: ActorContext, studyId: string): Promise<void> {
  requireRole(actor, CAN_PUBLISH, 'approveAndPublish');

  const study = await exec.query<ResearchStudyRow>(`select * from research_study where id = $1`, [studyId]);
  const s = study.rows[0];
  if (!s) throw new PublicationError('Study does not exist.');
  if (s.is_demo) throw new PublicationError('Refusing to publish demo data.');
  if (s.lifecycle_state !== 'PENDING_REVIEW') {
    throw new PublicationError(`Study must be PENDING_REVIEW to publish (is ${s.lifecycle_state}).`);
  }

  const provenance = await exec.query<{ n: string }>(
    `select count(*)::text n from publication where study_id = $1 and source_id is not null`,
    [studyId]
  );
  if (Number(provenance.rows[0]!.n) === 0) throw new PublicationError('A provenance source is required to publish.');

  const identifiers = await exec.query<{ n: string }>(
    `select count(*)::text n from research_identifier i
       join publication p on p.id = i.publication_id
      where p.study_id = $1`,
    [studyId]
  );
  if (Number(identifiers.rows[0]!.n) === 0) throw new PublicationError('At least one identifier (DOI or URL) is required.');

  const outcome = await exec.query<{ n: string }>(
    `select count(*)::text n from classification where study_id = $1 and dimension = 'OUTCOME'`,
    [studyId]
  );
  if (Number(outcome.rows[0]!.n) === 0) throw new PublicationError('An OUTCOME classification is required to publish.');

  await exec.query(`update research_study set lifecycle_state = 'PUBLISHED', updated_at = now() where id = $1`, [studyId]);
  await exec.query(`update publication set publication_state = 'PUBLISHED', updated_at = now() where study_id = $1`, [studyId]);
  await audit(exec, actor, 'PUBLISH', 'research_study', studyId, { before: 'PENDING_REVIEW', after: 'PUBLISHED' });
}

/** Archive a published/other study — ADMIN only. */
export async function archive(exec: QueryExecutor, actor: ActorContext, studyId: string): Promise<void> {
  requireRole(actor, CAN_PUBLISH, 'archive');
  await exec.query(`update research_study set lifecycle_state = 'ARCHIVED', updated_at = now() where id = $1`, [studyId]);
  await exec.query(`update publication set publication_state = 'ARCHIVED', updated_at = now() where study_id = $1`, [studyId]);
  await audit(exec, actor, 'ARCHIVE', 'research_study', studyId, { after: 'ARCHIVED' });
}

/** Find an existing study by DOI (dedup during creation). */
export async function findExistingByDoi(exec: QueryExecutor, rawDoi: string): Promise<ResearchStudyRow | null> {
  const normalized = normalizeDoi(rawDoi);
  if (!normalized.ok) return null;
  const { rows } = await exec.query<ResearchStudyRow>(
    `select s.* from research_study s
       join publication p on p.study_id = s.id
       join research_identifier i on i.publication_id = p.id
      where i.id_type = 'DOI' and i.value_canonical = $1
      limit 1`,
    [normalized.doi]
  );
  return rows[0] ?? null;
}

export type { IdentifierType, OutcomeValue };
