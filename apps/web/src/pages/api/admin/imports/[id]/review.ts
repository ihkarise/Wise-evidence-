export const prerender = false;
import type { APIRoute } from 'astro';
import { approveCandidate, rejectCandidate, markCandidateDuplicate } from '@wise-evidence/database';
import { withActor } from '../../../../../server/db.js';
import { json, readJson } from '../../../../../server/http.js';

interface ReviewBody {
  candidateId?: string;
  action?: 'approve' | 'reject' | 'duplicate';
  reason?: string;
  duplicateOfStudyId?: string | null;
}

/**
 * POST { candidateId, action, reason?, duplicateOfStudyId? } → review one import
 * candidate. `approve` creates an M3 DRAFT (never publishes). Staff-only.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ ok: false, error: 'unauthorized' }, 401);
  const body = await readJson<ReviewBody>(request);
  const candidateId = body.candidateId;
  if (!candidateId) return json({ ok: false, error: 'candidateId is required' }, 400);
  const actor = { appUserId: staff.appUserId, role: staff.role };

  try {
    const result = await withActor({ role: 'authenticated', sub: staff.sub }, async (exec) => {
      if (body.action === 'approve') return { studyId: (await approveCandidate(exec, actor, candidateId)).studyId };
      if (body.action === 'reject') {
        await rejectCandidate(exec, actor, candidateId, body.reason ?? '');
        return {};
      }
      if (body.action === 'duplicate') {
        await markCandidateDuplicate(exec, actor, candidateId, {
          reason: body.reason,
          duplicateOfStudyId: body.duplicateOfStudyId ?? null,
        });
        return {};
      }
      throw new Error('unknown action');
    });
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
