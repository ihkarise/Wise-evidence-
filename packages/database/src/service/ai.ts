/**
 * AI persistence, cache, and human-decision layer (docs/29 §7, §8, §13, §19).
 *
 * This module owns the DATABASE side of Milestone 6: it records AI jobs and
 * immutable AI results, resolves the cache identity, lists suggestions for the
 * editor, and records the human Accept / Edit / Reject decision in the append-only
 * audit log. It runs on the same narrow SqlExecutor boundary as the rest of the
 * service layer and holds NO AI logic — the provider call, prompt registry, and
 * output validation live in `@wise-evidence/ai`, which this package does NOT
 * import (keeping the data-access boundary provider-independent).
 *
 * Firewalls this layer preserves:
 *   - AI writes ONLY ai_job / ai_result (both private, staff-read-only via RLS,
 *     written only on the trusted service_role path). It never writes canonical
 *     classification/quality/criticism/summary, never publishes, and never
 *     changes lifecycle/publication state.
 *   - ai_result is immutable (the 0006 append-only trigger); a new run is a new
 *     row, never an update.
 *   - The cache identity is the M2 unique key
 *     (study, operation, input_hash, model, prompt_version), so a result from a
 *     different prompt version or model can never masquerade as current.
 */
import { type Actor, type SqlExecutor, ServiceError, requireStaff } from "../executor.js";

// --- cache identity ----------------------------------------------------------

/** The parts of the AI cache key that identify a job (docs/29 §13). */
export interface AiJobKey {
  readonly studyId: string;
  readonly operation: string; // task id, e.g. "outcome-classification"
  readonly inputHash: string;
  readonly model: string;
  readonly promptVersion: string;
}

/** Token usage as recorded — NULL means "not reported", never zero (docs/29 §14). */
export interface AiUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
}

/** A stored suggestion (job + its result) as read back for the editor/cache. */
export interface StoredSuggestion {
  readonly jobId: string;
  readonly resultId: string | null;
  readonly operation: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputHash: string;
  readonly jobStatus: string;
  readonly validationStatus: string | null;
  readonly output: unknown;
  readonly confidence: number | null;
  readonly costEstimate: number | null;
  readonly usage: AiUsage;
  readonly errorDetail: string | null;
  readonly createdAt: string;
  /** Latest human decision recorded for this result: ACCEPT | EDIT | REJECT | null. */
  readonly decision: string | null;
}

// --- record an execution -----------------------------------------------------

/** A validated (or invalidated) provider result to persist (docs/29 §11). */
export interface ExecutionResult {
  readonly validationStatus: "VALID" | "INVALID";
  readonly output: unknown;
  readonly confidence: number | null;
  readonly usage: AiUsage;
  readonly costEstimate: number | null;
  readonly validationError: string | null;
  readonly rawOutputSha256: string | null;
}

/** A hard provider failure to persist (no ai_result is created) (docs/29 §18). */
export interface ExecutionFailure {
  readonly reason: string;
  readonly errorDetail: string;
  readonly usage: AiUsage;
}

export interface RecordExecutionInput {
  readonly key: AiJobKey;
  readonly provider: string;
  readonly promptContentHash: string;
  /** Exactly one of `result` / `failure` must be set. */
  readonly result?: ExecutionResult;
  readonly failure?: ExecutionFailure;
}

export interface RecordExecutionOutput {
  readonly jobId: string;
  readonly resultId: string | null;
  readonly cached: false;
}

/**
 * Persist one AI execution (job + optional immutable result) on the trusted
 * server path. Staff-only, atomic, and idempotent-guarded by the cache-key unique
 * constraint (a concurrent duplicate raises `duplicate`; the caller re-reads the
 * cached row). NEVER writes canonical data.
 */
export async function recordExecution(
  db: SqlExecutor,
  actor: Actor,
  input: RecordExecutionInput,
): Promise<RecordExecutionOutput> {
  requireStaff(actor);
  if ((input.result ? 1 : 0) + (input.failure ? 1 : 0) !== 1) {
    throw new ServiceError("invalid-input", "exactly one of result/failure is required");
  }
  const { key } = input;

  await db.query("begin");
  try {
    const jobStatus = input.failure
      ? "FAILED"
      : input.result!.validationStatus === "VALID"
        ? "SUCCEEDED"
        : "FAILED";
    const usage = input.result?.usage ?? input.failure!.usage;
    const costEstimate = input.result?.costEstimate ?? null;
    const errorDetail = input.failure?.errorDetail ?? input.result?.validationError ?? null;

    const jobRows = await db.query<{ id: string }>(
      `insert into ai_job
         (research_study_id, operation, provider, model, prompt_version, input_hash,
          status, cost_estimate, input_tokens, output_tokens, total_tokens,
          started_at, finished_at, error_detail, prompt_content_hash)
       values ($1,$2,$3,$4,$5,$6,$7::ai_job_status,$8,$9,$10,$11, now(), now(), $12, $13)
       returning id`,
      [
        key.studyId,
        key.operation,
        input.provider,
        key.model,
        key.promptVersion,
        key.inputHash,
        jobStatus,
        costEstimate,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        errorDetail,
        input.promptContentHash,
      ],
    );
    const jobId = jobRows.rows[0]?.id;
    if (!jobId) throw new ServiceError("invalid-input", "failed to create ai_job");

    let resultId: string | null = null;
    if (input.result) {
      const resRows = await db.query<{ id: string }>(
        `insert into ai_result
           (job_id, structured_output, confidence, validation_status, validation_error, raw_output_sha256)
         values ($1, $2::jsonb, $3, $4::ai_validation_status, $5, $6)
         returning id`,
        [
          jobId,
          JSON.stringify(input.result.output),
          input.result.confidence,
          input.result.validationStatus,
          input.result.validationError,
          input.result.rawOutputSha256,
        ],
      );
      resultId = resRows.rows[0]?.id ?? null;
    }

    await db.query("commit");
    return { jobId, resultId, cached: false };
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    if (isUniqueViolation(error)) {
      throw new ServiceError("duplicate", "an AI job already exists for this cache key");
    }
    throw error;
  }
}

// --- cache lookup ------------------------------------------------------------

/**
 * Resolve the cache identity (docs/29 §13): return the stored suggestion for the
 * exact key, or null (a miss). A hit makes NO provider call. Because the cache
 * key includes model + prompt_version, a result from a different prompt version
 * or model is a different key and can never masquerade as current.
 */
export async function findCachedSuggestion(
  db: SqlExecutor,
  key: AiJobKey,
): Promise<StoredSuggestion | null> {
  const { rows } = await db.query<SuggestionRow>(
    `${SUGGESTION_SELECT}
      where j.research_study_id = $1
        and j.operation = $2
        and j.input_hash = $3
        and j.model = $4
        and j.prompt_version = $5
      order by j.created_at desc
      limit 1`,
    [key.studyId, key.operation, key.inputHash, key.model, key.promptVersion],
  );
  const row = rows[0];
  return row ? toSuggestion(row) : null;
}

/** All suggestions for a study (latest first), for the editor AI panel. */
export async function getStudySuggestions(
  db: SqlExecutor,
  studyId: string,
): Promise<StoredSuggestion[]> {
  const { rows } = await db.query<SuggestionRow>(
    `${SUGGESTION_SELECT}
      where j.research_study_id = $1
      order by j.created_at desc
      limit 200`,
    [studyId],
  );
  return rows.map(toSuggestion);
}

// --- human decision (append-only) --------------------------------------------

/** Read one stored suggestion's task, study, validation state, and output. */
export async function getSuggestionOutput(
  db: SqlExecutor,
  resultId: string,
): Promise<{
  readonly studyId: string;
  readonly operation: string;
  readonly validationStatus: string;
  readonly output: unknown;
} | null> {
  const { rows } = await db.query<{
    study_id: string;
    operation: string;
    validation_status: string;
    structured_output: unknown;
  }>(
    `select j.research_study_id as study_id, j.operation, r.validation_status, r.structured_output
       from ai_result r join ai_job j on j.id = r.job_id
      where r.id = $1`,
    [resultId],
  );
  const r = rows[0];
  return r
    ? {
        studyId: r.study_id,
        operation: r.operation,
        validationStatus: r.validation_status,
        output: r.structured_output,
      }
    : null;
}

export type SuggestionDecision = "ACCEPT" | "EDIT" | "REJECT";

/**
 * Record the human Accept / Edit / Reject decision on an AI suggestion in the
 * append-only audit log (docs/29 §19). This does NOT write canonical data — the
 * canonical value (on Accept/Edit) is written separately by the existing service
 * ops (setOutcome, setQualitySummary, addCriticism, updateStudyIdentity) which
 * carry the ai_result_id provenance. Reject records the decision only; the
 * immutable ai_result is preserved and never becomes canonical.
 */
export async function recordSuggestionDecision(
  db: SqlExecutor,
  actor: Actor,
  params: {
    readonly resultId: string;
    readonly studyId: string;
    readonly task: string;
    readonly decision: SuggestionDecision;
    readonly note?: string | null;
  },
): Promise<void> {
  requireStaff(actor);
  await db.query(
    `insert into audit_log (actor, action, entity, entity_id, before, after, reason)
     values ($1, $2, 'ai_result', $3, null, $4::jsonb, $5)`,
    [
      actor.id,
      `ai_${params.decision.toLowerCase()}`,
      params.resultId,
      JSON.stringify({ task: params.task, study_id: params.studyId, decision: params.decision }),
      params.note ?? null,
    ],
  );
}

// --- minimized task input (data minimization, docs/29 §9, §12) ---------------

/**
 * Build the MINIMISED structured input for a task from canonical DB fields.
 * Sends only what the task needs — never full PDFs, credentials, audit data, or
 * unnecessary personal information (docs/29 §12). Returns null if the study is
 * not visible/absent. The caller hashes this object for the cache key and wraps
 * it as untrusted data before it reaches a provider.
 */
export async function getEnrichmentInput(
  db: SqlExecutor,
  studyId: string,
  task: string,
): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query<{
    canonical_title: string;
    normalized_title: string;
    subject_type: string;
    study_type_code: string | null;
    abstract: string | null;
    publication_year: number | null;
    journal_title: string | null;
  }>(
    `select s.canonical_title, s.normalized_title, s.subject_type,
            st.code as study_type_code,
            p.abstract,
            extract(year from p.publication_date)::int as publication_year,
            j.normalized_name as journal_title
       from research_study s
       left join study_type st on st.id = s.study_type_id
       left join publication p on p.study_id = s.id and p.is_primary = true
       left join journal j on j.id = p.journal_id
      where s.id = $1`,
    [studyId],
  );
  const r = rows[0];
  if (!r) return null;

  const common = {
    title: r.canonical_title,
    abstract: r.abstract,
    studyType: r.study_type_code,
    subjectType: r.subject_type,
    journal: r.journal_title,
    publicationYear: r.publication_year,
  };

  switch (task) {
    case "research-summary":
    case "outcome-classification":
    case "evidence-quality":
    case "criticism-extraction":
      return common;
    case "metadata-extraction":
      return {
        title: r.canonical_title,
        abstract: r.abstract,
        journal: r.journal_title,
        publicationYear: r.publication_year,
      };
    case "duplicate-detection": {
      // Candidates: other studies sharing the exact normalized title (bounded).
      // No scraping, no discovery — only records already in the catalogue.
      const cand = await db.query<{ id: string; title: string; year: number | null }>(
        `select s.id, s.canonical_title as title,
                extract(year from p.publication_date)::int as year
           from research_study s
           left join publication p on p.study_id = s.id and p.is_primary = true
          where s.normalized_title = $1 and s.id <> $2
          order by s.created_at asc
          limit 25`,
        [r.normalized_title, studyId],
      );
      return {
        target: {
          title: r.canonical_title,
          normalizedTitle: r.normalized_title,
          year: r.publication_year,
        },
        candidates: cand.rows.map((c) => ({ id: c.id, title: c.title, year: c.year })),
      };
    }
    default:
      return null;
  }
}

// --- internals ---------------------------------------------------------------

interface SuggestionRow {
  job_id: string;
  result_id: string | null;
  operation: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_hash: string;
  job_status: string;
  validation_status: string | null;
  structured_output: unknown;
  confidence: string | null;
  cost_estimate: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  error_detail: string | null;
  created_at: string;
  decision: string | null;
}

const SUGGESTION_SELECT = `
  select j.id as job_id, r.id as result_id, j.operation, j.provider, j.model,
         j.prompt_version, j.input_hash, j.status as job_status,
         r.validation_status, r.structured_output, r.confidence, j.cost_estimate,
         j.input_tokens, j.output_tokens, j.total_tokens, j.error_detail,
         j.created_at,
         (select a.action from audit_log a
           where a.entity = 'ai_result' and a.entity_id = r.id
           order by a.created_at desc limit 1) as decision
    from ai_job j
    left join ai_result r on r.job_id = j.id`;

function toSuggestion(row: SuggestionRow): StoredSuggestion {
  return {
    jobId: row.job_id,
    resultId: row.result_id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    inputHash: row.input_hash,
    jobStatus: row.job_status,
    validationStatus: row.validation_status,
    output: row.structured_output,
    confidence: row.confidence === null ? null : Number(row.confidence),
    costEstimate: row.cost_estimate === null ? null : Number(row.cost_estimate),
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
    },
    errorDetail: row.error_detail,
    createdAt: row.created_at,
    // Map the audit action back to a decision label.
    decision: row.decision ? row.decision.replace(/^ai_/, "").toUpperCase() : null,
  };
}

/** Detect a PostgreSQL unique-violation (SQLSTATE 23505) across drivers. */
function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /duplicate key value|unique constraint/i.test(message);
}
