export const prerender = false;
import type { APIRoute } from 'astro';
import { getMetadataProvider } from '../../../server/db.js';
import { json, readJson } from '../../../server/http.js';

/** POST { doi } → normalized bibliographic metadata (suggestion, not authority). */
export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.staff) return json({ error: 'unauthorized' }, 401);
  const body = await readJson<{ doi?: string }>(request);
  const doi = typeof body.doi === 'string' ? body.doi : '';
  const result = await getMetadataProvider().fetchByDoi(doi);
  return json(result, result.ok ? 200 : 400);
};
