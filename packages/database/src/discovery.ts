/**
 * Automated research discovery — persistence + review workflow (M7, docs/25).
 *
 * Discovery is a controlled CANDIDATE-generation mechanism. This layer writes
 * import_job / import_candidate under RLS (staff = reviewer or admin, migration
 * 0016) and turns a human-APPROVED candidate into a draft by calling the M3
 * `createDraft` service — it never publishes, never classifies, and never deletes
 * or merges research. Dedup by DOI only flags; title similarity is not identity.
 */
import type { NormalizedDiscoveryRecord } from '@wise-evidence/discovery';
import type { QueryExecutor } from './db.js';
import type { AppRole, ImportCandidateRow, ImportJobRow, ImportMethod, ImportState } from './types.js';
import { PermissionError, ValidationError, createDraft, type ActorContext } from './service.js';

const CAN_DISCOVER: AppRole[] = ['REVIEWER', 'ADMIN'];

function requireStaff(actor: ActorContext, op: string): void {
  if (!CAN_DISCOVER.includes(actor.role)) throw new PermissionError(`Role ${actor.role} may not ${op}.`);
}

async function audit(
  exec: QueryExecutor,
  actor: ActorContext,
  action: string,
  entityId: string,
  opts: { field?: string; after?: string; reason?: string } = {}
): Promise<void> {
  await exec.query(
    `insert into audit_log (actor, action, entity, entity_id, field, after_value, reason)
     values ($1, $2, 'import_candidate', $3, $4, $5, $6)`,
    [actor.appUserId, action, entityId, opts.field ?? null, opts.after ?? null, opts.reason ?? null]
  );
}

// --- Job lifecycle ---------------------------------------------------------

export interface StartImportJobInput {
  sourceName: string;
  trigger?: ImportMethod;
}

/** Open an import job (state DISCOVERED). Staff-only; RLS also enforces. */
export async function startImportJob(exec: QueryExecutor, actor: ActorContext, input: StartImportJobInput): Promise<{ jobId: string }> {
  requireStaff(actor, 'start a discovery job');
  const name = input.sourceName?.trim();
  if (!name) throw new ValidationError('Source name is required.');
  const { rows } = await exec.query<{ id: string }>(
    `insert into import_job (source_name, trigger, state) values ($1, $2, 'DISCOVERED') returning id`,
    [name.slice(0, 200), input.trigger ?? 'CONNECTOR']
  );
  return { jobId: rows[0]!.id };
}

export interface ImportJobCounts {
  discovered: number;
  normalized: number;
  duplicate: number;
  candidate: number;
  error: number;
}

/** Close a job with honest per-stage counts. `failed` marks a hard connector failure. */
export async function finalizeImportJob(
  exec: QueryExecutor,
  actor: ActorContext,
  jobId: string,
  counts: ImportJobCounts,
  failed = false
): Promise<void> {
  requireStaff(actor, 'finalize a discovery job');
  await exec.query(
    `update import_job
        set state = $2, discovered_count = $3, normalized_count = $4, duplicate_count = $5,
            candidate_count = $6, error_count = $7, ended_at = now()
      where id = $1`,
    [jobId, failed ? 'FAILED' : 'IMPORTED', counts.discovered, counts.normalized, counts.duplicate, counts.candidate, counts.error]
  );
}

// --- Deduplication ---------------------------------------------------------

/**
 * Map canonical DOIs to the study id that already holds them (one query, no
 * N+1). A match means "already indexed" — the existing study is never touched.
 */
export async function findExistingStudyIdsByDois(exec: QueryExecutor, dois: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(dois.filter((d) => d))];
  if (unique.length === 0) return {};
  const { rows } = await exec.query<{ doi: string; study_id: string }>(
    `select i.value_canonical as doi, p.study_id
       from research_identifier i
       join publication p on p.id = i.publication_id
      where i.id_type = 'DOI' and i.value_canonical = any($1)`,
    [unique]
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.doi] = r.study_id;
  return map;
}

// --- Candidates ------------------------------------------------------------

export interface RecordCandidateInput {
  normalized: NormalizedDiscoveryRecord;
  raw: unknown;
  state: ImportState;
  duplicateOfStudyId?: string | null;
  errorDetail?: string | null;
}

/** Persist one discovered candidate (raw + normalized payloads + dedup state). */
export async function recordCandidate(
  exec: QueryExecutor,
  actor: ActorContext,
  jobId: string,
  input: RecordCandidateInput
): Promise<{ candidateId: string }> {
  requireStaff(actor, 'record a candidate');
  const { rows } = await exec.query<{ id: string }>(
    `insert into import_candidate
       (job_id, raw_payload, normalized_payload, state, source_record_id, duplicate_of_study_id, error_detail)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      jobId,
      JSON.stringify(input.raw ?? null),
      JSON.stringify(input.normalized),
      input.state,
      input.normalized.sourceRecordId.slice(0, 200) || null,
      input.duplicateOfStudyId ?? null,
      input.errorDetail ?? null,
    ]
  );
  const candidateId = rows[0]!.id;
  await audit(exec, actor, 'DISCOVER_CANDIDATE', candidateId, { after: input.state });
  return { candidateId };
}

// --- Read models (admin) ---------------------------------------------------

export async function listImportJobs(exec: QueryExecutor, limit = 50): Promise<ImportJobRow[]> {
  const { rows } = await exec.query<ImportJobRow>(
    `select * from import_job order by started_at desc limit $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}

export async function getImportJob(exec: QueryExecutor, jobId: string): Promise<ImportJobRow | null> {
  const { rows } = await exec.query<ImportJobRow>(`select * from import_job where id = $1`, [jobId]);
  return rows[0] ?? null;
}

export interface CandidateView extends ImportCandidateRow {
  /** Title of the existing study a duplicate points to (for the reviewer). */
  duplicate_of_title: string | null;
}

export async function listCandidates(exec: QueryExecutor, jobId: string): Promise<CandidateView[]> {
  const { rows } = await exec.query<CandidateView>(
    `select c.*, s.canonical_title as duplicate_of_title
       from import_candidate c
       left join research_study s on s.id = c.duplicate_of_study_id
      where c.job_id = $1
      order by c.created_at asc`,
    [jobId]
  );
  return rows;
}

export async function getCandidate(exec: QueryExecutor, candidateId: string): Promise<ImportCandidateRow | null> {
  const { rows } = await exec.query<ImportCandidateRow>(`select * from import_candidate where id = $1`, [candidateId]);
  return rows[0] ?? null;
}

// --- Review decisions ------------------------------------------------------

const REVIEWABLE: ImportState[] = ['REVIEW_REQUIRED', 'DUPLICATE_CANDIDATE', 'NORMALIZED'];

function normalizedOf(row: ImportCandidateRow): NormalizedDiscoveryRecord {
  return (row.normalized_payload ?? {}) as NormalizedDiscoveryRecord;
}

async function markReviewed(exec: QueryExecutor, candidateId: string, state: ImportState, actor: ActorContext, reason?: string, extra: { duplicateOf?: string | null; importedStudyId?: string | null } = {}): Promise<void> {
  await exec.query(
    `update import_candidate
        set state = $2, reviewed_by = $3, reviewed_at = now(), review_reason = $4,
            duplicate_of_study_id = coalesce($5, duplicate_of_study_id),
            imported_study_id = coalesce($6, imported_study_id)
      where id = $1`,
    [candidateId, state, actor.appUserId, reason ?? null, extra.duplicateOf ?? null, extra.importedStudyId ?? null]
  );
}

/**
 * Approve a candidate → create an M3 DRAFT via `createDraft`. The new study is
 * IMPORTED/DRAFT and is NEVER published here. Provenance (source + DOI) flows into
 * the draft; the candidate records which study it produced.
 */
export async function approveCandidate(exec: QueryExecutor, actor: ActorContext, candidateId: string): Promise<{ studyId: string }> {
  requireStaff(actor, 'approve a candidate');
  const cand = await getCandidate(exec, candidateId);
  if (!cand) throw new ValidationError('Candidate not found.');
  if (cand.state === 'IMPORTED') throw new ValidationError('Candidate already imported.');
  if (!REVIEWABLE.includes(cand.state)) throw new ValidationError(`Candidate is not reviewable (state ${cand.state}).`);

  const n = normalizedOf(cand);
  const title = n.title?.trim();
  if (!title) throw new ValidationError('Candidate has no title; cannot create a draft.');

  // publication.publication_date is a SQL `date`. Only a full YYYY-MM-DD is valid;
  // a partial date (YYYY / YYYY-MM) is passed as null rather than fabricating a
  // day/month — the exact value remains on the candidate's raw payload.
  const fullDate = typeof n.publicationDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.publicationDate) ? n.publicationDate : null;

  const job = cand.job_id ? await getImportJob(exec, cand.job_id) : null;
  const { studyId } = await createDraft(exec, actor, {
    title,
    doi: n.doi ?? undefined,
    url: n.url ?? undefined,
    sourceName: job?.source_name ?? 'Automated discovery',
    sourceUrl: n.url ?? undefined,
    publicationTitle: title,
    abstract: n.abstract ?? undefined,
    publicationDate: fullDate,
  });

  await markReviewed(exec, candidateId, 'IMPORTED', actor, 'Approved from discovery.', { importedStudyId: studyId });
  if (cand.job_id) await exec.query(`update import_job set imported_count = imported_count + 1 where id = $1`, [cand.job_id]);
  await audit(exec, actor, 'APPROVE_CANDIDATE', candidateId, { after: studyId });
  return { studyId };
}

/** Reject a candidate. It remains auditable; nothing is deleted. */
export async function rejectCandidate(exec: QueryExecutor, actor: ActorContext, candidateId: string, reason: string): Promise<void> {
  requireStaff(actor, 'reject a candidate');
  const cand = await getCandidate(exec, candidateId);
  if (!cand) throw new ValidationError('Candidate not found.');
  if (cand.state === 'IMPORTED') throw new ValidationError('Cannot reject an already-imported candidate.');
  await markReviewed(exec, candidateId, 'REJECTED', actor, reason?.slice(0, 2000) || 'Rejected.');
  await audit(exec, actor, 'REJECT_CANDIDATE', candidateId, { reason: reason?.slice(0, 2000) });
}

/** Mark a candidate a duplicate of an existing study (optional link). Never deletes/merges. */
export async function markCandidateDuplicate(
  exec: QueryExecutor,
  actor: ActorContext,
  candidateId: string,
  input: { duplicateOfStudyId?: string | null; reason?: string }
): Promise<void> {
  requireStaff(actor, 'mark a candidate duplicate');
  const cand = await getCandidate(exec, candidateId);
  if (!cand) throw new ValidationError('Candidate not found.');
  if (cand.state === 'IMPORTED') throw new ValidationError('Cannot mark an already-imported candidate as duplicate.');
  await markReviewed(exec, candidateId, 'DUPLICATE_CANDIDATE', actor, input.reason?.slice(0, 2000) || 'Marked duplicate.', {
    duplicateOf: input.duplicateOfStudyId ?? null,
  });
  await audit(exec, actor, 'MARK_DUPLICATE', candidateId, { reason: input.reason?.slice(0, 2000) });
}
