export const prerender = false;
import type { APIRoute } from 'astro';
import { createDraft, type CreateDraftInput } from '@wise-evidence/database';
import { withActor } from '../../../../server/db.js';
import { json, readJson } from '../../../../server/http.js';

/** POST a CreateDraftInput → creates a DRAFT study + primary publication. */
export const POST: APIRoute = async ({ request, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ error: 'unauthorized' }, 401);
  const input = await readJson<CreateDraftInput>(request);
  try {
    const result = await withActor({ role: 'authenticated', sub: staff.sub }, (exec) =>
      createDraft(exec, { appUserId: staff.appUserId, role: staff.role }, input)
    );
    return json({ ok: true, ...result });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
