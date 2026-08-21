import { withActor } from './db.js';

/** The authenticated staff member resolved from a Supabase auth user. */
export interface StaffContext {
  appUserId: string;
  role: 'REVIEWER' | 'ADMIN';
  sub: string;
}

/**
 * Map a Supabase auth user id (auth.uid()) to an app_user staff row. Uses the
 * service_role executor for the lookup only. Returns null for unknown users or
 * non-staff — a public user can never resolve to REVIEWER/ADMIN, and role is
 * read from the database (never from a client claim), so self-promotion is
 * impossible.
 */
export async function resolveStaff(sub: string): Promise<StaffContext | null> {
  return withActor({ role: 'service_role', sub: null }, async (exec) => {
    const { rows } = await exec.query<{ id: string; role: string }>(
      `select id, role from app_user where auth_id = $1`,
      [sub]
    );
    const r = rows[0];
    if (!r || (r.role !== 'REVIEWER' && r.role !== 'ADMIN')) return null;
    return { appUserId: r.id, role: r.role, sub };
  });
}
