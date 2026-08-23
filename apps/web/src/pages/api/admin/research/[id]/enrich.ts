export const prerender = false;
import type { APIRoute } from 'astro';
import { AI_TASKS, type AITask } from '@wise-evidence/ai';
import { enrichStudy } from '../../../../../server/ai.js';
import { json, readJson } from '../../../../../server/http.js';

/**
 * POST { task } → run one AI enrichment task and return a suggestion (ADR-016).
 * Staff-gated (middleware ensures REVIEWER/ADMIN). The result is a suggestion,
 * never a canonical value — the reviewer accepts/edits/rejects it in the editor.
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ ok: false, error: 'unauthorized' }, 401);
  const studyId = params.id;
  if (!studyId) return json({ ok: false, error: 'missing id' }, 400);

  const body = await readJson<{ task?: string }>(request);
  const task = body.task as AITask;
  if (!task || !AI_TASKS.includes(task)) {
    return json({ ok: false, error: `unknown task; expected one of ${AI_TASKS.join(', ')}` }, 400);
  }

  try {
    const outcome = await enrichStudy(staff, studyId, task);
    if (!outcome.ok) return json({ ok: false, error: outcome.error ?? 'enrichment failed' }, 400);
    const s = outcome.suggestion;
    return json({
      ok: true,
      cached: outcome.cached,
      task,
      suggestion: s
        ? {
            resultId: s.resultId,
            suggestedValue: s.suggestedValue,
            output: s.output,
            confidence: s.confidence,
            provider: s.provider,
            model: s.model,
            promptVersion: s.promptVersion,
          }
        : null,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
