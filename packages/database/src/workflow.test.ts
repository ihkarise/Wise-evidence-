import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';
import {
  createDraft,
  updateDraft,
  setClassification,
  addCriticism,
  submitForReview,
  approveAndPublish,
  reject,
  archive,
  findExistingByDoi,
  PermissionError,
  PublicationError,
  type ActorContext,
} from './service.js';
import { getPublishedStudyDetail } from './read.js';

const REVIEWER: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a1', role: 'REVIEWER' };
const ADMIN: ActorContext = { appUserId: '00000000-0000-0000-0000-0000000000a2', role: 'ADMIN' };
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1';
const ADMIN_SUB = '00000000-0000-0000-0000-0000000000b2';

let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe('M3 manual research lifecycle (DOI → publish → public page)', () => {
  it('runs the full reviewer→admin workflow with fail-closed publish', async () => {
    // Reviewer creates a draft from a DOI + source.
    const { studyId } = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      createDraft(exec, REVIEWER, {
        title: 'Homeopathy for seasonal allergic rhinitis (workflow test)',
        doi: 'https://doi.org/10.1234/wf.001',
        sourceName: 'Crossref',
        sourceUrl: 'https://example.org/wf-001',
        abstract: 'A trial abstract.',
        publicationDate: '2023-04-01',
      })
    );
    expect(studyId).toBeTruthy();

    // Reviewer edits and classifies (separate dimensions).
    await db.asRolePersistent('authenticated', REVIEWER_SUB, async (exec) => {
      await updateDraft(exec, REVIEWER, studyId, { summary: 'Human summary.', studyTypeCode: 'RCT', subject: 'HUMAN' });
      await setClassification(exec, REVIEWER, studyId, { dimension: 'OUTCOME', value: 'POSITIVE', judgementConfidence: 'MODERATE' });
      await setClassification(exec, REVIEWER, studyId, { dimension: 'QUALITY', value: 'ADEQUATE' });
      await setClassification(exec, REVIEWER, studyId, { dimension: 'CONFIDENCE', value: 'MODERATE' });
      await setClassification(exec, REVIEWER, studyId, { dimension: 'EVIDENCE_LEVEL', value: 'RCT' });
      await addCriticism(exec, REVIEWER, studyId, { category: 'SAMPLE_SIZE', origin: 'REVIEWER_ASSESSED', body: 'Small sample.' });
      await submitForReview(exec, REVIEWER, studyId);
    });

    // Reviewer may NOT publish (service-layer permission).
    await expect(
      db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => approveAndPublish(exec, REVIEWER, studyId))
    ).rejects.toBeInstanceOf(PermissionError);

    // Reviewer may NOT publish at the DB boundary either (RLS WITH CHECK).
    await expect(
      db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
        exec.query(`update publication set publication_state = 'PUBLISHED' where study_id = $1`, [studyId])
      )
    ).rejects.toThrow();

    // Admin publishes.
    await db.asRolePersistent('authenticated', ADMIN_SUB, (exec) => approveAndPublish(exec, ADMIN, studyId));

    // Published detail is visible to anon; separate dimensions preserved.
    const detail = await db.asRole('anon', null, (exec) => getPublishedStudyDetail(exec, studyId));
    expect(detail).not.toBeNull();
    expect(detail!.doi).toBe('10.1234/wf.001');
    expect(detail!.summary).toBe('Human summary.');
    const dims = Object.fromEntries(detail!.classifications.map((c) => [c.dimension, c.value]));
    expect(dims.OUTCOME).toBe('POSITIVE');
    expect(dims.QUALITY).toBe('ADEQUATE');
    expect(detail!.criticisms[0]!.category).toBe('SAMPLE_SIZE'); // criticism separate from outcome
  });

  it('fails closed when required data is missing (no outcome classification)', async () => {
    const { studyId } = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      createDraft(exec, REVIEWER, { title: 'Incomplete study', doi: '10.1234/wf.incomplete', sourceName: 'Crossref' })
    );
    await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => submitForReview(exec, REVIEWER, studyId));
    await expect(
      db.asRolePersistent('authenticated', ADMIN_SUB, (exec) => approveAndPublish(exec, ADMIN, studyId))
    ).rejects.toBeInstanceOf(PublicationError);
    // Remains unpublished / not publicly visible.
    const detail = await db.asRole('anon', null, (exec) => getPublishedStudyDetail(exec, studyId));
    expect(detail).toBeNull();
  });

  it('refuses to publish demo data (fail closed)', async () => {
    // Demo study 1010 is draft; force-submit as admin then attempt publish.
    const demoId = '00000000-0000-0000-0000-000000001001'; // published demo — is_demo=true
    await expect(
      db.asRolePersistent('authenticated', ADMIN_SUB, (exec) => approveAndPublish(exec, ADMIN, demoId))
    ).rejects.toBeInstanceOf(PublicationError);
  });

  it('detects duplicate DOI on re-entry', async () => {
    const existing = await db.asRole('anon', null, (exec) => findExistingByDoi(exec, 'https://doi.org/10.1234/WF.001'));
    expect(existing).not.toBeNull();
  });

  it('a reviewer cannot self-promote to ADMIN', async () => {
    // RLS filters the row out of a reviewer's UPDATE (0 rows affected), so the
    // role never changes — self-promotion is impossible.
    const res = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      exec.query(`update app_user set role = 'ADMIN' where auth_id = $1`, [REVIEWER_SUB])
    );
    expect((res as unknown as { affectedRows?: number }).affectedRows ?? 0).toBe(0);
    const role = await db.asRolePersistent('authenticated', ADMIN_SUB, (exec) =>
      exec.query<{ role: string }>(`select role from app_user where auth_id = $1`, [REVIEWER_SUB]).then((r) => r.rows[0]!.role)
    );
    expect(role).toBe('REVIEWER');
  });

  it('reject and archive transitions are recorded and gated', async () => {
    const { studyId } = await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) =>
      createDraft(exec, REVIEWER, { title: 'To be rejected', doi: '10.1234/wf.reject', sourceName: 'Crossref' })
    );
    await db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => reject(exec, REVIEWER, studyId, 'out of scope'));
    // Reviewer cannot archive (admin-only).
    await expect(
      db.asRolePersistent('authenticated', REVIEWER_SUB, (exec) => archive(exec, REVIEWER, studyId))
    ).rejects.toBeInstanceOf(PermissionError);
    await db.asRolePersistent('authenticated', ADMIN_SUB, (exec) => archive(exec, ADMIN, studyId));
    // Audit recorded the reject + archive.
    const audits = await db.asRolePersistent('authenticated', ADMIN_SUB, (exec) =>
      exec
        .query<{ action: string }>(`select action from audit_log where entity_id = $1 order by created_at`, [studyId])
        .then((r) => r.rows.map((x) => x.action))
    );
    expect(audits).toContain('REJECT');
    expect(audits).toContain('ARCHIVE');
  });
});
