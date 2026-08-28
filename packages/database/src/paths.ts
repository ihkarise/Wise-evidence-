/**
 * Filesystem locators for the version-controlled SQL that defines the database.
 *
 * SQL lives in the repository's top-level `supabase/` directory (migrations +
 * seed), kept isolated from any UI. This module only resolves and reads those
 * files in deterministic order; it holds no schema knowledge itself and performs
 * no database I/O (docs/25 §10).
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to `supabase/migrations` (repo-root relative to this file). */
export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);

/** Absolute path to `supabase/seed`. */
export const SEED_DIR = fileURLToPath(new URL("../../../supabase/seed/", import.meta.url));

/** One migration file: its numeric-sortable name and full SQL text. */
export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

/**
 * Read all `*.sql` migrations in lexical (== ordered, zero-padded) order.
 * The ordering is the deployment order; never reorder existing files.
 */
export async function loadMigrations(): Promise<MigrationFile[]> {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith(".sql")).sort();

  const files: MigrationFile[] = [];
  for (const name of names) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), "utf8");
    files.push({ name, sql });
  }
  return files;
}

/** Read a single named SQL file from `supabase/seed`. */
export async function loadSeedFile(fileName: string): Promise<string> {
  return readFile(join(SEED_DIR, fileName), "utf8");
}
