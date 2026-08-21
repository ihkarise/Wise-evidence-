export const prerender = false;
import type { APIRoute } from 'astro';
import {
  updateDraft,
  setClassification,
  addCriticism,
  type UpdateDraftPatch,
  type SetClassificationInput,
  type AddCriticismInput,
} from '@wise-evidence/database';
import { withActor } from '../../../../../server/db.js';
import { json, readJson } from '../../../../../server/http.js';

interface SaveBody {
  patch?: UpdateDraftPatch;
  classifications?: SetClassificationInput[];
  criticism?: AddCriticismInput;
}

/** POST { patch?, classifications?, criticism? } → edit a study in place. */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ error: 'unauthorized' }, 401);
  const studyId = params.id;
  if (!studyId) return json({ ok: false, error: 'missing id' }, 400);
  const body = await readJson<SaveBody>(request);
  const actor = { appUserId: staff.appUserId, role: staff.role };
  try {
    await withActor({ role: 'authenticated', sub: staff.sub }, async (exec) => {
      if (body.patch) await updateDraft(exec, actor, studyId, body.patch);
      for (const c of body.classifications ?? []) await setClassification(exec, actor, studyId, c);
      if (body.criticism) await addCriticism(exec, actor, studyId, body.criticism);
    });
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
