import {
  MockDiscoveryConnector,
  CrossrefDiscoveryConnector,
  type ResearchDiscoveryConnector,
  type NormalizedDiscoveryRecord,
} from '@wise-evidence/discovery';
import {
  startImportJob,
  finalizeImportJob,
  findExistingStudyIdsByDois,
  recordCandidate,
  type ImportState,
} from '@wise-evidence/database';
import { withActor } from './db.js';
import type { StaffContext } from './auth.js';

/**
 * Automated research discovery orchestration (M7, docs/25). Selects a connector
 * from server-only env, opens an import job, runs the connector's network call
 * OUTSIDE any DB transaction, deduplicates by DOI, and records review candidates.
 * It never publishes or classifies — approval routes through the M3 draft service.
 *
 *   DISCOVERY_CONNECTOR   'mock' (default, offline) | 'crossref'
 */
export function getDiscoveryConnector(): ResearchDiscoveryConnector {
  return process.env.DISCOVERY_CONNECTOR === 'crossref' ? new CrossrefDiscoveryConnector() : new MockDiscoveryConnector();
}

const HARD_MAX_RESULTS = 50;

export interface RunDiscoveryInput {
  sourceName?: string;
  query: string;
  maxResults?: number;
}

export interface RunDiscoverySummary {
  jobId: string;
  ok: boolean;
  error?: string;
  discovered: number;
  duplicate: number;
  candidate: number;
  malformed: number;
}

export async function runDiscovery(staff: StaffContext, input: RunDiscoveryInput): Promise<RunDiscoverySummary> {
  const connector = getDiscoveryConnector();
  const actor = { appUserId: staff.appUserId, role: staff.role };
  const sub = staff.sub;
  const cap = Math.max(1, Math.min(Math.floor(input.maxResults ?? 10) || 10, connector.maxResultsCap, HARD_MAX_RESULTS));

  const { jobId } = await withActor({ role: 'authenticated', sub }, (e) =>
    startImportJob(e, actor, { sourceName: input.sourceName?.trim() || connector.name })
  );

  // Network happens outside any transaction (no lock held during I/O).
  const disc = await connector.discover({ query: input.query, maxResults: cap });
  if (!disc.ok) {
    await withActor({ role: 'authenticated', sub }, (e) =>
      finalizeImportJob(e, actor, jobId, { discovered: 0, normalized: 0, duplicate: 0, candidate: 0, error: 1 }, true)
    );
    return { jobId, ok: false, error: disc.message, discovered: 0, duplicate: 0, candidate: 0, malformed: 0 };
  }

  const norm = disc.records.map((r) => ({ raw: r.raw, n: connector.normalize(r) }));

  const summary = await withActor({ role: 'authenticated', sub }, async (e) => {
    const existing = await findExistingStudyIdsByDois(
      e,
      norm.map((x) => x.n.doi).filter((d): d is string => !!d)
    );
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
      await recordCandidate(e, actor, jobId, { raw, normalized: n, state, duplicateOfStudyId: duplicateOf });
    }
    await finalizeImportJob(e, actor, jobId, {
      discovered: disc.records.length,
      normalized: norm.length,
      duplicate,
      candidate,
      error: disc.malformed,
    });
    return { duplicate, candidate };
  });

  return {
    jobId,
    ok: true,
    discovered: disc.records.length,
    duplicate: summary.duplicate,
    candidate: summary.candidate,
    malformed: disc.malformed,
  };
}

export type { NormalizedDiscoveryRecord };
