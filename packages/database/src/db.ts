/**
 * Minimal driver-agnostic query executor.
 *
 * Both PGlite (tests/CI) and a real PostgreSQL/Supabase connection (production,
 * a later milestone) can satisfy this interface, so data-access code never binds
 * to a specific driver. The domain package (`@wise-evidence/domain`) must never
 * depend on this — the dependency arrow is domain ← database (docs/23 §5).
 */
export interface QueryResult<Row> {
  rows: Row[];
}

export interface QueryExecutor {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<QueryResult<Row>>;
}
