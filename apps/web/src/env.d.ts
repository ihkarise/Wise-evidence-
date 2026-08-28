/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

// Public, browser-safe environment variables. Astro exposes only `PUBLIC_*`
// variables to client code. Server-only secrets (e.g. a Supabase service-role
// key) must never be added here and never be prefixed with `PUBLIC_`.
interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
