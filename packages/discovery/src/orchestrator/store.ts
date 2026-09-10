/**
 * Persistence PORTS for the discovery run (M7.3; docs/30 §Phase 12-14).
 *
 * The orchestrator writes runs and candidates through these interfaces only — it
 * never imports `@wise-evidence/database`, so `packages/discovery` keeps its M7.1
 * boundary. The real adapter (server-side, via `service_role`, honouring RLS)
 * maps `DiscoveryRunStore` → `import_job` and `CandidateStore` → `import_candidate`.
 * An in-memory adapter here backs the deterministic offline tests.
 *
 * ⚠ SCHEMA FIREWALL (M7.3): DB-enforced candidate idempotency on
 * `(source_key, stable_source_id)` is NOT supported by the current
 * `import_candidate` schema. Implementing the real adapter requires an APPROVED
 * migration (two columns + a unique index + a `service_role` write path). Until
 * then the DB adapter is intentionally NOT built; see
 * `docs/reports/M7.3-DISCOVERY-RUN.md`. `InMemoryDiscoveryStore` models the
 * idempotency the DB unique index must enforce, so the future adapter is a
 * drop-in.
 */
import type {
  DedupDecision,
  DiscoveryRunState,
  DiscoveryRunTrigger,
  RunCounters,
} from "./types.js";
import type { KnownStudyIndex } from "./dedup.js";

/** Input to create a run row (`import_job`). */
export interface CreateRunInput {
  readonly sourceKey: string;
  readonly trigger: DiscoveryRunTrigger;
  readonly startedAt: string;
}

/** Final state written when a run ends. */
export interface FinalizeRunInput {
  readonly state: DiscoveryRunState;
  readonly counters: RunCounters;
  readonly endedAt: string;
  /** Safe, non-secret error summary (or null). */
  readonly errorSummary: string | null;
}

/** The candidate record persisted for reviewer follow-up (`import_candidate`). */
export interface CandidateRecordInput {
  readonly runId: string;
  readonly sourceKey: string;
  /** Stable per-source id — the candidate idempotency key with `sourceKey`. */
  readonly stableSourceId: string;
  /** Minimised, sanitized normalized metadata (no full text). */
  readonly normalizedPayload: Record<string, unknown>;
  /** Hash of the raw payload for provenance. */
  readonly rawHash: string | null;
  readonly dedup: DedupDecision;
  /** Candidate state (`import_candidate_state`). */
  readonly state: string;
}

/** Persists discovery runs. Maps to `import_job`. */
export interface DiscoveryRunStore {
  createRun(input: CreateRunInput): Promise<{ readonly runId: string }>;
  finalizeRun(runId: string, input: FinalizeRunInput): Promise<void>;
}

/** Persists reviewable candidates idempotently. Maps to `import_candidate`. */
export interface CandidateStore {
  /**
   * Existing candidate for `(sourceKey, stableSourceId)`, or null. This is the
   * idempotency lookup — a re-run of the same source item must not create a
   * second candidate.
   */
  findCandidateByIdentity(
    sourceKey: string,
    stableSourceId: string,
  ): Promise<{ readonly candidateId: string } | null>;

  /**
   * Insert a candidate. MUST be idempotent on `(sourceKey, stableSourceId)`:
   * inserting an identity that already exists returns the existing id and creates
   * nothing (the semantics the DB unique index will enforce).
   */
  insertCandidate(
    record: CandidateRecordInput,
  ): Promise<{ readonly candidateId: string; readonly created: boolean }>;
}

/** A stored run row (in-memory mirror of `import_job`). */
export interface StoredRun extends CreateRunInput {
  readonly runId: string;
  state: DiscoveryRunState;
  counters: RunCounters | null;
  endedAt: string | null;
  errorSummary: string | null;
}

/** A stored candidate row (in-memory mirror of `import_candidate` + new cols). */
export interface StoredCandidate extends CandidateRecordInput {
  readonly candidateId: string;
  readonly createdAt: string;
}

/**
 * Deterministic, offline in-memory implementation of both ports. Enforces
 * `(sourceKey, stableSourceId)` idempotency exactly as the proposed DB unique
 * index would, so tests prove the intended behaviour without a database.
 */
export class InMemoryDiscoveryStore implements DiscoveryRunStore, CandidateStore {
  readonly runs = new Map<string, StoredRun>();
  readonly candidates = new Map<string, StoredCandidate>();
  readonly #identity = new Map<string, string>(); // "sourceKey\u0000stableId" -> candidateId
  readonly #now: () => string;
  #runSeq = 0;
  #candSeq = 0;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.#now = now;
  }

  createRun(input: CreateRunInput): Promise<{ readonly runId: string }> {
    this.#runSeq += 1;
    const runId = `run-${this.#runSeq}`;
    this.runs.set(runId, {
      ...input,
      runId,
      state: "RUNNING",
      counters: null,
      endedAt: null,
      errorSummary: null,
    });
    return Promise.resolve({ runId });
  }

  finalizeRun(runId: string, input: FinalizeRunInput): Promise<void> {
    const run = this.runs.get(runId);
    if (run !== undefined) {
      run.state = input.state;
      run.counters = input.counters;
      run.endedAt = input.endedAt;
      run.errorSummary = input.errorSummary;
    }
    return Promise.resolve();
  }

  findCandidateByIdentity(
    sourceKey: string,
    stableSourceId: string,
  ): Promise<{ readonly candidateId: string } | null> {
    const id = this.#identity.get(identityKey(sourceKey, stableSourceId));
    return Promise.resolve(id === undefined ? null : { candidateId: id });
  }

  insertCandidate(
    record: CandidateRecordInput,
  ): Promise<{ readonly candidateId: string; readonly created: boolean }> {
    const key = identityKey(record.sourceKey, record.stableSourceId);
    const existing = this.#identity.get(key);
    if (existing !== undefined) {
      return Promise.resolve({ candidateId: existing, created: false });
    }
    this.#candSeq += 1;
    const candidateId = `cand-${this.#candSeq}`;
    this.candidates.set(candidateId, { ...record, candidateId, createdAt: this.#now() });
    this.#identity.set(key, candidateId);
    return Promise.resolve({ candidateId, created: true });
  }
}

function identityKey(sourceKey: string, stableSourceId: string): string {
  return `${sourceKey}\u0000${stableSourceId}`;
}

/** A seed study for the in-memory known-study index. */
export interface SeedStudy {
  readonly studyId: string;
  readonly doi?: string;
  readonly identifiers?: readonly { readonly type: string; readonly value: string }[];
  readonly normalizedTitle?: string;
  readonly year?: string;
}

/**
 * Deterministic, offline read-only `KnownStudyIndex` for tests. It NEVER writes
 * canonical data — it only answers the dedup lookups against a seeded set of
 * existing studies, standing in for the future `research_identifier`/`publication`
 * read adapter.
 */
export class InMemoryStudyIndex implements KnownStudyIndex {
  readonly #byDoi = new Map<string, string>();
  readonly #byIdentifier = new Map<string, string>();
  readonly #byTitleYear = new Map<string, string>();
  readonly #byTitle = new Map<string, string>();

  constructor(seed: readonly SeedStudy[] = []) {
    for (const s of seed) {
      if (s.doi !== undefined) this.#byDoi.set(s.doi, s.studyId);
      for (const id of s.identifiers ?? []) {
        this.#byIdentifier.set(identityKey(id.type, id.value), s.studyId);
      }
      if (s.normalizedTitle !== undefined) {
        this.#byTitle.set(s.normalizedTitle, s.studyId);
        if (s.year !== undefined) {
          this.#byTitleYear.set(identityKey(s.normalizedTitle, s.year), s.studyId);
        }
      }
    }
  }

  findStudyByDoi(doi: string): Promise<string | null> {
    return Promise.resolve(this.#byDoi.get(doi) ?? null);
  }
  findStudyByIdentifier(type: string, value: string): Promise<string | null> {
    return Promise.resolve(this.#byIdentifier.get(identityKey(type, value)) ?? null);
  }
  findStudyByTitleYear(normalizedTitle: string, year: string): Promise<string | null> {
    return Promise.resolve(this.#byTitleYear.get(identityKey(normalizedTitle, year)) ?? null);
  }
  findStudyByTitle(normalizedTitle: string): Promise<string | null> {
    return Promise.resolve(this.#byTitle.get(normalizedTitle) ?? null);
  }
}
