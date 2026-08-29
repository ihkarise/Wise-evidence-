/**
 * Structured-output validation for the six AI tasks (docs/29 §11).
 *
 * Model output is UNTRUSTED. Nothing is trusted merely because it is valid JSON:
 * every response is parsed and validated against a per-task schema before it can
 * be persisted as VALID. The validator rejects malformed JSON, unexpected/extra
 * fields, wrong types, invalid enum values, oversized strings/payloads, invalid
 * confidence, and any DOI-shaped fabrication (no task schema contains a DOI or
 * citation field, so a fabricated identifier is an "unexpected field" by
 * construction).
 *
 * The canonical vocabularies come from `@wise-evidence/database` (the single
 * source of truth mirroring the SQL enums) so an AI suggestion can never carry a
 * value the human classification path would reject. This module is pure: no
 * network, no provider, no DB I/O.
 */
import {
  OUTCOME_VALUES,
  QUALITY_SUMMARIES,
  CRITICISM_CATEGORIES,
  SUBJECT_TYPES,
  type OutcomeValue,
  type QualitySummary,
  type CriticismCategory,
  type SubjectType,
} from "@wise-evidence/database";
import { AI_LIMITS, type AITaskId } from "./types.js";

// --- validated output shapes -------------------------------------------------

export interface SummaryOutput {
  readonly summary: string;
  readonly confidence?: number;
}
export interface OutcomeOutput {
  readonly outcome: OutcomeValue;
  readonly confidence: number;
  readonly rationale?: string;
}
export interface QualityOutput {
  readonly quality: QualitySummary;
  readonly confidence: number;
  readonly rationale?: string;
}
export interface CriticismItem {
  readonly category: CriticismCategory;
  readonly text: string;
  readonly confidence?: number;
}
export interface CriticismOutput {
  readonly criticisms: readonly CriticismItem[];
}
export interface MetadataOutput {
  readonly studyTypeCode?: string | null;
  readonly subjectType?: SubjectType | null;
  readonly confidence?: number;
}
export interface DuplicateItem {
  readonly candidateId: string;
  readonly score: number;
  readonly reason?: string;
}
export interface DuplicateOutput {
  readonly duplicates: readonly DuplicateItem[];
}

export type AITaskOutput =
  | { task: "research-summary"; output: SummaryOutput }
  | { task: "outcome-classification"; output: OutcomeOutput }
  | { task: "evidence-quality"; output: QualityOutput }
  | { task: "criticism-extraction"; output: CriticismOutput }
  | { task: "metadata-extraction"; output: MetadataOutput }
  | { task: "duplicate-detection"; output: DuplicateOutput };

/**
 * The result of validating a raw model completion. On success it carries the
 * validated, schema-conformant output and the overall AI confidence (or null
 * when the task has none at the top level). On failure it carries a safe,
 * non-secret reason for the review record and UI.
 */
export type ValidationResult =
  | {
      readonly ok: true;
      readonly task: AITaskId;
      readonly output: AITaskOutput["output"];
      readonly confidence: number | null;
    }
  | { readonly ok: false; readonly error: string };

// --- entry point -------------------------------------------------------------

/** Parse + validate raw model output for `task`. Never throws. */
export function validateTaskOutput(task: AITaskId, rawText: string): ValidationResult {
  if (rawText.length > AI_LIMITS.maxOutputChars) {
    return fail(`output too large (${rawText.length} > ${AI_LIMITS.maxOutputChars} chars)`);
  }
  const parsed = parseJsonObject(rawText);
  if (parsed === null) {
    return fail("output was not a single JSON object");
  }
  switch (task) {
    case "research-summary":
      return validateSummary(parsed);
    case "outcome-classification":
      return validateOutcome(parsed);
    case "evidence-quality":
      return validateQuality(parsed);
    case "criticism-extraction":
      return validateCriticism(parsed);
    case "metadata-extraction":
      return validateMetadata(parsed);
    case "duplicate-detection":
      return validateDuplicate(parsed);
    default:
      return fail(`unknown task: ${String(task)}`);
  }
}

// --- per-task validators -----------------------------------------------------

function validateSummary(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["summary", "confidence"]);
  if (extra) return fail(extra);
  const summary = requireBoundedString(o.summary, "summary");
  if (typeof summary !== "string") return fail(summary.error);
  const confidence = optionalConfidence(o.confidence);
  if (confidence.ok === false) return fail(confidence.error);
  const output: SummaryOutput =
    confidence.value === null ? { summary } : { summary, confidence: confidence.value };
  return okResult("research-summary", output, confidence.value);
}

function validateOutcome(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["outcome", "confidence", "rationale"]);
  if (extra) return fail(extra);
  if (!isEnum(o.outcome, OUTCOME_VALUES)) return fail("invalid outcome value");
  const confidence = requiredConfidence(o.confidence);
  if (confidence.ok === false) return fail(confidence.error);
  const rationale = optionalBoundedString(o.rationale, "rationale");
  if (rationale.ok === false) return fail(rationale.error);
  const output: OutcomeOutput = {
    outcome: o.outcome as OutcomeValue,
    confidence: confidence.value,
    ...(rationale.value !== null ? { rationale: rationale.value } : {}),
  };
  return okResult("outcome-classification", output, confidence.value);
}

function validateQuality(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["quality", "confidence", "rationale"]);
  if (extra) return fail(extra);
  if (!isEnum(o.quality, QUALITY_SUMMARIES)) return fail("invalid quality value");
  const confidence = requiredConfidence(o.confidence);
  if (confidence.ok === false) return fail(confidence.error);
  const rationale = optionalBoundedString(o.rationale, "rationale");
  if (rationale.ok === false) return fail(rationale.error);
  const output: QualityOutput = {
    quality: o.quality as QualitySummary,
    confidence: confidence.value,
    ...(rationale.value !== null ? { rationale: rationale.value } : {}),
  };
  return okResult("evidence-quality", output, confidence.value);
}

function validateCriticism(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["criticisms"]);
  if (extra) return fail(extra);
  if (!Array.isArray(o.criticisms)) return fail("criticisms must be an array");
  if (o.criticisms.length > AI_LIMITS.maxOutputItems) return fail("too many criticisms");
  const items: CriticismItem[] = [];
  for (const raw of o.criticisms) {
    if (!isPlainObject(raw)) return fail("each criticism must be an object");
    const extraItem = extraKeys(raw, ["category", "text", "confidence"]);
    if (extraItem) return fail(extraItem);
    if (!isEnum(raw.category, CRITICISM_CATEGORIES)) return fail("invalid criticism category");
    const text = requireBoundedString(raw.text, "criticism text");
    if (typeof text !== "string") return fail(text.error);
    const confidence = optionalConfidence(raw.confidence);
    if (confidence.ok === false) return fail(confidence.error);
    items.push({
      category: raw.category as CriticismCategory,
      text,
      ...(confidence.value !== null ? { confidence: confidence.value } : {}),
    });
  }
  return okResult("criticism-extraction", { criticisms: items }, null);
}

function validateMetadata(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["studyTypeCode", "subjectType", "confidence"]);
  if (extra) return fail(extra);
  let studyTypeCode: string | null = null;
  if (o.studyTypeCode !== undefined && o.studyTypeCode !== null) {
    // Shape only — existence against the study_type table is re-checked on the
    // canonical accept path (updateStudyIdentity throws on an unknown code).
    if (typeof o.studyTypeCode !== "string" || !/^[a-z0-9-]{1,64}$/.test(o.studyTypeCode)) {
      return fail("invalid studyTypeCode format");
    }
    studyTypeCode = o.studyTypeCode;
  }
  let subjectType: SubjectType | null = null;
  if (o.subjectType !== undefined && o.subjectType !== null) {
    if (!isEnum(o.subjectType, SUBJECT_TYPES)) return fail("invalid subjectType");
    subjectType = o.subjectType as SubjectType;
  }
  const confidence = optionalConfidence(o.confidence);
  if (confidence.ok === false) return fail(confidence.error);
  const output: MetadataOutput = {
    studyTypeCode,
    subjectType,
    ...(confidence.value !== null ? { confidence: confidence.value } : {}),
  };
  return okResult("metadata-extraction", output, confidence.value);
}

function validateDuplicate(o: Record<string, unknown>): ValidationResult {
  const extra = extraKeys(o, ["duplicates"]);
  if (extra) return fail(extra);
  if (!Array.isArray(o.duplicates)) return fail("duplicates must be an array");
  if (o.duplicates.length > AI_LIMITS.maxOutputItems) return fail("too many duplicate candidates");
  const items: DuplicateItem[] = [];
  for (const raw of o.duplicates) {
    if (!isPlainObject(raw)) return fail("each duplicate must be an object");
    const extraItem = extraKeys(raw, ["candidateId", "score", "reason"]);
    if (extraItem) return fail(extraItem);
    if (typeof raw.candidateId !== "string" || !isUuid(raw.candidateId)) {
      return fail("invalid duplicate candidateId");
    }
    const score = requiredConfidence(raw.score);
    if (score.ok === false) return fail(`invalid duplicate score: ${score.error}`);
    const reason = optionalBoundedString(raw.reason, "reason");
    if (reason.ok === false) return fail(reason.error);
    items.push({
      candidateId: raw.candidateId,
      score: score.value,
      ...(reason.value !== null ? { reason: reason.value } : {}),
    });
  }
  return okResult("duplicate-detection", { duplicates: items }, null);
}

// --- primitives --------------------------------------------------------------

function okResult(
  task: AITaskId,
  output: AITaskOutput["output"],
  confidence: number | null,
): ValidationResult {
  return { ok: true, task, output, confidence };
}
function fail(error: string): ValidationResult {
  return { ok: false, error };
}

/**
 * Parse the raw text as a single JSON object. Tolerates one surrounding Markdown
 * code fence (```json ... ```), then requires a plain object — nothing else is
 * scraped out of prose.
 */
function parseJsonObject(rawText: string): Record<string, unknown> | null {
  let text = rawText.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence && fence[1] !== undefined) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return isPlainObject(parsed) ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEnum<T extends readonly string[]>(value: unknown, vocab: T): value is T[number] {
  return typeof value === "string" && (vocab as readonly string[]).includes(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extraKeys(o: Record<string, unknown>, allowed: string[]): string | null {
  const allow = new Set(allowed);
  for (const key of Object.keys(o)) {
    if (!allow.has(key)) return `unexpected field: ${key}`;
  }
  return null;
}

/** Require a non-empty, bounded string. Returns the string, or a {error}. */
function requireBoundedString(value: unknown, label: string): string | { error: string } {
  if (typeof value !== "string") return { error: `${label} must be a string` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { error: `${label} must not be empty` };
  if (trimmed.length > AI_LIMITS.maxOutputStringChars) return { error: `${label} too long` };
  return trimmed;
}

function optionalBoundedString(
  value: unknown,
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const result = requireBoundedString(value, label);
  return typeof result === "string"
    ? { ok: true, value: result }
    : { ok: false, error: result.error };
}

function requiredConfidence(
  value: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: "confidence must be a number" };
  }
  if (value < 0 || value > 1) return { ok: false, error: "confidence out of range [0,1]" };
  return { ok: true, value };
}

function optionalConfidence(
  value: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  const result = requiredConfidence(value);
  return result.ok ? { ok: true, value: result.value } : result;
}
