/**
 * AI job/result persistence + cache (Milestone 6, docs/10 §4/§8, ADR-016).
 *
 * AI output is stored ONLY in `ai_job` / `ai_result`. Nothing here writes a
 * canonical `classification`, changes lifecycle/publication state, or publishes —
 * a suggestion becomes canonical only when a human calls `setClassification`
 * (which records the originating `ai_result_id`). Results are immutable: a new
 * model / prompt / input creates a new job+result. Enrichment is staff-triggered
 * (reviewer or admin), enforced here and by RLS (migration 0014).
 */
import type { QueryExecutor } from './db.js';
import type { AppRole, ConfidenceLevel } from './types.js';
import { PermissionError, type ActorContext } from './service.js';

const CAN_ENRICH: AppRole[] = ['REVIEWER', 'ADMIN'];

export type AiJobStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REJECTED';

/** Identity of an AI attempt — the cache key (docs/10 §8). */
export interface AiCacheKey {
  studyId: string;
  /** ai_operation enum value. */
  operation: string;
  inputHash: string;
  provider: string;
  model: string;
  promptVersion: string;
}

/** A persisted AI suggestion, as shown to reviewers (never a canonical value). */
export interface AiSuggestionRecord {
  jobId: string;
  resultId: string;
  operation: string;
  provider: string;
  model: string;
  promptVersion: string;
  suggestedValue: string | null;
  output: unknown;
  confidence: ConfidenceLevel | null;
  validationStatus: string;
  createdAt: string;
  /** True when returned from cache rather than a fresh provider call. */
  cached: boolean;
}

export interface PersistSuggestionInput {
  key: AiCacheKey;
  status: AiJobStatus;
  costEstimate?: number | null;
  /** Present only for SUCCEEDED jobs; a FAILED/REJECTED job has no result row. */
  result?: {
    output: unknown;
    suggestedValue: string | null;
    confidence: ConfidenceLevel | null;
    validationStatus: string;
  } | null;
}

function requireEnrich(actor: ActorContext): void {
  if (!CAN_ENRICH.includes(actor.role)) {
    throw new PermissionError(`Role ${actor.role} may not run AI enrichment.`);
  }
}

async function auditEnrich(exec: QueryExecutor, actor: ActorContext, key: AiCacheKey, status: AiJobStatus): Promise<void> {
  await exec.query(
    `insert into audit_log (actor, action, entity, entity_id, field, after_value)
     values ($1, 'AI_ENRICH', 'ai_job', $2, $3, $4)`,
    [actor.appUserId, key.studyId, key.operation, status]
  );
}

/**
 * Return a prior SUCCEEDED suggestion whose job matches the full cache key
 * (study + operation + input_hash + provider + model + prompt_version), newest
 * first, or null on a cache miss (docs/10 §8).
 */
export async function findCachedSuggestion(exec: QueryExecutor, key: AiCacheKey): Promise<AiSuggestionRecord | null> {
  const res = await exec.query<{
    job_id: string;
    result_id: string;
    operation: string;
    provider: string;
    model: string;
    prompt_version: string;
    suggested_value: string | null;
    output: unknown;
    confidence: ConfidenceLevel | null;
    validation_status: string;
    created_at: string;
  }>(
    `select j.id as job_id, r.id as result_id, j.operation, j.provider, j.model,
            j.prompt_version, r.suggested_value, r.output, r.confidence,
            r.validation_status, r.created_at
       from ai_job j
       join ai_result r on r.job_id = j.id
      where j.study_id = $1 and j.operation = $2 and j.input_hash = $3
        and j.provider = $4 and j.model = $5 and j.prompt_version = $6
        and j.status = 'SUCCEEDED'
      order by r.created_at desc
      limit 1`,
    [key.studyId, key.operation, key.inputHash, key.provider, key.model, key.promptVersion]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    jobId: row.job_id,
    resultId: row.result_id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    suggestedValue: row.suggested_value,
    output: row.output,
    confidence: row.confidence,
    validationStatus: row.validation_status,
    createdAt: row.created_at,
    cached: true,
  };
}

/**
 * Persist an AI attempt. Inserts the `ai_job` (with its status) and, for a
 * SUCCEEDED attempt, the immutable `ai_result`. Returns the suggestion record for
 * a successful attempt, or null for a FAILED/REJECTED attempt (job row still
 * written for provenance). Staff-only; also gated by RLS.
 */
export async function persistSuggestion(
  exec: QueryExecutor,
  actor: ActorContext,
  input: PersistSuggestionInput
): Promise<AiSuggestionRecord | null> {
  requireEnrich(actor);
  const { key, status, result } = input;
  const jobRes = await exec.query<{ id: string }>(
    `insert into ai_job (study_id, operation, provider, model, prompt_version, input_hash, status, cost_estimate)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [key.studyId, key.operation, key.provider, key.model, key.promptVersion, key.inputHash, status, input.costEstimate ?? null]
  );
  const jobId = jobRes.rows[0]!.id;
  await auditEnrich(exec, actor, key, status);

  if (status !== 'SUCCEEDED' || !result) return null;

  const resRes = await exec.query<{ id: string; created_at: string }>(
    `insert into ai_result (job_id, output, suggested_value, confidence, validation_status)
     values ($1, $2, $3, $4, $5)
     returning id, created_at`,
    [jobId, JSON.stringify(result.output), result.suggestedValue, result.confidence, result.validationStatus]
  );
  const r = resRes.rows[0]!;
  return {
    jobId,
    resultId: r.id,
    operation: key.operation,
    provider: key.provider,
    model: key.model,
    promptVersion: key.promptVersion,
    suggestedValue: result.suggestedValue,
    output: result.output,
    confidence: result.confidence,
    validationStatus: result.validationStatus,
    createdAt: r.created_at,
    cached: false,
  };
}

/**
 * Latest successful suggestion per operation for a study, for the editor panel.
 * These are suggestions only — display alongside, never in place of, the
 * human-final classification.
 */
export async function listLatestSuggestions(exec: QueryExecutor, studyId: string): Promise<AiSuggestionRecord[]> {
  const res = await exec.query<{
    job_id: string;
    result_id: string;
    operation: string;
    provider: string;
    model: string;
    prompt_version: string;
    suggested_value: string | null;
    output: unknown;
    confidence: ConfidenceLevel | null;
    validation_status: string;
    created_at: string;
  }>(
    `select distinct on (j.operation)
            j.id as job_id, r.id as result_id, j.operation, j.provider, j.model,
            j.prompt_version, r.suggested_value, r.output, r.confidence,
            r.validation_status, r.created_at
       from ai_job j
       join ai_result r on r.job_id = j.id
      where j.study_id = $1 and j.status = 'SUCCEEDED'
      order by j.operation, r.created_at desc`,
    [studyId]
  );
  return res.rows.map((row) => ({
    jobId: row.job_id,
    resultId: row.result_id,
    operation: row.operation,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    suggestedValue: row.suggested_value,
    output: row.output,
    confidence: row.confidence,
    validationStatus: row.validation_status,
    createdAt: row.created_at,
    cached: true,
  }));
}
