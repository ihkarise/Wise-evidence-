/**
 * Discovery candidate review operations (M7.4B; docs/30 §11). One POST endpoint
 * that dispatches on an `op` field so the review page's structured-control forms
 * all post here and redirect back. Every op runs through the tested service layer
 * on the privileged path; the actor's staff role is enforced by middleware and
 * re-checked in the service (defense in depth on top of RLS).
 *
 * The client is never trusted for identity or state: the actor comes from the
 * server-resolved session, the candidate/study ids are validated in the service,
 * and accept derives all metadata from the candidate's own normalized payload.
 * No op publishes, classifies, deletes, or calls AI.
 */
import type { APIRoute } from "astro";
import {
  acceptCandidate,
  rejectCandidate,
  linkCandidateDuplicate,
  correctCandidate,
  requestCandidateRefetch,
  deferCandidate,
  type Actor,
  type SqlExecutor,
} from "@wise-evidence/database";
import { parseBody, backWithMessage, errorResponse } from "../../../../lib/http.js";
import { asService, isDatabaseConfigured } from "../../../../lib/db.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, params, locals }) => {
  const id = params.id ?? "";
  const back = `/admin/imports/${id}`;
  const actor = locals.actor;
  if (!actor) return backWithMessage(back, "error", "Not authorized.");
  if (!isDatabaseConfigured) return backWithMessage(back, "error", "Database is not configured.");

  const body = await parseBody(request);
  const op = body.op ?? "";

  let okMessage = "Saved";
  let dest = back;
  try {
    await asService(async (db) => {
      okMessage = await dispatch(db, actor, id, op, body);
    });
  } catch (error) {
    return errorResponse(error);
  }

  // Accept and reject leave the queue; other ops return to the candidate.
  if (op === "accept" || op === "reject") dest = "/admin/imports";
  return backWithMessage(dest, "ok", okMessage);
};

async function dispatch(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  op: string,
  body: Record<string, string>,
): Promise<string> {
  switch (op) {
    case "accept": {
      const result = await acceptCandidate(db, actor, id);
      return result.created
        ? "Accepted — a draft research record was created and is awaiting review."
        : "A study with this DOI already exists — the candidate was linked as a duplicate.";
    }
    case "reject":
      await rejectCandidate(db, actor, id, body.reason ?? "");
      return "Candidate rejected (kept for the record).";
    case "link-duplicate":
      await linkCandidateDuplicate(db, actor, id, body.studyId ?? "");
      return "Candidate linked as a duplicate.";
    case "correct":
      await correctCandidate(db, actor, id, {
        field: body.field ?? "",
        proposedValue: body.proposedValue ?? "",
        reason: emptyToNull(body.reason),
      });
      return "Correction proposed.";
    case "refetch":
      await requestCandidateRefetch(db, actor, id);
      return "Refetch requested (the discovery orchestrator will re-fetch; no fetch was performed here).";
    case "defer":
      await deferCandidate(db, actor, id, emptyToNull(body.note));
      return "Candidate deferred (still in the queue).";
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

function emptyToNull(value: string | undefined): string | null {
  const t = value?.trim();
  return t && t.length > 0 ? t : null;
}
