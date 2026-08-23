import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { createDraft, setClassification, PermissionError, type ActorContext } from './service.js';
import {
  findCachedSuggestion,
  persistSuggestion,
  listLatestSuggestions,
  type AiCacheKey,
} from './ai-jobs.js';

const REVIEWER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a1', role: 'REVIEWER' };
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1';
const PUBLIC_USER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a9', role: 'PUBLIC' };
const RANDOM_SUB = '00000000-0000-0000-0000-0000000000c9';

let db: TestDatabase;
let studyId: string;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
  const created = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
    createDraft(exec, REVIEWER, { title: 'AI job test study', doi: '10.1234/ai.jobs.001', sourceName: 'Crossref' })
  );
  studyId = created.studyId;
});
afterAll(async () => {
  await db.close();
});

function key(over: Partial<AiCacheKey> = {}): AiCacheKey {
  return {
    studyId,
    operation: 'CLASSIFY_OUTCOME',
    inputHash: 'hash-a',
    provider: 'mock',
    model: 'mock-1',
    promptVersion: 'v1',
    ...over,
  };
}

const result = { output: { value: 'POSITIVE' }, suggestedValue: 'POSITIVE', confidence: 'MODERATE' as const, validationStatus: 'VALID' };

describe('AI job persistence + cache (M6)', () => {
  it('persists a SUCCEEDED job+result and finds it on the exact cache key', async () => {
    const saved = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      persistSuggestion(exec, REVIEWER, { key: key(), status: 'SUCCEEDED', result })
    );
    expect(saved).not.toBeNull();
    expect(saved!.suggestedValue).toBe('POSITIVE');
    expect(saved!.cached).toBe(false);

    const hit = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => findCachedSuggestion(exec, key()));
    expect(hit).not.toBeNull();
    expect(hit!.cached).toBe(true);
    expect(hit!.suggestedValue).toBe('POSITIVE');
  });

  it('misses the cache when the input hash (or model/prompt) differs', async () => {
    const miss = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      findCachedSuggestion(exec, key({ inputHash: 'hash-different' }))
    );
    expect(miss).toBeNull();
  });

  it('never caches a FAILED attempt (job written, no result)', async () => {
    await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      persistSuggestion(exec, REVIEWER, { key: key({ operation: 'ASSESS_QUALITY', inputHash: 'q-1' }), status: 'FAILED', result: null })
    );
    const miss = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      findCachedSuggestion(exec, key({ operation: 'ASSESS_QUALITY', inputHash: 'q-1' }))
    );
    expect(miss).toBeNull();
  });

  it('keeps ai_result immutable — a reviewer UPDATE changes nothing (RLS insert-only)', async () => {
    const saved = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      persistSuggestion(exec, REVIEWER, { key: key({ operation: 'CLASSIFY_STUDY_TYPE', inputHash: 'st-1' }), status: 'SUCCEEDED', result: { ...result, output: { value: 'RCT' }, suggestedValue: 'RCT' } })
    );
    await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      exec.query(`update ai_result set suggested_value = 'TAMPERED' where id = $1`, [saved!.resultId])
    );
    const after = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      exec.query<{ suggested_value: string }>(`select suggested_value from ai_result where id = $1`, [saved!.resultId])
    );
    expect(after.rows[0]!.suggested_value).toBe('RCT');
  });

  it('rejects enrichment by a non-staff actor at the service layer', async () => {
    await expect(
      db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
        persistSuggestion(exec, PUBLIC_USER, { key: key({ inputHash: 'x' }), status: 'SUCCEEDED', result })
      )
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('blocks a signed-in non-staff user from inserting ai_job at the RLS boundary', async () => {
    await expect(
      db.asRole('authenticated', RANDOM_SUB, (exec) =>
        exec.query(
          `insert into ai_job (study_id, operation, provider, model, prompt_version, input_hash, status)
           values ($1, 'CLASSIFY_OUTCOME', 'mock', 'mock-1', 'v1', 'rls-x', 'SUCCEEDED')`,
          [studyId]
        )
      )
    ).rejects.toThrow();
  });

  it('does NOT write a canonical classification — AI stays a suggestion until a human accepts it', async () => {
    // A suggestion exists (from the first test) but no classification does yet.
    const before = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      exec.query<{ n: number }>(`select count(*)::int as n from classification where study_id = $1 and dimension = 'OUTCOME'`, [studyId])
    );
    expect(before.rows[0]!.n).toBe(0);

    // Human accepts the AI suggestion → classification is written WITH provenance.
    const suggestions = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => listLatestSuggestions(exec, studyId));
    const outcome = suggestions.find((s) => s.operation === 'CLASSIFY_OUTCOME')!;
    await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      setClassification(exec, REVIEWER, studyId, { dimension: 'OUTCOME', value: outcome.suggestedValue!, aiResultId: outcome.resultId, finalReason: 'Accepted AI suggestion.' })
    );
    const after = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      exec.query<{ value: string; ai_result_id: string | null }>(`select value, ai_result_id from classification where study_id = $1 and dimension = 'OUTCOME'`, [studyId])
    );
    expect(after.rows[0]!.value).toBe('POSITIVE');
    expect(after.rows[0]!.ai_result_id).toBe(outcome.resultId); // provenance preserved
  });
});
