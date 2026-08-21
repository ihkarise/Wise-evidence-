import { normalizeDoi } from '@wise-evidence/domain';
import type { QueryExecutor } from './db.js';
import type { PublicationRow, ResearchStudyRow } from './types.js';

/**
 * Minimal read-only data-access helpers (Milestone 2 foundation).
 *
 * These are low-level query primitives, not the M3 application repositories or
 * any CRUD UI. They exist to (a) prove the data-access layer isolates SQL and
 * (b) back the M2 tests. Writes are exercised through migrations/fixtures and the
 * RLS test harness, not here.
 */

/** Find a study by a DOI in any accepted form, using canonical-DOI matching. */
export async function findStudyByDoi(
  exec: QueryExecutor,
  rawDoi: string
): Promise<ResearchStudyRow | null> {
  const normalized = normalizeDoi(rawDoi);
  if (!normalized.ok) return null;
  const { rows } = await exec.query<ResearchStudyRow>(
    `select s.*
       from research_study s
       join research_identifier i
         on (i.study_id = s.id)
         or (i.publication_id in (select id from publication where study_id = s.id))
      where i.id_type = 'DOI' and i.value_canonical = $1
      limit 1`,
    [normalized.doi]
  );
  return rows[0] ?? null;
}

/** List published publications (public read path), newest first. */
export async function listPublishedPublications(
  exec: QueryExecutor,
  limit = 50
): Promise<PublicationRow[]> {
  const { rows } = await exec.query<PublicationRow>(
    `select *
       from publication
      where publication_state = 'PUBLISHED'
      order by publication_date desc nulls last
      limit $1`,
    [limit]
  );
  return rows;
}
