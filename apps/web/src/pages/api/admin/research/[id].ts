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
  getSuggestionOutput,
  recordSuggestionDecision,
  type Actor,
  type SqlExecutor,
  type OutcomeValue,
  type ConfidenceLevel,
  type CriticismCategory,
  type CriticismOrigin,
} from "@wise-evidence/database";
import { parseBody, backWithMessage, errorResponse } from "../../../../lib/http.js";
import { asService, isDatabaseConfigured } from "../../../../lib/db.js";
import { runEnrichment } from "../../../../lib/ai.js";

export const prerender = false;

export const POST: APIRoute = async ({ request, params, locals }) => {
  const id = params.id ?? "";
  const back = `/admin/research/${id}`;
  const actor = locals.actor;
  if (!actor) return backWithMessage(back, "error", "Not authorized.");
  if (!isDatabaseConfigured) return backWithMessage(back, "error", "Database is not configured.");

  const body = await parseBody(request);
  const op = body.op ?? "";

  // AI enrichment manages its own service-context + provider (docs/29 §7); it
  // never writes canonical data. Handle it before the canonical dispatch.
  if (op === "ai-enrich") {
    try {
      const result = await runEnrichment(actor, id, body.task ?? "");
      return backWithMessage(back, result.ok ? "ok" : "error", result.message);
    } catch (error) {
      return errorResponse(error);
    }
  }

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
    case "ai-accept":
      await acceptOrEditSuggestion(db, actor, id, body);
      return;
    case "ai-reject":
      await rejectSuggestion(db, actor, id, body);
      return;
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

/**
 * Accept or edit an AI suggestion (docs/29 §22). The human writes the canonical
 * value through the SAME service op used for manual entry, carrying the
 * ai_result_id as provenance; ACCEPT vs EDIT is derived by comparing the
 * submitted value to the AI's suggested value. AI never writes the value — the
 * human (this staff actor) does.
 */
async function acceptOrEditSuggestion(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  body: Record<string, string>,
): Promise<void> {
  const resultId = body.resultId ?? "";
  const suggestion = await getSuggestionOutput(db, resultId);
  if (!suggestion || suggestion.studyId !== studyId) {
    throw new Error("suggestion not found for this study");
  }
  if (suggestion.validationStatus !== "VALID") {
    throw new Error("cannot accept an invalid AI suggestion");
  }
  const out = suggestion.output as Record<string, unknown>;

  switch (suggestion.operation) {
    case "outcome-classification": {
      const value = body.value as OutcomeValue;
      await setOutcome(db, actor, studyId, value, null, emptyToNull(body.explanation), resultId);
      await decide(db, actor, resultId, studyId, suggestion.operation, value === out.outcome);
      return;
    }
    case "evidence-quality": {
      const value = body.value as "HIGH" | "MODERATE" | "LOW" | "UNCLEAR";
      await setQualitySummary(db, actor, studyId, value, emptyToNull(body.explanation), resultId);
      await decide(db, actor, resultId, studyId, suggestion.operation, value === out.quality);
      return;
    }
    case "criticism-extraction": {
      const category = body.category as CriticismCategory;
      const text = body.value ?? "";
      await addCriticism(db, actor, studyId, {
        category,
        origin: "AI_SUGGESTED" as CriticismOrigin,
        text,
        aiResultId: resultId,
      });
      const items = Array.isArray(out.criticisms)
        ? (out.criticisms as Record<string, unknown>[])
        : [];
      const matched = items.some(
        (i) => i.category === category && String(i.text ?? "").trim() === text.trim(),
      );
      await decide(db, actor, resultId, studyId, suggestion.operation, matched);
      return;
    }
    case "research-summary": {
      // human_summary has no ai_result_id FK; provenance is the audit decision.
      await updateStudyIdentity(db, actor, studyId, { summary: body.value ?? "" });
      await decide(
        db,
        actor,
        resultId,
        studyId,
        suggestion.operation,
        String(body.value ?? "").trim() === String(out.summary ?? "").trim(),
      );
      return;
    }
    case "metadata-extraction": {
      await updateStudyIdentity(db, actor, studyId, {
        subjectType: emptyToNull(body.subjectType) ?? undefined,
        studyTypeCode: emptyToNull(body.studyTypeCode),
      });
      await decide(db, actor, resultId, studyId, suggestion.operation, true);
      return;
    }
    default:
      throw new Error(`cannot accept suggestion for operation: ${suggestion.operation}`);
  }
}

/** Reject an AI suggestion: record the decision only; nothing becomes canonical. */
async function rejectSuggestion(
  db: SqlExecutor,
  actor: Actor,
  studyId: string,
  body: Record<string, string>,
): Promise<void> {
  const resultId = body.resultId ?? "";
  const suggestion = await getSuggestionOutput(db, resultId);
  if (!suggestion || suggestion.studyId !== studyId) {
    throw new Error("suggestion not found for this study");
  }
  await recordSuggestionDecision(db, actor, {
    resultId,
    studyId,
    task: suggestion.operation,
    decision: "REJECT",
    note: emptyToNull(body.reason),
  });
}

function decide(
  db: SqlExecutor,
  actor: Actor,
  resultId: string,
  studyId: string,
  task: string,
  accepted: boolean,
): Promise<void> {
  return recordSuggestionDecision(db, actor, {
    resultId,
    studyId,
    task,
    decision: accepted ? "ACCEPT" : "EDIT",
  });
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
  "ai-accept": "AI suggestion applied to the canonical value",
  "ai-reject": "AI suggestion rejected",
};

const REDIRECT_TO_LIST = new Set(["publish", "reject", "archive"]);

function emptyToNull(value: string | undefined): string | null {
  const t = value?.trim();
  return t && t.length > 0 ? t : null;
}
