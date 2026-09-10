/**
 * Discovery candidate review service (M7.4B; docs/30 §11, ADR-020).
 *
 * The HUMAN review workflow for automated-discovery `import_candidate` rows. It
 * turns a reviewable candidate into the START of the EXISTING manual research
 * lifecycle — never a finished, classified, or published record. Every mutation
 * runs on the narrow `SqlExecutor` boundary shared by the PGlite tests and the
 * Astro server, re-checks the actor's DB-backed staff role (defense in depth on
 * top of RLS), and writes an append-only `audit_log` entry.
 *
 * LOCKED boundaries (test-covered):
 *   - ACCEPT creates only a DRAFT / IMPORTED research record through the existing
 *     `createDraftFromMetadata` op. It NEVER publishes, NEVER classifies (outcome
 *     / quality / confidence / evidence level), and NEVER calls AI.
 *   - Candidates are never deleted — reject/link/defer are state changes with an
 *     audit trail; duplicates stay reviewable.
 *   - The actor's role, the target study id, and every lifecycle/publication value
 *     are resolved SERVER-SIDE; nothing is trusted from the client.
 *   - Provenance is preserved: accept reuses the SAME discovery `research_source`
 *     (via `sourceName`), the candidate's `source_stable_id` (the canonical DOI)
 *     equals the created study's `research_identifier.value_canonical`, and the
 *     accept is recorded in `audit_log` — so the chain
 *       source → import_job → import_candidate → research_study/publication
 *     is fully traceable WITHOUT a new column or migration.
 *
 * Framework-independent: imports only local modules; no Astro/React/Supabase/AI.
 */
import { toCanonicalDoi } from "@wise-evidence/domain";
import { type Actor, type SqlExecutor, ServiceError, requireStaff } from "../executor.js";
import { createDraftFromMetadata, findStudyByDoi } from "./research.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * States a candidate can be reviewed from. Discovery persists NEW candidates as
 * REVIEW_REQUIRED and dedup matches as DUPLICATE_CANDIDATE; both are actionable.
 * IMPORTED and FAILED are terminal (an accepted or rejected candidate).
 */
const ACTIONABLE_STATES = new Set(["REVIEW_REQUIRED", "DUPLICATE_CANDIDATE"]);

// --- shapes ------------------------------------------------------------------

/** A safe, sanitized view of a candidate's normalized discovery payload. */
export interface CandidatePayloadView {
  readonly canonicalDoi: string | null;
  readonly title: string | null;
  readonly authors: readonly string[];
  readonly journal: string | null;
  readonly publicationDate: string | null;
  readonly abstract: string | null;
  readonly url: string | null;
  readonly identifiers: readonly { readonly type: string; readonly value: string }[];
  readonly provenance: {
    readonly sourceKey: string | null;
    readonly sourceId: string | null;
    readonly sourceUrl: string | null;
    readonly doi: string | null;
    readonly discoveredAt: string | null;
    readonly fetchedAt: string | null;
    readonly providerVersion: string | null;
    readonly rawHash: string | null;
  } | null;
}

/** One row in the candidate review list. */
export interface CandidateListItem {
  readonly id: string;
  readonly sourceKey: string | null;
  readonly sourceStableId: string | null;
  readonly state: string;
  readonly title: string | null;
  readonly canonicalDoi: string | null;
  readonly dedupVerdict: string | null;
  readonly duplicateOfStudyId: string | null;
  readonly createdAt: string;
}

/** A proposed correction against a candidate (reuses the `correction` table). */
export interface CandidateCorrection {
  readonly id: string;
  readonly field: string | null;
  readonly proposedValue: string | null;
  readonly status: string;
  readonly reason: string | null;
  readonly createdAt: string;
}

/** Full detail for the candidate review page. */
export interface CandidateDetail {
  readonly id: string;
  readonly importJobId: string;
  readonly sourceKey: string | null;
  readonly sourceStableId: string | null;
  readonly state: string;
  readonly errorDetail: string | null;
  readonly dedupVerdict: string | null;
  readonly dedupMatchedBy: string | null;
  readonly dedupReason: string | null;
  readonly duplicateOfStudyId: string | null;
  readonly payload: CandidatePayloadView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly job: {
    readonly id: string;
    readonly sourceName: string | null;
    readonly trigger: string;
    readonly state: string;
    readonly startedAt: string | null;
  } | null;
  /** The existing canonical study this candidate's DOI resolves to, if any. */
  readonly linkedStudyId: string | null;
  readonly corrections: readonly CandidateCorrection[];
}

/** Result of accepting a candidate. */
export interface AcceptCandidateResult {
  readonly studyId: string;
  /** true when a new DRAFT study was created; false when an existing study owned the DOI. */
  readonly created: boolean;
}

interface CandidateRow {
  readonly id: string;
  readonly import_job_id: string;
  readonly source_key: string | null;
  readonly source_stable_id: string | null;
  readonly normalized_payload: unknown;
  readonly dedup_decision: string | null;
  readonly duplicate_of_study_id: string | null;
  readonly state: string;
  readonly error_detail: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// --- helpers -----------------------------------------------------------------

async function one<T>(db: SqlExecutor, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

async function writeAudit(
  db: SqlExecutor,
  actor: Actor,
  action: string,
  entityId: string,
  before: unknown,
  after: unknown,
  reason: string | null,
): Promise<void> {
  await db.query(
    `insert into audit_log (actor, action, entity, entity_id, before, after, reason)
     values ($1, $2, 'import_candidate', $3, $4, $5, $6)`,
    [
      actor.id,
      action,
      entityId,
      before === null || before === undefined ? null : JSON.stringify(before),
      after === null || after === undefined ? null : JSON.stringify(after),
      reason,
    ],
  );
}

/** Load a candidate and assert it is in a reviewable (actionable) state. */
async function loadActionable(db: SqlExecutor, id: string): Promise<CandidateRow> {
  if (!UUID_RE.test(id)) throw new ServiceError("invalid-input", "invalid candidate id");
  const row = await one<CandidateRow>(
    db,
    `select id, import_job_id, source_key, source_stable_id, normalized_payload,
            dedup_decision, duplicate_of_study_id, state, error_detail, created_at, updated_at
       from import_candidate where id = $1`,
    [id],
  );
  if (!row) throw new ServiceError("not-found", "candidate not found");
  if (!ACTIONABLE_STATES.has(row.state)) {
    throw new ServiceError("invalid-state", `candidate is not reviewable from state ${row.state}`);
  }
  return row;
}

/** Coerce a value to a trimmed non-empty string, else null. */
function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/** Coerce a value to an array of non-empty strings (source order preserved). */
function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const s = str(v);
    if (s !== null) out.push(s);
  }
  return out;
}

/**
 * Build a SAFE view of the untrusted normalized payload. Every field is coerced
 * defensively (never assumed to be the expected type) so a malformed row can
 * never crash the reader or smuggle a non-string into the UI. Discovery already
 * sanitized these as text; the UI additionally auto-escapes on render.
 */
function toPayloadView(raw: unknown): CandidatePayloadView | null {
  if (raw === null || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const provRaw = p.provenance;
  const prov =
    provRaw !== null && typeof provRaw === "object" ? (provRaw as Record<string, unknown>) : null;

  const identifiers: { type: string; value: string }[] = [];
  if (Array.isArray(p.identifiers)) {
    for (const item of p.identifiers) {
      if (item !== null && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const type = str(rec.type);
        const value = str(rec.value);
        if (type !== null && value !== null) identifiers.push({ type, value });
      }
    }
  }

  return {
    canonicalDoi: str(p.canonicalDoi),
    title: str(p.title),
    authors: strArray(p.authors),
    journal: str(p.journal),
    publicationDate: str(p.publicationDate),
    abstract: str(p.abstract),
    url: str(p.url),
    identifiers,
    provenance:
      prov === null
        ? null
        : {
            sourceKey: str(prov.sourceKey),
            sourceId: str(prov.sourceId),
            sourceUrl: str(prov.sourceUrl),
            doi: str(prov.doi),
            discoveredAt: str(prov.discoveredAt),
            fetchedAt: str(prov.fetchedAt),
            providerVersion: str(prov.providerVersion),
            rawHash: str(prov.rawHash),
          },
  };
}

function parseDedup(raw: string | null): {
  verdict: string | null;
  matchedBy: string | null;
  reason: string | null;
} {
  if (raw === null) return { verdict: null, matchedBy: null, reason: null };
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    return {
      verdict: str(d.verdict),
      matchedBy: str(d.matchedBy),
      reason: str(d.reason),
    };
  } catch {
    return { verdict: null, matchedBy: null, reason: null };
  }
}

// --- reads -------------------------------------------------------------------

/**
 * List discovery candidates for the review queue (staff only). Newest first.
 * Optionally filter by state; results are bounded by `limit`.
 */
export async function listCandidates(
  db: SqlExecutor,
  actor: Actor,
  opts: { readonly state?: string; readonly limit?: number; readonly offset?: number } = {},
): Promise<readonly CandidateListItem[]> {
  requireStaff(actor);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const state = opts.state && opts.state.length > 0 ? opts.state : null;

  const { rows } = await db.query<{
    id: string;
    source_key: string | null;
    source_stable_id: string | null;
    state: string;
    normalized_payload: unknown;
    dedup_decision: string | null;
    duplicate_of_study_id: string | null;
    created_at: string;
  }>(
    `select id, source_key, source_stable_id, state, normalized_payload,
            dedup_decision, duplicate_of_study_id, created_at
       from import_candidate
      where source_key is not null
        and ($1::text is null or state = $1::import_candidate_state)
      order by created_at desc, id
      limit $2 offset $3`,
    [state, limit, offset],
  );

  return rows.map((r) => {
    const payload = toPayloadView(r.normalized_payload);
    const dedup = parseDedup(r.dedup_decision);
    return {
      id: r.id,
      sourceKey: r.source_key,
      sourceStableId: r.source_stable_id,
      state: r.state,
      title: payload?.title ?? null,
      canonicalDoi: payload?.canonicalDoi ?? null,
      dedupVerdict: dedup.verdict,
      duplicateOfStudyId: r.duplicate_of_study_id,
      createdAt: r.created_at,
    };
  });
}

/** Full detail for one candidate (staff only). */
export async function getCandidateDetail(
  db: SqlExecutor,
  actor: Actor,
  id: string,
): Promise<CandidateDetail | null> {
  requireStaff(actor);
  if (!UUID_RE.test(id)) return null;

  const row = await one<CandidateRow>(
    db,
    `select id, import_job_id, source_key, source_stable_id, normalized_payload,
            dedup_decision, duplicate_of_study_id, state, error_detail, created_at, updated_at
       from import_candidate where id = $1`,
    [id],
  );
  if (!row) return null;

  const job = await one<{
    id: string;
    trigger: string;
    state: string;
    started_at: string | null;
    source_name: string | null;
  }>(
    db,
    `select j.id, j.trigger, j.state, j.started_at, s.name as source_name
       from import_job j
       left join research_source s on s.id = j.source_id
      where j.id = $1`,
    [row.import_job_id],
  );

  const payload = toPayloadView(row.normalized_payload);
  const dedup = parseDedup(row.dedup_decision);

  // Resolve any existing canonical study that already owns this candidate's DOI.
  // This is the queryable candidate → study link (no dedicated column needed).
  let linkedStudyId: string | null = null;
  if (payload?.canonicalDoi) {
    linkedStudyId = await findStudyByDoi(db, payload.canonicalDoi);
  }

  const corrections = await db.query<{
    id: string;
    field: string | null;
    proposed_value: string | null;
    status: string;
    reason: string | null;
    created_at: string;
  }>(
    `select id, field, proposed_value, status, reason, created_at
       from correction
      where target_type = 'import_candidate' and target_id = $1
      order by created_at desc`,
    [id],
  );

  return {
    id: row.id,
    importJobId: row.import_job_id,
    sourceKey: row.source_key,
    sourceStableId: row.source_stable_id,
    state: row.state,
    errorDetail: row.error_detail,
    dedupVerdict: dedup.verdict,
    dedupMatchedBy: dedup.matchedBy,
    dedupReason: dedup.reason,
    duplicateOfStudyId: row.duplicate_of_study_id,
    payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    job:
      job === null
        ? null
        : {
            id: job.id,
            sourceName: job.source_name,
            trigger: job.trigger,
            state: job.state,
            startedAt: job.started_at,
          },
    linkedStudyId,
    corrections: corrections.rows.map((c) => ({
      id: c.id,
      field: c.field,
      proposedValue: c.proposed_value,
      status: c.status,
      reason: c.reason,
      createdAt: c.created_at,
    })),
  };
}

// --- review actions ----------------------------------------------------------

/**
 * ACCEPT a candidate: create the START of the manual research lifecycle — a
 * DRAFT / IMPORTED research record via the existing `createDraftFromMetadata`
 * op — and mark the candidate IMPORTED. NEVER publishes, NEVER classifies, and
 * NEVER calls AI. The DOI, title, and all metadata come from the candidate's own
 * (server-side) normalized payload; nothing is taken from the client.
 *
 * If a study already owns this DOI, no new draft is created: the candidate is
 * linked to that study as a DUPLICATE_CANDIDATE (still reviewable) instead.
 */
export async function acceptCandidate(
  db: SqlExecutor,
  actor: Actor,
  id: string,
): Promise<AcceptCandidateResult> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  const payload = toPayloadView(cand.normalized_payload);

  const doi = payload?.canonicalDoi ?? null;
  if (doi === null || toCanonicalDoi(doi) === null) {
    throw new ServiceError(
      "invalid-input",
      "cannot accept a candidate without a valid DOI; use correct or link-duplicate instead",
    );
  }
  const title = payload?.title ?? null;
  if (title === null) {
    throw new ServiceError("invalid-input", "cannot accept a candidate without a title");
  }

  // Reuse the SAME discovery research_source so provenance is shared between the
  // import_job and the created publication.
  const sourceName = cand.source_key
    ? `Automated discovery (${cand.source_key})`
    : "Automated discovery";

  const result = await createDraftFromMetadata(db, actor, {
    doi,
    title,
    abstract: payload?.abstract ?? null,
    journalTitle: payload?.journal ?? null,
    publicationDate: payload?.publicationDate ?? null,
    sourceUrl: payload?.url ?? null,
    authors: payload?.authors ?? [],
    sourceName,
  });

  if (result.created) {
    await db.query("update import_candidate set state = 'IMPORTED' where id = $1", [id]);
    await writeAudit(
      db,
      actor,
      "candidate_accepted",
      id,
      { state: cand.state },
      {
        studyId: result.studyId,
        sourceKey: cand.source_key,
        sourceStableId: cand.source_stable_id,
      },
      null,
    );
    return { studyId: result.studyId, created: true };
  }

  // An existing study already owns this DOI — link, do not duplicate.
  await db.query(
    "update import_candidate set state = 'DUPLICATE_CANDIDATE', duplicate_of_study_id = $2 where id = $1",
    [id, result.studyId],
  );
  await writeAudit(
    db,
    actor,
    "candidate_accept_existing",
    id,
    { state: cand.state },
    { existingStudyId: result.studyId },
    "a study with this DOI already exists; linked as duplicate",
  );
  return { studyId: result.studyId, created: false };
}

/**
 * REJECT a candidate: a terminal FAILED state with the reason recorded. The row
 * is retained (never deleted) and remains readable by staff.
 */
export async function rejectCandidate(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  reason: string,
): Promise<void> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  const trimmed = reason.trim();
  await db.query("update import_candidate set state = 'FAILED', error_detail = $2 where id = $1", [
    id,
    trimmed.length > 0 ? trimmed : "rejected by reviewer",
  ]);
  await writeAudit(
    db,
    actor,
    "candidate_rejected",
    id,
    { state: cand.state },
    { state: "FAILED" },
    trimmed.length > 0 ? trimmed : null,
  );
}

/**
 * LINK DUPLICATE: mark the candidate a duplicate of an existing study. The study
 * id is validated SERVER-SIDE (never trusted from the client). The candidate is
 * kept and stays reviewable (DUPLICATE_CANDIDATE); nothing is merged or deleted.
 */
export async function linkCandidateDuplicate(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  studyId: string,
): Promise<void> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  if (!UUID_RE.test(studyId)) {
    throw new ServiceError("invalid-input", "invalid study id");
  }
  const study = await one<{ id: string }>(db, "select id from research_study where id = $1", [
    studyId,
  ]);
  if (!study) throw new ServiceError("not-found", "target study not found");

  await db.query(
    "update import_candidate set state = 'DUPLICATE_CANDIDATE', duplicate_of_study_id = $2 where id = $1",
    [id, studyId],
  );
  await writeAudit(
    db,
    actor,
    "candidate_linked_duplicate",
    id,
    { state: cand.state, duplicateOfStudyId: cand.duplicate_of_study_id },
    { duplicateOfStudyId: studyId },
    null,
  );
}

/**
 * CORRECT: propose a metadata correction against the candidate. This reuses the
 * existing `correction` table (target_type='import_candidate') and audit model —
 * it does NOT mutate the candidate's normalized payload, so discovery provenance
 * is preserved and the correction is itself reviewable.
 */
export async function correctCandidate(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  input: {
    readonly field: string;
    readonly proposedValue: string;
    readonly reason?: string | null;
  },
): Promise<{ readonly correctionId: string }> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  const field = input.field.trim();
  const proposed = input.proposedValue.trim();
  if (field.length === 0) throw new ServiceError("invalid-input", "a field is required");
  if (proposed.length === 0)
    throw new ServiceError("invalid-input", "a proposed value is required");

  const row = await one<{ id: string }>(
    db,
    `insert into correction (target_type, target_id, field, proposed_value, submitter, status, reason)
     values ('import_candidate', $1, $2, $3, $4, 'OPEN', $5) returning id`,
    [id, field, proposed, actor.id, input.reason?.trim() || null],
  );
  if (!row) throw new ServiceError("invalid-input", "failed to record correction");

  await writeAudit(
    db,
    actor,
    "candidate_correction_proposed",
    id,
    null,
    { field, correctionId: row.id, candidateState: cand.state },
    input.reason?.trim() || null,
  );
  return { correctionId: row.id };
}

/**
 * REFETCH (request only): record that a reviewer asked for the candidate to be
 * re-fetched. M7.4B performs NO network I/O — the actual, bounded, host-pinned
 * re-fetch is the discovery orchestrator's job (M7.2/M7.3). This never fetches an
 * arbitrary URL from the review path; it only leaves an auditable request.
 */
export async function requestCandidateRefetch(
  db: SqlExecutor,
  actor: Actor,
  id: string,
): Promise<void> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  await writeAudit(
    db,
    actor,
    "candidate_refetch_requested",
    id,
    null,
    { sourceKey: cand.source_key, sourceStableId: cand.source_stable_id },
    null,
  );
}

/**
 * DEFER: leave the candidate reviewable and record that a reviewer deferred a
 * decision. State is unchanged (it stays in the queue); only an audit note is
 * written.
 */
export async function deferCandidate(
  db: SqlExecutor,
  actor: Actor,
  id: string,
  note?: string | null,
): Promise<void> {
  requireStaff(actor);
  const cand = await loadActionable(db, id);
  await writeAudit(
    db,
    actor,
    "candidate_deferred",
    id,
    null,
    { state: cand.state },
    note?.trim() || null,
  );
}
