import { createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';

/**
 * Server-side Supabase client for auth/session (@supabase/ssr), reading ONLY the
 * public env vars. Returns null when Supabase is not configured (the M3 pending
 * gate) so callers degrade gracefully instead of crashing. The service-role key
 * is never read here (docs/16 §5).
 */
export function getServerSupabase(request: Request, cookies: AstroCookies) {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const cookieHeader = request.headers.get('cookie') ?? '';
  return createServerClient(url, key, {
    cookies: {
      getAll: () =>
        cookieHeader
          .split(';')
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => {
            const eq = c.indexOf('=');
            return { name: c.slice(0, eq), value: decodeURIComponent(c.slice(eq + 1)) };
          }),
      setAll: (toSet: { name: string; value: string; options?: unknown }[]) => {
        for (const { name, value, options } of toSet) {
          cookies.set(name, value, options as Parameters<AstroCookies['set']>[2]);
        }
      },
    },
  });
}
