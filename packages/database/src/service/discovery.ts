/**
 * Discovery persistence adapter (M7.4A; docs/30 §10, migration 0013, ADR-020).
 *
 * This is the THIN database implementation of the M7.3 persistence ports
 * (`DiscoveryRunStore`, `CandidateStore`) and the read-only `KnownStudyIndex`.
 * It is responsible for PERSISTENCE ONLY — it holds no provider, pagination,
 * dedup, AI, or UI logic. The orchestrator (in `@wise-evidence/discovery`) drives
 * the run and calls these ports; this adapter maps them to `import_job` /
 * `import_candidate` and reads existing canonical studies for dedup.
 *
 * Boundaries (enforced by tests):
 *   - writes ONLY `import_job` / `import_candidate` (+ a provenance
 *     `research_source` row and append-only `audit_log`); it NEVER inserts
 *     `research_study` / `publication` / `classification`, never changes a
 *     publication/lifecycle state, and never publishes.
 *   - runs on the server-side privileged (`service_role`) path; the ports are
 *     never exposed to anon/browser code. `requireStaff` is defense-in-depth on
 *     top of RLS.
 *   - candidate idempotency is DB-enforced via the migration 0013 partial unique
 *     index on `(source_key, source_stable_id)`; the insert uses ON CONFLICT so
 *     the database — not an application check — is the final authority, and an
 *     existing candidate is preserved (never overwritten).
 *
 * Framework-independent: imports only `@wise-evidence/discovery` port types and
 * local modules; no Astro/React/Supabase-client/AI.
 */
import type {
  CandidateRecordInput,
  CandidateStore,
  CreateRunInput,
  DiscoveryRunStore,
  FinalizeRunInput,
  KnownStudyIndex,
} from "@wise-evidence/discovery";
import { type Actor, type SqlExecutor, ServiceError, requireStaff } from "../executor.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map a discovery identifier type to the SQL `identifier_type` enum, or null. */
function toIdentifierType(type: string): string | null {
  switch (type) {
    case "DOI":
    case "PMID":
    case "PMCID":
    case "URL":
      return type;
    case "EUROPE_PMC":
      return "EUROPEPMC";
    default:
      return null; // ARXIV / SOURCE_ID etc. are not canonical identifier types
  }
}

async function one<T>(db: SqlExecutor, sql: string, params: unknown[]): Promise<T | null> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Server-side (`service_role`) implementation of the discovery persistence ports.
 * Construct it with the privileged executor and the staff actor performing the
 * run; both `DiscoveryRunStore` and `CandidateStore` are satisfied.
 */
export class DatabaseDiscoveryStore implements DiscoveryRunStore, CandidateStore {
  readonly #db: SqlExecutor;
  readonly #actor: Actor;

  constructor(db: SqlExecutor, actor: Actor) {
    requireStaff(actor); // defense in depth: never a non-staff caller
    this.#db = db;
    this.#actor = actor;
  }

  async createRun(input: CreateRunInput): Promise<{ readonly runId: string }> {
    const sourceId = await this.#getOrCreateSource(input.sourceKey);
    const run = await one<{ id: string }>(
      this.#db,
      `insert into import_job (source_id, trigger, state, started_at)
       values ($1, $2, 'RUNNING', $3) returning id`,
      [sourceId, input.trigger, input.startedAt],
    );
    if (run === null) throw new ServiceError("invalid-input", "failed to create import_job");
    await this.#audit("discovery_run_started", "import_job", run.id, null, {
      sourceKey: input.sourceKey,
      trigger: input.trigger,
    });
    return { runId: run.id };
  }

  async finalizeRun(runId: string, input: FinalizeRunInput): Promise<void> {
    await this.#db.query(
      `update import_job
         set state = $2, counts = $3::jsonb, ended_at = $4, error_detail = $5
       where id = $1`,
      [runId, input.state, JSON.stringify(input.counters), input.endedAt, input.errorSummary],
    );
    await this.#audit("discovery_run_finalized", "import_job", runId, null, {
      state: input.state,
      counters: input.counters,
    });
  }

  async findCandidateByIdentity(
    sourceKey: string,
    stableSourceId: string,
  ): Promise<{ readonly candidateId: string } | null> {
    const row = await one<{ id: string }>(
      this.#db,
      `select id from import_candidate
        where source_key = $1 and source_stable_id = $2 limit 1`,
      [sourceKey, stableSourceId],
    );
    return row === null ? null : { candidateId: row.id };
  }

  async insertCandidate(
    record: CandidateRecordInput,
  ): Promise<{ readonly candidateId: string; readonly created: boolean }> {
    const duplicateOfStudyId =
      record.dedup.relatedStudyId !== null && UUID_RE.test(record.dedup.relatedStudyId)
        ? record.dedup.relatedStudyId
        : null;

    // DB-enforced idempotency: ON CONFLICT against the migration-0013 partial
    // unique index. `do nothing` preserves the existing candidate (never
    // overwrites its payload with a newer one).
    const inserted = await one<{ id: string }>(
      this.#db,
      `insert into import_candidate
         (import_job_id, source_key, source_stable_id, normalized_payload,
          dedup_decision, duplicate_of_study_id, state)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7)
       on conflict (source_key, source_stable_id)
         where source_key is not null and source_stable_id is not null
       do nothing
       returning id`,
      [
        record.runId,
        record.sourceKey,
        record.stableSourceId,
        JSON.stringify(record.normalizedPayload),
        JSON.stringify(record.dedup),
        duplicateOfStudyId,
        record.state,
      ],
    );

    if (inserted !== null) {
      await this.#audit("discovery_candidate_created", "import_candidate", inserted.id, null, {
        sourceKey: record.sourceKey,
        sourceStableId: record.stableSourceId,
        dedupVerdict: record.dedup.verdict,
        state: record.state,
      });
      return { candidateId: inserted.id, created: true };
    }

    // Conflict: a candidate with this identity already exists — return it.
    const existing = await this.findCandidateByIdentity(record.sourceKey, record.stableSourceId);
    if (existing === null) {
      throw new ServiceError("invalid-input", "candidate conflict but existing row not found");
    }
    return { candidateId: existing.candidateId, created: false };
  }

  /** Get-or-create the provenance `research_source` for a discovery run. */
  async #getOrCreateSource(sourceKey: string): Promise<string> {
    const name = `Automated discovery (${sourceKey})`;
    const existing = await one<{ id: string }>(
      this.#db,
      "select id from research_source where name = $1 limit 1",
      [name],
    );
    if (existing) return existing.id;
    const created = await one<{ id: string }>(
      this.#db,
      `insert into research_source (name, import_method, external_id)
       values ($1, 'CONNECTOR', $2) returning id`,
      [name, sourceKey],
    );
    if (created === null)
      throw new ServiceError("invalid-input", "failed to create research_source");
    return created.id;
  }

  async #audit(
    action: string,
    entity: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    await this.#db.query(
      `insert into audit_log (actor, action, entity, entity_id, before, after)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        this.#actor.id,
        action,
        entity,
        entityId,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
      ],
    );
  }
}

/**
 * Read-only `KnownStudyIndex` over the canonical schema (`research_identifier` /
 * `research_study` / `publication`). It NEVER writes; it only answers dedup
 * lookups against existing studies, so research-level deduplication is decided
 * against real records. Matches any study (published or not) so a re-import is
 * detected before it reaches the review queue.
 */
export class DatabaseStudyIndex implements KnownStudyIndex {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async findStudyByDoi(doi: string): Promise<string | null> {
    return this.#findStudyByIdentifierValue("DOI", doi);
  }

  async findStudyByIdentifier(type: string, value: string): Promise<string | null> {
    const sqlType = toIdentifierType(type);
    if (sqlType === null) return null;
    return this.#findStudyByIdentifierValue(sqlType, value);
  }

  async #findStudyByIdentifierValue(sqlType: string, value: string): Promise<string | null> {
    const row = await one<{ study_id: string | null }>(
      this.#db,
      `select coalesce(ri.study_id, p.study_id) as study_id
         from research_identifier ri
         left join publication p on p.id = ri.publication_id
        where ri.type = $1::identifier_type and ri.value_canonical = $2
        limit 1`,
      [sqlType, value],
    );
    return row?.study_id ?? null;
  }

  async findStudyByTitleYear(normalizedTitle: string, year: string): Promise<string | null> {
    const row = await one<{ id: string }>(
      this.#db,
      `select s.id
         from research_study s
         join publication p on p.study_id = s.id
        where s.normalized_title = $1
          and extract(year from p.publication_date)::text = $2
        limit 1`,
      [normalizedTitle, year],
    );
    return row?.id ?? null;
  }

  async findStudyByTitle(normalizedTitle: string): Promise<string | null> {
    const row = await one<{ id: string }>(
      this.#db,
      "select id from research_study where normalized_title = $1 limit 1",
      [normalizedTitle],
    );
    return row?.id ?? null;
  }
}
