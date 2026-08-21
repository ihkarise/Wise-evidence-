import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/index.js';

// Fixture identities
const REVIEWER_SUB = '00000000-0000-0000-0000-0000000000b1'; // app_user role REVIEWER
const ADMIN_SUB = '00000000-0000-0000-0000-0000000000b2'; // app_user role ADMIN
const S1_PUBLISHED = '00000000-0000-0000-0000-000000001001';
const S10_DRAFT = '00000000-0000-0000-0000-000000001010';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase({ seed: true });
});
afterAll(async () => {
  await db.close();
});

describe('RLS enforced by real PostgreSQL (ADR-012)', () => {
  it('1. anon CAN read published research', async () => {
    const rows = await db.asRole('anon', null, (exec) =>
      exec
        .query<{ id: string }>('select id from research_study where id = $1', [S1_PUBLISHED])
        .then((r) => r.rows)
    );
    expect(rows.length).toBe(1);
  });

  it('2. anon CANNOT read draft research (filtered to zero rows)', async () => {
    const rows = await db.asRole('anon', null, (exec) =>
      exec
        .query<{ id: string }>('select id from research_study where id = $1', [S10_DRAFT])
        .then((r) => r.rows)
    );
    expect(rows.length).toBe(0);
  });

  it('3. anon CANNOT read private AI results', async () => {
    await expect(
      db.asRole('anon', null, (exec) => exec.query('select * from ai_result'))
    ).rejects.toThrow();
  });

  it('4. anon CANNOT read internal audit data', async () => {
    await expect(
      db.asRole('anon', null, (exec) => exec.query('select * from audit_log'))
    ).rejects.toThrow();
  });

  it('5. authenticated reviewer CAN perform a permitted review operation', async () => {
    // Inserting a review row is permitted for reviewers; rolled back after.
    await db.asRole('authenticated', REVIEWER_SUB, async (exec) => {
      await exec.query(
        `insert into review (study_id, reviewer, action)
         values ($1, '00000000-0000-0000-0000-0000000000a1', 'APPROVE')`,
        [S1_PUBLISHED]
      );
    });
    // Reviewer can also read AI results (staff visibility).
    const ai = await db.asRole('authenticated', REVIEWER_SUB, (exec) =>
      exec.query<{ id: string }>('select id from ai_result').then((r) => r.rows)
    );
    expect(ai.length).toBeGreaterThan(0);
  });

  it('6. reviewer CANNOT perform an admin-only operation (manage taxonomy)', async () => {
    await expect(
      db.asRole('authenticated', REVIEWER_SUB, (exec) =>
        exec.query(
          `insert into study_type (code, label, clinical, subject) values ('X', 'x', true, 'HUMAN')`
        )
      )
    ).rejects.toThrow();
  });

  it('7. service_role CAN perform privileged operations (bypasses RLS)', async () => {
    const inserted = await db.asRole('service_role', null, (exec) =>
      exec
        .query<{ id: string }>(
          `insert into research_study (canonical_title, lifecycle_state)
           values ('service-role insert', 'DISCOVERED') returning id`
        )
        .then((r) => r.rows)
    );
    expect(inserted[0]!.id).toBeTruthy();
  });

  it('8. one user cannot read another user private data (app_user isolation)', async () => {
    // Reviewer sees only their own app_user row...
    const asReviewer = await db.asRole('authenticated', REVIEWER_SUB, (exec) =>
      exec.query<{ auth_id: string }>('select auth_id from app_user').then((r) => r.rows)
    );
    expect(asReviewer.map((r) => r.auth_id)).toEqual([REVIEWER_SUB]);

    // ...while an admin can see all rows.
    const asAdmin = await db.asRole('authenticated', ADMIN_SUB, (exec) =>
      exec.query<{ auth_id: string }>('select auth_id from app_user').then((r) => r.rows)
    );
    expect(asAdmin.length).toBeGreaterThanOrEqual(2);
  });
});
