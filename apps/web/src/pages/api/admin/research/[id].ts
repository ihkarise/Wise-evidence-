/**
 * Research editor + workflow operations (docs/26 §14-21). One POST endpoint that
 * dispatches on an `op` field so the editor's structured-control forms all post
 * here and redirect back. Every op runs through the tested service layer on the
 * privileged path; the actor's role is enforced by middleware and re-checked in
 * the service (admin-only ops fail closed for reviewers).
 */
import type { APIRoute } from "astro";
import {
  updateStudyIdentity,
  setOutcome,
  setQualitySummary,
  addCriticism,
  withdrawCriticism,
  linkCondition,
  linkIntervention,
  submitForReview,
  requestChanges,
  rejectStudy,
  approveAndPublish,
  archiveStudy,
  type Actor,
  type SqlExecutor,
  type OutcomeValue,
  type ConfidenceLevel,
  type CriticismCategory,
  type CriticismOrigin,
} from "@wise-evidence/database";
import { parseBody, backWithMessage, errorResponse } from "../../../../lib/http.js";
import { asService, isDatabaseConfigured } from "../../../../lib/db.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, params, locals }) => {
  const id = params.id ?? "";
  const back = `/admin/research/${id}`;
  const actor = locals.actor;
  if (!actor) return backWithMessage(back, "error", "Not authorized.");
  if (!isDatabaseConfigured) return backWithMessage(back, "error", "Database is not configured.");

  const body = await parseBody(request);
  const op = body.op ?? "";

  try {
    await asService((db) => dispatch(db, actor, id, op, body));
  } catch (error) {
    return errorResponse(error);
  }

  const okMessage = OK_MESSAGES[op] ?? "Saved";
  // Publish/archive/reject return to the listing; edits return to the editor.
  const dest = REDIRECT_TO_LIST.has(op) ? "/admin/review" : back;
  return backWithMessage(dest, "ok", okMessage);
};

async function dispatch(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  op: string,
  body: Record<string, string>,
): Promise<void> {
  switch (op) {
    case "identity":
      await updateStudyIdentity(db, actor, id, {
        title: body.title,
        studyTypeCode: emptyToNull(body.studyTypeCode),
        subjectType: body.subjectType || undefined,
        abstract: body.abstract ?? null,
        publicationDate: emptyToNull(body.publicationDate),
        journalTitle: emptyToNull(body.journalTitle),
        summary: body.summary ?? null,
      });
      return;
    case "outcome":
      await setOutcome(
        db,
        actor,
        id,
        body.outcome as OutcomeValue,
        (emptyToNull(body.confidence) as ConfidenceLevel | null) ?? null,
        emptyToNull(body.explanation),
      );
      return;
    case "quality":
      await setQualitySummary(
        db,
        actor,
        id,
        body.quality as "HIGH" | "MODERATE" | "LOW" | "UNCLEAR",
        emptyToNull(body.explanation),
      );
      return;
    case "criticism":
      await addCriticism(db, actor, id, {
        category: body.category as CriticismCategory,
        origin: body.origin as CriticismOrigin,
        text: body.text ?? "",
        sourceReference: emptyToNull(body.sourceReference),
        sourceUrl: emptyToNull(body.sourceUrl),
      });
      return;
    case "withdraw-criticism":
      await withdrawCriticism(db, actor, body.criticismId ?? "");
      return;
    case "link-condition":
      await linkCondition(db, actor, id, body.slug ?? "");
      return;
    case "link-intervention":
      await linkIntervention(db, actor, id, body.slug ?? "");
      return;
    case "submit":
      await submitForReview(db, actor, id);
      return;
    case "request-changes":
      await requestChanges(db, actor, id, body.reason ?? "Changes requested");
      return;
    case "reject":
      await rejectStudy(db, actor, id, body.reason ?? "Rejected");
      return;
    case "publish":
      await approveAndPublish(db, actor, id);
      return;
    case "archive":
      await archiveStudy(db, actor, id, body.reason ?? "Archived");
      return;
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

const OK_MESSAGES: Record<string, string> = {
  identity: "Identity saved",
  outcome: "Outcome saved",
  quality: "Quality saved",
  criticism: "Criticism added",
  "withdraw-criticism": "Criticism withdrawn",
  "link-condition": "Condition linked",
  "link-intervention": "Intervention linked",
  submit: "Submitted for review",
  "request-changes": "Sent back to draft",
  reject: "Rejected",
  publish: "Published",
  archive: "Archived",
};

const REDIRECT_TO_LIST = new Set(["publish", "reject", "archive"]);

function emptyToNull(value: string | undefined): string | null {
  const t = value?.trim();
  return t && t.length > 0 ? t : null;
}
