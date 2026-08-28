import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockDiscoveryConnector, type NormalizedDiscoveryRecord } from '@wise-evidence/discovery';
import type { QueryExecutor } from './db.js';
import type { ImportState } from './types.js';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import { createDraft, PermissionError, type ActorContext } from './service.js';
import { getPublishedStudyDetail } from './read.js';
import {
  startImportJob,
  finalizeImportJob,
  findExistingStudyIdsByDois,
  recordCandidate,
  listImportJobs,
  listCandidates,
  approveCandidate,
  rejectCandidate,
  markCandidateDuplicate,
} from './discovery.js';

const REVIEWER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a1', role: 'REVIEWER' };
const ADMIN: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a2', role: 'ADMIN' };
const PUBLIC_USER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a9', role: 'PUBLIC' };
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1';
const ADMIN_SUB = '00000000-0000-0000-0000-0000000000b2';
const RANDOM_SUB = '00000000-0000-0000-0000-0000000000c9';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

const rev = <T>(fn: (exec: QueryExecutor) => Promise<T>): Promise<T> => db.asRolePersistent('authenticated', REVIEWER_SUB, fn);

/** Minimal orchestration (mirrors the app server): start → discover → normalize → dedup → record → finalize. */
async function runMockDiscovery(query: string, max: number): Promise<string> {
  const connector = new MockDiscoveryConnector();
  const { jobId } = await rev((e) => startImportJob(e, REVIEWER, { sourceName: 'MockSource' }));
  const disc = await connector.discover({ query, maxResults: max });
  if (!disc.ok) {
    await rev((e) => finalizeImportJob(e, REVIEWER, jobId, { discovered: 0, normalized: 0, duplicate: 0, candidate: 0, error: 1 }, true));
    return jobId;
  }
  const norm = disc.records.map((r) => ({ raw: r.raw, n: connector.normalize(r) }));
  const existing = await rev((e) => findExistingStudyIdsByDois(e, norm.map((x) => x.n.doi).filter((d): d is string => !!d)));
  let duplicate = 0;
  let candidate = 0;
  const seen = new Set<string>();
  for (const { raw, n } of norm) {
    let state: ImportState = 'REVIEW_REQUIRED';
    let duplicateOf: string | null = null;
    if (n.doi && existing[n.doi]) {
      state = 'DUPLICATE_CANDIDATE';
      duplicateOf = existing[n.doi]!;
      duplicate++;
    } else if (n.doi && seen.has(n.doi)) {
      state = 'DUPLICATE_CANDIDATE';
      duplicate++;
    } else {
      candidate++;
    }
    if (n.doi) seen.add(n.doi);
    await rev((e) => recordCandidate(e, REVIEWER, jobId, { raw, normalized: n, state, duplicateOfStudyId: duplicateOf }));
  }
  await rev((e) => finalizeImportJob(e, REVIEWER, jobId, { discovered: disc.records.length, normalized: norm.length, duplicate, candidate, error: 0 }));
  return jobId;
}

async function candidates(jobId: string) {
  return rev((e) => listCandidates(e, jobId));
}
const doiOf = (payload: unknown): string | null => (payload as NormalizedDiscoveryRecord)?.doi ?? null;

describe('M7 automated research discovery', () => {
  it('discovers, dedups against an existing study (without deleting it), and records honest counts', async () => {
    // Seed an already-indexed study with the "existing" fixture DOI.
    const existing = await rev((e) =>
      createDraft(e, REVIEWER, { title: '[seed] already indexed', doi: '10.9999/mockdemo.existing.002', sourceName: 'Seed' })
    );

    const jobId = await runMockDiscovery('homeopathy', 50);
    const cands = await candidates(jobId);
    expect(cands.length).toBeGreaterThan(0);

    const existingCand = cands.find((c) => doiOf(c.normalized_payload) === '10.9999/mockdemo.existing.002')!;
    expect(existingCand.state).toBe('DUPLICATE_CANDIDATE');
    expect(existingCand.duplicate_of_study_id).toBe(existing.studyId);

    // The existing study is NOT deleted by discovery.
    const still = await rev((e) => e.query<{ n: number }>(`select count(*)::int n from research_study where id = $1`, [existing.studyId]));
    expect(still.rows[0]!.n).toBe(1);

    // Within-batch duplicate DOI (fixtures share one DOI) is flagged, not merged.
    const dupCount = cands.filter((c) => c.state === 'DUPLICATE_CANDIDATE').length;
    expect(dupCount).toBeGreaterThanOrEqual(2);

    const job = (await rev((e) => listImportJobs(e))).find((j) => j.id === jobId)!;
    expect(job.state).toBe('IMPORTED');
    expect(job.discovered_count).toBe(cands.length);
    expect(job.duplicate_count).toBe(dupCount);
  });

  it('CRITICAL: an approved candidate becomes an IMPORTED/DRAFT study — never PUBLISHED, invisible to anon', async () => {
    const jobId = await runMockDiscovery('homeopathy', 50);
    const cands = await candidates(jobId);
    const fresh = cands.find((c) => c.state === 'REVIEW_REQUIRED' && doiOf(c.normalized_payload) === '10.9999/mockdemo.new.001')!;
    expect(fresh).toBeTruthy();

    const { studyId } = await rev((e) => approveCandidate(e, REVIEWER, fresh.id));

    const study = await rev((e) =>
      e.query<{ lifecycle_state: string; publication_state: string | null }>(
        `select s.lifecycle_state, p.publication_state
           from research_study s left join publication p on p.study_id = s.id and p.is_primary = true
          where s.id = $1`,
        [studyId]
      )
    );
    expect(study.rows[0]!.lifecycle_state).toBe('IMPORTED');
    expect(study.rows[0]!.publication_state).toBe('DRAFT');

    // Discovery never publishes: anon sees nothing.
    const anonView = await db.asRole('anon', null, (e) => getPublishedStudyDetail(e, studyId));
    expect(anonView).toBeNull();

    // Provenance survived into the draft (source recorded).
    const src = await rev((e) =>
      e.query<{ source_name: string }>(
        `select rs.source_name from research_source rs
           join publication p on p.source_id = rs.id where p.study_id = $1`,
        [studyId]
      )
    );
    expect(src.rows[0]!.source_name).toBe('MockSource');

    // The candidate records which study it produced.
    const after = (await candidates(jobId)).find((c) => c.id === fresh.id)!;
    expect(after.state).toBe('IMPORTED');
    expect(after.imported_study_id).toBe(studyId);
  });

  it('reject and mark-duplicate keep the candidate auditable; audit rows are written', async () => {
    const jobId = await runMockDiscovery('homeopathy', 50);
    const cands = await candidates(jobId);
    const a = cands.find((c) => c.state === 'REVIEW_REQUIRED')!;
    const b = cands.find((c) => c.state === 'REVIEW_REQUIRED' && c.id !== a.id)!;

    await rev((e) => rejectCandidate(e, REVIEWER, a.id, 'Out of scope.'));
    await rev((e) => markCandidateDuplicate(e, ADMIN, b.id, { reason: 'Looks like an existing record.' }));

    const updated = await candidates(jobId);
    expect(updated.find((c) => c.id === a.id)!.state).toBe('REJECTED');
    expect(updated.find((c) => c.id === b.id)!.state).toBe('DUPLICATE_CANDIDATE');

    const audits = await rev((e) =>
      e.query<{ n: number }>(`select count(*)::int n from audit_log where entity = 'import_candidate' and action in ('REJECT_CANDIDATE','MARK_DUPLICATE','APPROVE_CANDIDATE','DISCOVER_CANDIDATE')`)
    );
    expect(audits.rows[0]!.n).toBeGreaterThan(0);
  });

  it('is staff-only: PUBLIC actor is refused at the service layer', async () => {
    await expect(rev((e) => startImportJob(e, PUBLIC_USER, { sourceName: 'x' }))).rejects.toBeInstanceOf(PermissionError);
  });

  it('RLS: anon cannot read import jobs or candidates (no grant at all — stronger than row filtering)', async () => {
    await runMockDiscovery('homeopathy', 5);
    await expect(db.asRole('anon', null, (e) => e.query(`select id from import_job`))).rejects.toThrow();
    await expect(db.asRole('anon', null, (e) => e.query(`select id from import_candidate`))).rejects.toThrow();
  });

  it('RLS: a signed-in non-staff user cannot insert an import candidate', async () => {
    const { jobId } = await db.asRolePersistent('authenticated', ADMIN_SUB, (e) => startImportJob(e, ADMIN, { sourceName: 'x' }));
    await expect(
      db.asRole('authenticated', RANDOM_SUB, (e) =>
        e.query(`insert into import_candidate (job_id, state) values ($1, 'REVIEW_REQUIRED')`, [jobId])
      )
    ).rejects.toThrow();
  });
});
