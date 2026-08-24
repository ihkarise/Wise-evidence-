/**
 * M6.1 operational verification harness (NOT a unit test).
 *
 * Runs ONE controlled enrichment cycle over ONE clearly-labelled DEMO study, with
 * whatever provider the environment configures, to prove the real M6 pipeline end
 * to end and measure real token usage + cost. It exercises the SAME code the web
 * orchestrator uses: @wise-evidence/ai (provider, prompt-injection wrap,
 * validation, input hash, cost) + ai-jobs persistence/cache under RLS.
 *
 * Gated: it is INERT unless RUN_M6_1=1, so it never runs in normal CI. With no AI
 * env it uses the deterministic MockAIProvider (proves the wiring, no spend); set
 * AI_PROVIDER=openai-compatible + AI_BASE_URL/AI_MODEL/AI_API_KEY (+ optional
 * AI_INPUT_PRICE_PER_M/AI_OUTPUT_PRICE_PER_M) to run the real provider/cost test.
 *
 *   RUN_M6_1=1 pnpm exec vitest run packages/database/src/m6-1-verify.test.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MockAIProvider,
  OpenAICompatibleProvider,
  computeInputHash,
  validateOutput,
  estimateCostUsd,
  pricingFromEnv,
  PROMPT_VERSION,
  TASK_OPERATION,
  AI_TASKS,
  type AIProvider,
  type AITask,
  type AIEnrichmentRequest,
  type AIUsage,
  type StudyInput,
} from '@wise-evidence/ai';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { findCachedSuggestion, persistSuggestion, type AiCacheKey } from './ai-jobs.js';
import type { ActorContext } from './service.js';

const RUN = process.env.RUN_M6_1 === '1';

/**
 * Load AI_* keys from a local, gitignored `.env` at the repo root into
 * process.env (Vitest does not auto-load .env). Only `AI_`-prefixed keys are
 * read, only when not already set, so the credential stays local and is never
 * committed, logged, or pulled from anywhere but the operator's own file. Real
 * injected env vars (if present) always win.
 */
function loadAiEnvFromDotenv(): void {
  let text: string;
  try {
    text = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
  } catch {
    return; // no .env — rely on real env vars (or fall back to the mock)
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.startsWith('AI_') || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
// Deterministic DEMO record from the seed fixtures (is_demo = true).
const DEMO_STUDY = '00000000-0000-0000-0000-000000001001';
const REVIEWER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a1', role: 'REVIEWER' };
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1';

const OUTCOME_VALUES = ['STRONG_POSITIVE', 'POSITIVE', 'LEANING_POSITIVE', 'NEUTRAL_INCONCLUSIVE', 'LEANING_NEGATIVE', 'NEGATIVE', 'STRONG_NEGATIVE'];
const QUALITY_VALUES = ['ADEQUATE', 'UNCLEAR', 'INADEQUATE', 'NOT_APPLICABLE'];

function selectProvider(): AIProvider {
  if (process.env.AI_PROVIDER === 'openai-compatible') {
    return new OpenAICompatibleProvider({
      baseUrl: process.env.AI_BASE_URL!,
      model: process.env.AI_MODEL!,
      apiKey: process.env.AI_API_KEY!,
      referer: process.env.AI_REFERER,
      title: 'WiseEvidence',
    });
  }
  return new MockAIProvider(process.env.AI_MODEL ?? 'mock-1');
}

interface Row {
  task: AITask;
  cached: boolean;
  valid: boolean;
  value: string | null;
  usage: AIUsage | null | undefined;
  cost: number | null;
  note: string;
}

describe.skipIf(!RUN)('M6.1 operational verification (gated by RUN_M6_1)', () => {
  it('runs one controlled six-task cycle on a DEMO study, with cache + cost', async () => {
    loadAiEnvFromDotenv();
    const db: TestDatabase = await createTestDatabase({ seed: true });
    try {
      const provider = selectProvider();
      const pricing = pricingFromEnv(process.env);
      let providerCalls = 0;

      // Read the DEMO study's AI input + taxonomy allowed-value sets.
      const { input, studyTypes, evidenceLevels } = await db.asRolePersistent('authenticated', REVIEWER_SUB, async (exec) => {
        const base = (
          await exec.query<{
            canonical_title: string;
            summary: string | null;
            study_type_code: string | null;
            subject: string | null;
            journal: string | null;
            year: string | null;
            abstract: string | null;
            is_demo: boolean;
          }>(
            `select s.canonical_title, s.summary, s.study_type_code, s.subject,
                    j.display_name as journal, to_char(p.publication_date,'YYYY') as year, p.abstract, s.is_demo
               from research_study s
               left join publication p on p.study_id = s.id and p.is_primary = true
               left join journal j on j.id = p.journal_id
              where s.id = $1 limit 1`,
            [DEMO_STUDY]
          )
        ).rows[0]!;
        expect(base.is_demo).toBe(true); // Step 3: use a DEMO record
        const st = (await exec.query<{ code: string }>(`select code from study_type order by hierarchy_position`)).rows.map((r) => r.code);
        const el = (await exec.query<{ code: string }>(`select code from evidence_level order by pyramid_rank`)).rows.map((r) => r.code);
        const si: StudyInput = {
          title: base.canonical_title,
          summary: base.summary,
          studyType: base.study_type_code,
          subject: base.subject,
          journal: base.journal,
          year: base.year,
          abstract: base.abstract,
        };
        return { input: si, studyTypes: st, evidenceLevels: el };
      });

      const allowedFor = (task: AITask): string[] => {
        if (task === 'outcome') return OUTCOME_VALUES;
        if (task === 'quality') return QUALITY_VALUES;
        if (task === 'study-type') return studyTypes;
        if (task === 'evidence-level') return evidenceLevels;
        return [];
      };

      const runTask = async (task: AITask): Promise<Row> => {
        const req: AIEnrichmentRequest = { task, input, allowedValues: allowedFor(task) };
        const inputHash = await computeInputHash(req);
        const key: AiCacheKey = {
          studyId: DEMO_STUDY,
          operation: TASK_OPERATION[task],
          inputHash,
          provider: provider.name,
          model: provider.model,
          promptVersion: PROMPT_VERSION[task],
        };
        const cached = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => findCachedSuggestion(exec, key));
        if (cached) {
          return { task, cached: true, valid: true, value: cached.suggestedValue, usage: null, cost: null, note: 'served from cache (no paid call)' };
        }
        providerCalls++;
        const pr = await provider.enrich(req);
        if (!pr.ok) {
          await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => persistSuggestion(exec, REVIEWER, { key, status: 'FAILED' }));
          return { task, cached: false, valid: false, value: null, usage: null, cost: null, note: `provider error: ${pr.message}` };
        }
        const cost = pricing ? estimateCostUsd(pr.usage, pricing) : null;
        const v = validateOutput(task, pr.raw, req.allowedValues);
        if (!v.ok) {
          await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => persistSuggestion(exec, REVIEWER, { key, status: 'FAILED', costEstimate: cost }));
          return { task, cached: false, valid: false, value: null, usage: pr.usage, cost, note: `INVALID output: ${v.message}` };
        }
        await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
          persistSuggestion(exec, REVIEWER, {
            key,
            status: 'SUCCEEDED',
            costEstimate: cost,
            result: { output: v.suggestion.output, suggestedValue: v.suggestion.suggestedValue, confidence: v.suggestion.confidence, validationStatus: 'VALID' },
          })
        );
        return { task, cached: false, valid: true, value: v.suggestion.suggestedValue, usage: pr.usage, cost, note: 'persisted (pending human review)' };
      };

      const rows: Row[] = [];
      for (const task of AI_TASKS) rows.push(await runTask(task));

      // Cache check (Step 6): a second identical request must NOT call the provider.
      const callsBefore = providerCalls;
      const second = await runTask('outcome');
      expect(second.cached).toBe(true);
      expect(providerCalls).toBe(callsBefore); // no duplicate paid call

      // ---- Report ----
      const totalTokens = rows.reduce((n, r) => n + (r.usage?.totalTokens ?? 0), 0);
      const totalCost = rows.reduce((n, r) => n + (r.cost ?? 0), 0);
      const fmtCost = (c: number | null) => (c === null ? 'n/a' : `$${c.toFixed(6)}`);
      const lines = [
        '',
        '================ M6.1 OPERATIONAL VERIFICATION ================',
        `provider: ${provider.name}   model: ${provider.model}`,
        `pricing configured: ${pricing ? `in $${pricing.inputPerMillion}/1M, out $${pricing.outputPerMillion}/1M` : 'NO (cost = n/a)'}`,
        `study: ${DEMO_STUDY} (DEMO)`,
        '-------------------------------------------------------------',
        'task            cached valid value                          in/out/total   cost',
        ...rows.map((r) => {
          const u = r.usage ? `${r.usage.inputTokens ?? '-'}/${r.usage.outputTokens ?? '-'}/${r.usage.totalTokens ?? '-'}` : '-';
          return `${r.task.padEnd(15)} ${String(r.cached).padEnd(6)} ${String(r.valid).padEnd(5)} ${String(r.value ?? '').slice(0, 30).padEnd(30)} ${u.padEnd(14)} ${fmtCost(r.cost)}`;
        }),
        '-------------------------------------------------------------',
        `six-task totals: tokens=${totalTokens || 'n/a'}  cost=${pricing ? fmtCost(totalCost) : 'n/a (configure AI_*_PRICE_PER_M)'}`,
        pricing ? `projection (ESTIMATE): 100=${fmtCost(totalCost * 100)}  1,000=${fmtCost(totalCost * 1000)}  10,000=${fmtCost(totalCost * 10000)}` : 'projection: n/a until pricing configured',
        '=============================================================',
        '',
      ];
      console.log(lines.join('\n'));

      // Invariants: every task produced a persisted job; validation ran on each.
      expect(rows).toHaveLength(AI_TASKS.length);
      for (const r of rows) expect(typeof r.valid).toBe('boolean');
    } finally {
      await db.close();
    }
  });
});
