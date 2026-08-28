export const prerender = false;
import type { APIRoute } from 'astro';
import { runDiscovery } from '../../../../server/discovery.js';
import { json, readJson } from '../../../../server/http.js';

/** POST { query, sourceName?, maxResults? } → run one bounded discovery job (staff-only). */
export const POST: APIRoute = async ({ request, locals }) => {
  const staff = locals.staff;
  if (!staff) return json({ ok: false, error: 'unauthorized' }, 401);
  const body = await readJson<{ query?: string; sourceName?: string; maxResults?: number }>(request);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) return json({ ok: false, error: 'query is required' }, 400);
  try {
    const summary = await runDiscovery(staff, {
      query,
      sourceName: typeof body.sourceName === 'string' ? body.sourceName : undefined,
      maxResults: typeof body.maxResults === 'number' ? body.maxResults : undefined,
    });
    return json(summary, summary.ok ? 200 : 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400);
  }
};
