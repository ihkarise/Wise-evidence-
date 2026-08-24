import {
  MockAIProvider,
  OpenAICompatibleProvider,
  computeInputHash,
  validateOutput,
  estimateCostUsd,
  pricingFromEnv,
  PROMPT_VERSION,
  TASK_OPERATION,
  type AIProvider,
  type AITask,
  type AIEnrichmentRequest,
  type StudyInput,
} from '@wise-evidence/ai';
import {
  findCachedSuggestion,
  persistSuggestion,
  type AiCacheKey,
  type AiSuggestionRecord,
} from '@wise-evidence/database';
import { withActor } from './db.js';
import type { StaffContext } from './auth.js';

/**
 * AI enrichment orchestration (Milestone 6, ADR-016). Selects a provider from
 * server-only env, reads study input under RLS, calls the provider OUTSIDE the DB
 * transaction, validates the structured output, and persists an `ai_job` +
 * immutable `ai_result` (or a FAILED job). Returns a *suggestion* — never a
 * canonical value. AI failure leaves the record untouched (docs/10 §13).
 *
 * Provider config is server-only and never `PUBLIC_`-prefixed:
 *   AI_PROVIDER   'mock' (default) | 'openai-compatible'
 *   AI_BASE_URL   e.g. https://openrouter.ai/api/v1  (OpenAI-compatible aggregator)
 *   AI_MODEL      e.g. deepseek/deepseek-chat
 *   AI_API_KEY    secret bearer token
 */
export function getAIProvider(): AIProvider {
  const kind = process.env.AI_PROVIDER ?? 'mock';
  if (kind === 'openai-compatible') {
    const baseUrl = process.env.AI_BASE_URL;
    const model = process.env.AI_MODEL;
    const apiKey = process.env.AI_API_KEY;
    if (!baseUrl || !model || !apiKey) {
      throw new Error('AI_PROVIDER=openai-compatible requires AI_BASE_URL, AI_MODEL, and AI_API_KEY (server-only).');
    }
    return new OpenAICompatibleProvider({
      baseUrl,
      model,
      apiKey,
      referer: process.env.AI_REFERER,
      title: 'WiseEvidence',
    });
  }
  return new MockAIProvider(process.env.AI_MODEL ?? 'mock-1');
}

/** Static allowed sets for enum-backed classification tasks (taxonomy tasks query the DB). */
const OUTCOME_VALUES = [
  'STRONG_POSITIVE',
  'POSITIVE',
  'LEANING_POSITIVE',
  'NEUTRAL_INCONCLUSIVE',
  'LEANING_NEGATIVE',
  'NEGATIVE',
  'STRONG_NEGATIVE',
];
const QUALITY_VALUES = ['ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'];

interface LoadedInput {
  input: StudyInput;
  allowedValues: string[];
}

/** Read the study's AI input and the allowed value set for `task`, under the caller's RLS role. */
async function loadInput(staff: StaffContext, studyId: string, task: AITask): Promise<LoadedInput | null> {
  return withActor({ role: 'authenticated', sub: staff.sub }, async (exec) => {
    const base = await exec.query<{
      canonical_title: string;
      summary: string | null;
      study_type_code: string | null;
      subject: string | null;
      journal: string | null;
      year: string | null;
      abstract: string | null;
    }>(
      `select s.canonical_title, s.summary, s.study_type_code, s.subject,
              j.display_name as journal,
              to_char(p.publication_date, 'YYYY') as year,
              p.abstract
         from research_study s
         left join publication p on p.study_id = s.id and p.is_primary = true
         left join journal j on j.id = p.journal_id
        where s.id = $1
        limit 1`,
      [studyId]
    );
    const row = base.rows[0];
    if (!row) return null;

    const input: StudyInput = {
      title: row.canonical_title,
      summary: row.summary,
      studyType: row.study_type_code,
      subject: row.subject,
      journal: row.journal,
      year: row.year,
      abstract: row.abstract,
    };

    let allowedValues: string[] = [];
    if (task === 'outcome') allowedValues = OUTCOME_VALUES;
    else if (task === 'quality') allowedValues = QUALITY_VALUES;
    else if (task === 'study-type') {
      allowedValues = (await exec.query<{ code: string }>(`select code from study_type order by hierarchy_position`)).rows.map((r) => r.code);
    } else if (task === 'evidence-level') {
      allowedValues = (await exec.query<{ code: string }>(`select code from evidence_level order by pyramid_rank`)).rows.map((r) => r.code);
    }
    return { input, allowedValues };
  });
}

export interface EnrichOutcome {
  ok: boolean;
  cached: boolean;
  error?: string;
  suggestion?: AiSuggestionRecord;
}

/**
 * Run one enrichment task for a study and return the persisted suggestion.
 * Idempotent on the cache key (study + operation + input_hash + provider + model
 * + prompt_version): a cache hit skips the provider call.
 */
export async function enrichStudy(staff: StaffContext, studyId: string, task: AITask): Promise<EnrichOutcome> {
  const loaded = await loadInput(staff, studyId, task);
  if (!loaded) return { ok: false, cached: false, error: 'Study not found.' };

  const provider = getAIProvider();
  const req: AIEnrichmentRequest = { task, input: loaded.input, allowedValues: loaded.allowedValues };
  const inputHash = await computeInputHash(req);
  const key: AiCacheKey = {
    studyId,
    operation: TASK_OPERATION[task],
    inputHash,
    provider: provider.name,
    model: provider.model,
    promptVersion: PROMPT_VERSION[task],
  };
  const actor = { appUserId: staff.appUserId, role: staff.role };

  // Cache check (reuse a prior SUCCEEDED result, docs/10 §8).
  const cached = await withActor({ role: 'authenticated', sub: staff.sub }, (exec) => findCachedSuggestion(exec, key));
  if (cached) return { ok: true, cached: true, suggestion: cached };

  // Provider call happens OUTSIDE any DB transaction (no lock held during I/O).
  const providerResult = await provider.enrich(req);
  if (!providerResult.ok) {
    await withActor({ role: 'authenticated', sub: staff.sub }, (exec) =>
      persistSuggestion(exec, actor, { key, status: 'FAILED', costEstimate: null })
    );
    return { ok: false, cached: false, error: providerResult.message };
  }

  // Real cost = provider-reported usage × operator-configured current pricing.
  // Null when usage or pricing is unavailable — never a guessed number.
  const pricing = pricingFromEnv(process.env);
  const costEstimate = pricing ? estimateCostUsd(providerResult.usage, pricing) : null;

  const validated = validateOutput(task, providerResult.raw, loaded.allowedValues);
  if (!validated.ok) {
    await withActor({ role: 'authenticated', sub: staff.sub }, (exec) =>
      persistSuggestion(exec, actor, { key, status: 'FAILED', costEstimate })
    );
    return { ok: false, cached: false, error: `AI output rejected: ${validated.message}` };
  }

  const saved = await withActor({ role: 'authenticated', sub: staff.sub }, (exec) =>
    persistSuggestion(exec, actor, {
      key,
      status: 'SUCCEEDED',
      costEstimate,
      result: {
        output: validated.suggestion.output,
        suggestedValue: validated.suggestion.suggestedValue,
        confidence: validated.suggestion.confidence,
        validationStatus: 'VALID',
      },
    })
  );
  return { ok: true, cached: false, suggestion: saved ?? undefined };
}
