/**
 * Admin metadata lookup (docs/26 §5-6, §11-12). Normalizes the DOI, checks for
 * an existing record (dedup), then fetches sanitized metadata from the pinned
 * Crossref provider. Staff-only (enforced by middleware). Never a general URL
 * fetcher — the input is treated strictly as a DOI.
 */
import type { APIRoute } from "astro";
import { toCanonicalDoi, findStudyByDoi } from "@wise-evidence/database";
import { parseBody, json } from "../../../lib/http.js";
import { getMetadataProvider } from "../../../lib/metadata.js";
import { asService, isDatabaseConfigured } from "../../../lib/db.js";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await parseBody(request);
  const canonical = toCanonicalDoi(body.doi ?? "");
  if (!canonical) {
    return json({ error: "That does not look like a valid DOI." }, 400);
  }

  // Dedup: surface an existing record instead of creating a duplicate.
  if (isDatabaseConfigured) {
    const existing = await asService((db) => findStudyByDoi(db, canonical));
    if (existing) {
      return json({ doi: canonical, duplicateOfStudyId: existing });
    }
  }

  const result = await getMetadataProvider().fetchByDoi(canonical);
  if (!result.ok) {
    return json({ doi: canonical, lookup: { ok: false, reason: result.reason } });
  }
  return json({ doi: canonical, lookup: { ok: true, metadata: result.metadata } });
};
