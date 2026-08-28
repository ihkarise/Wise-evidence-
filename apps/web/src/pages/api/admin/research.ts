/**
 * Create a DRAFT research record from a DOI (docs/26 §13). Looks up sanitized
 * metadata (best-effort), then creates the draft via the service layer on the
 * privileged path (the actor's staff role is already enforced by middleware and
 * re-checked in the service). Never publishes. On success redirects to the
 * editor; on duplicate redirects to the existing record.
 */
import type { APIRoute } from "astro";
import { createDraftFromMetadata, toCanonicalDoi } from "@wise-evidence/database";
import { parseBody, seeOther, backWithMessage, errorResponse } from "../../../lib/http.js";
import { getMetadataProvider } from "../../../lib/metadata.js";
import { asService, isDatabaseConfigured } from "../../../lib/db.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const actor = locals.actor;
  if (!actor) return backWithMessage("/admin/research/new", "error", "Not authorized.");
  if (!isDatabaseConfigured) {
    return backWithMessage("/admin/research/new", "error", "Database is not configured.");
  }

  const body = await parseBody(request);
  const canonical = toCanonicalDoi(body.doi ?? "");
  if (!canonical) {
    return backWithMessage("/admin/research/new", "error", "That does not look like a valid DOI.");
  }

  // Best-effort metadata prefill; failure does not block manual creation.
  const lookup = await getMetadataProvider().fetchByDoi(canonical);
  const meta = lookup.ok ? lookup.metadata : null;

  const title = (body.title?.trim() || meta?.title || "").trim();
  if (!title) {
    return backWithMessage(
      "/admin/research/new",
      "error",
      "No title found for this DOI — enter one manually.",
    );
  }

  try {
    const result = await asService((db) =>
      createDraftFromMetadata(db, actor, {
        doi: canonical,
        title,
        abstract: meta?.abstract ?? null,
        journalTitle: meta?.journalTitle ?? null,
        publisher: meta?.publisher ?? null,
        publicationDate: meta?.publicationDate ?? null,
        sourceUrl: meta?.url ?? `https://doi.org/${canonical}`,
        authors: meta?.authors.map((a) => a.displayName) ?? [],
        sourceName: meta ? `Manual entry (${meta.provider})` : "Manual entry",
      }),
    );
    if (!result.created && result.duplicateOfStudyId) {
      return backWithMessage(
        `/admin/research/${result.duplicateOfStudyId}`,
        "error",
        "A record with this DOI already exists.",
      );
    }
    return seeOther(`/admin/research/${result.studyId}?ok=Draft%20created`);
  } catch (error) {
    return errorResponse(error);
  }
};
