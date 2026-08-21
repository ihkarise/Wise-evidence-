export const prerender = false;
import type { APIRoute } from 'astro';
import { submitForReview, approveAndPublish, reject, archive } from '@wise-evidence/database';
import { withActor } from '../../../../../server/db.js';
import { json, readJson } from '../../../../../server/http.js';

type Action = 'submit' | 'approve' | 'reject' | 'archive';

/**
 * POST { action, reason? } → lifecycle transition. approve/archive are ADMIN-only
 * (enforced by the service layer AND RLS); submit/reject allow reviewer or admin.
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ error: 'unauthorized' }, 401);
  const studyId = params.id;
  if (!studyId) return json({ ok: false, error: 'missing id' }, 400);
  const body = await readJson<{ action?: Action; reason?: string }>(request);
  const actor = { appUserId: staff.appUserId, role: staff.role };

  try {
    await withActor({ role: 'authenticated', sub: staff.sub }, async (exec) => {
      switch (body.action) {
        case 'submit':
          return submitForReview(exec, actor, studyId);
        case 'approve':
          return approveAndPublish(exec, actor, studyId);
        case 'reject':
          return reject(exec, actor, studyId, body.reason ?? 'rejected');
        case 'archive':
          return archive(exec, actor, studyId);
        default:
          throw new Error('unknown action');
      }
    });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
