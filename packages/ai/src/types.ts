/**
 * Provider-neutral AI enrichment contract (docs/10, ADR-016).
 *
 * Nothing here imports a provider SDK; `packages/domain` stays provider-free and
 * this package never writes to the database. Every result is a *suggestion* —
 * it becomes canonical only when a human accepts it in the review workflow
 * (`AI ≠ Final Authority`, docs/00 §3).
 */

/** The six staff-triggered enrichment tasks exposed in the editor (ADR-016). */
export type AITask = 'summary' | 'study-type' | 'evidence-level' | 'outcome' | 'quality' | 'criticism';

export const AI_TASKS: readonly AITask[] = [
  'summary',
  'study-type',
  'evidence-level',
  'outcome',
  'quality',
  'criticism',
] as const;

/** Map each task to its `ai_operation` enum value (provenance + cache keying). */
export const TASK_OPERATION: Record<AITask, string> = {
  summary: 'SUMMARIZE',
  'study-type': 'CLASSIFY_STUDY_TYPE',
  'evidence-level': 'CLASSIFY_EVIDENCE_LEVEL',
  outcome: 'CLASSIFY_OUTCOME',
  quality: 'ASSESS_QUALITY',
  criticism: 'EXTRACT_CRITICISM',
};

/** Classification dimension a task maps onto in the editor, if any (summary/criticism have none). */
export const TASK_DIMENSION: Partial<Record<AITask, string>> = {
  'study-type': 'STUDY_TYPE',
  'evidence-level': 'EVIDENCE_LEVEL',
  outcome: 'OUTCOME',
  quality: 'QUALITY',
};

/** The model's self-reported certainty. NOT the human CONFIDENCE dimension (ADR-016 §7). */
export type AIConfidence = 'LOW' | 'MODERATE' | 'HIGH';

/**
 * Study fields used to build an AI request. Built ONLY from data already held;
 * full-paper text is never included (copyright, docs/17 §5). All values are
 * untrusted content and are delimiter-wrapped before reaching a model.
 */
export interface StudyInput {
  title: string;
  summary: string | null;
  studyType: string | null;
  subject: string | null;
  journal: string | null;
  year: string | null;
  abstract: string | null;
}

/** One item of extracted criticism (task = 'criticism'). */
export interface CriticismItem {
  category: string;
  note: string;
}

/** A request handed to a provider. `allowedValues` constrains classification tasks. */
export interface AIEnrichmentRequest {
  task: AITask;
  input: StudyInput;
  /** Valid enum/taxonomy values for classification tasks (from the DB). */
  allowedValues?: string[];
}

/**
 * A validated suggestion, ready to persist as an `ai_result`. `output` is the
 * full structured object; `suggestedValue` is the single convenience value for
 * classification tasks (null for multi-item criticism).
 */
export interface AISuggestion {
  task: AITask;
  suggestedValue: string | null;
  output: unknown;
  confidence: AIConfidence | null;
  rationale: string | null;
}

export type AIErrorCode =
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_OUTPUT'
  | 'UNSUPPORTED_TASK'
  | 'NOT_CONFIGURED';

/** Provider-reported token usage for one call (null fields where unavailable). */
export interface AIUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/** Raw provider output before validation — a parsed JSON object or an error. */
export type AIProviderResult =
  | { ok: true; raw: unknown; usage?: AIUsage | null; costEstimate?: number | null }
  | { ok: false; error: AIErrorCode; message: string };

/** A swappable provider. Selected by configuration; never imported into the domain. */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  /** Return raw structured output for the task; validation happens centrally. */
  enrich(req: AIEnrichmentRequest): Promise<AIProviderResult>;
}
