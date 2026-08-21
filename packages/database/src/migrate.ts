import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A minimal SQL executor able to run a multi-statement script. PGlite's `exec`
 * and a real PostgreSQL connection both satisfy this.
 */
export interface SqlScriptRunner {
  exec(sql: string): Promise<unknown>;
}

export interface SqlFile {
  name: string;
  sql: string;
}

/** Absolute URL of the canonical `supabase/migrations/` directory (repo root). */
export function migrationsDir(): URL {
  return new URL('../../../supabase/migrations/', import.meta.url);
}

/** Absolute URL of the `supabase/seed/` directory (repo root). */
export function seedDir(): URL {
  return new URL('../../../supabase/seed/', import.meta.url);
}

/** Read `.sql` files from a directory, sorted by filename (ordering matters). */
export function readSqlFiles(dir: URL): SqlFile[] {
  const dirPath = fileURLToPath(dir);
  return readdirSync(dirPath)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
}

/** Apply the real migration files, in order, to the given database. */
export async function runMigrations(db: SqlScriptRunner, dir: URL = migrationsDir()): Promise<string[]> {
  const files = readSqlFiles(dir);
  for (const file of files) {
    await db.exec(file.sql);
  }
  return files.map((f) => f.name);
}

/** Apply the seed + demo-fixture files, in order. */
export async function runSeed(db: SqlScriptRunner, dir: URL = seedDir()): Promise<string[]> {
  const files = readSqlFiles(dir);
  for (const file of files) {
    await db.exec(file.sql);
  }
  return files.map((f) => f.name);
}
