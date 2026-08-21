/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Public Supabase project URL. Safe to expose to the browser. */
  readonly PUBLIC_SUPABASE_URL?: string;
  /** Public Supabase anon key. Safe to expose to the browser (RLS enforced). */
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** Authenticated staff (REVIEWER/ADMIN), or null. Set by middleware. */
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    staff: import('./server/auth').StaffContext | null;
  }
}
