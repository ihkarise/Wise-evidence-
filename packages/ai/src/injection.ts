/**
 * Prompt-injection defense (docs/10 §12, docs/16). Research titles, summaries,
 * and abstracts are UNTRUSTED data: they must never be able to override system
 * instructions. We wrap every untrusted field in an explicit delimited block and
 * strip control characters + any lines that try to mimic our delimiters or issue
 * instructions. The model is told (in the prompt files) to treat everything in
 * the block strictly as data to classify, not as commands.
 */
import type { StudyInput } from './types.js';

// Control characters (C0 range + DEL) EXCEPT the line feed U+000A, which we keep
// so per-line defusing (fences, role prefixes) can anchor. Built from escape
// sequences so no literal control byte appears in source; matching them is the
// intent, so the lint rule for control regexes is disabled here.
// eslint-disable-next-line no-control-regex
const CONTROL_EXCEPT_LF = new RegExp('[\\u0000-\\u0009\\u000B-\\u001F\\u007F]', 'g');

/** Opening/closing fences for untrusted content. Chosen to be implausible in prose. */
export const DATA_OPEN = '<<<UNTRUSTED_RESEARCH_DATA';
export const DATA_CLOSE = 'UNTRUSTED_RESEARCH_DATA>>>';

const FIELD_CAP = 4000;

/** Neutralize a single untrusted value: strip control chars, collapse space, cap, defuse fences. */
export function sanitizeField(value: string | null | undefined, cap = FIELD_CAP): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_LF, ' ')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    // Defuse any line trying to reproduce our fences or impersonate the system.
    .map((line) =>
      line.replaceAll(DATA_OPEN, '[data]').replaceAll(DATA_CLOSE, '[data]').replace(/^(system|assistant|developer)\s*:/i, '$1 -')
    )
    .filter((line) => line.length > 0)
    .join('\n')
    .slice(0, cap);
}

/**
 * Render the study input as a single delimited, untrusted block. Field labels are
 * our trusted text; only the values come from untrusted sources and are sanitized.
 */
export function renderUntrustedInput(input: StudyInput): string {
  const rows: string[] = [];
  const add = (label: string, v: string | null): void => {
    const clean = sanitizeField(v);
    if (clean) rows.push(`${label}: ${clean}`);
  };
  add('title', input.title);
  add('human_summary', input.summary);
  add('study_type', input.studyType);
  add('subject', input.subject);
  add('journal', input.journal);
  add('year', input.year);
  add('abstract', input.abstract);
  return `${DATA_OPEN}\n${rows.join('\n')}\n${DATA_CLOSE}`;
}
