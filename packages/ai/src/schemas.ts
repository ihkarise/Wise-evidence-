/**
 * Structured-output validation (docs/10 §6, ADR-016 §3). Raw model output is
 * NEVER trusted: every task validates JSON shape, enum/taxonomy membership,
 * required fields, confidence range, and length caps before a suggestion may be
 * persisted. Malformed output yields `{ ok: false }` → the job is marked FAILED
 * and surfaced for manual review; nothing is silently coerced.
 */
import type { AIConfidence, AISuggestion, AITask, CriticismItem } from './types.js';

export type ValidationResult = { ok: true; suggestion: AISuggestion } | { ok: false; message: string };

const CONFIDENCES: AIConfidence[] = ['LOW', 'MODERATE', 'HIGH'];
const SUMMARY_CAP = 2000;
const RATIONALE_CAP = 1000;
const NOTE_CAP = 600;
const MAX_CRITICISM_ITEMS = 12;

/** Criticism categories mirror the criticism_category enum (docs/09, migration 0001). */
export const CRITICISM_CATEGORIES = [
  'METHODOLOGY',
  'RANDOMIZATION',
  'BLINDING',
  'SAMPLE_SIZE',
  'STATISTICS',
  'CONTROLS',
  'REPLICATION',
  'PUBLICATION_BIAS',
  'REPORTING',
  'INTERPRETATION',
  'GENERALIZABILITY',
  'OTHER',
] as const;

function asObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function readConfidence(v: unknown): AIConfidence | null {
  if (typeof v !== 'string') return null;
  const up = v.toUpperCase();
  return (CONFIDENCES as string[]).includes(up) ? (up as AIConfidence) : null;
}

function readString(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, cap);
  return t === '' ? null : t;
}

/**
 * Validate raw provider output for `task`. `allowedValues` (taxonomy/enum codes)
 * is required for the four classification tasks; membership is enforced.
 */
export function validateOutput(task: AITask, raw: unknown, allowedValues: string[] = []): ValidationResult {
  const obj = asObject(raw);
  if (!obj) return { ok: false, message: 'Output was not a JSON object.' };
  const confidence = readConfidence(obj.confidence);
  const rationale = readString(obj.rationale, RATIONALE_CAP);

  if (task === 'summary') {
    const summary = readString(obj.summary, SUMMARY_CAP);
    if (!summary) return { ok: false, message: 'summary is missing or empty.' };
    return { ok: true, suggestion: { task, suggestedValue: summary, output: { summary }, confidence, rationale } };
  }

  if (task === 'criticism') {
    const rawItems = Array.isArray(obj.items) ? obj.items : null;
    if (!rawItems) return { ok: false, message: 'items must be an array.' };
    const items: CriticismItem[] = [];
    for (const it of rawItems.slice(0, MAX_CRITICISM_ITEMS)) {
      const io = asObject(it);
      if (!io) continue;
      const category = typeof io.category === 'string' ? io.category.toUpperCase() : '';
      const note = readString(io.note, NOTE_CAP);
      if (!(CRITICISM_CATEGORIES as readonly string[]).includes(category)) continue;
      if (!note) continue;
      items.push({ category, note });
    }
    // An empty list is valid (the model found no criticism) but carries no value.
    return { ok: true, suggestion: { task, suggestedValue: null, output: { items }, confidence, rationale } };
  }

  // Classification tasks: study-type | evidence-level | outcome | quality.
  const value = typeof obj.value === 'string' ? obj.value.trim() : '';
  if (!value) return { ok: false, message: 'value is missing.' };
  if (allowedValues.length > 0 && !allowedValues.includes(value)) {
    return { ok: false, message: `value "${value}" is not in the allowed set.` };
  }
  return { ok: true, suggestion: { task, suggestedValue: value, output: { value }, confidence, rationale } };
}
