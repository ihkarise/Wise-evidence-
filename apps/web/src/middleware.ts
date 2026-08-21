import { defineMiddleware } from 'astro:middleware';
import { getServerSupabase } from './lib/supabase-server.js';
import { resolveStaff } from './server/auth.js';

/**
 * Auth gate for /admin/* and /api/admin/* (docs/16). Resolves the Supabase
 * session → staff role and attaches it to locals. Fails closed: no staff → API
 * 401, page redirect to sign-in. Public/static routes pass straight through, so
 * prerendering is unaffected. In the Supabase pending gate (unconfigured or a
 * lookup error), the caller is simply treated as unauthenticated.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, cookies, url, locals } = context;
  locals.staff = null;

  const isAdminArea = url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin');
  if (!isAdminArea) return next();
  if (url.pathname === '/admin/signin') return next();

  try {
    const supabase = getServerSupabase(request, cookies);
    if (supabase) {
      const { data } = await supabase.auth.getUser();
      const sub = data.user?.id;
      if (sub) locals.staff = await resolveStaff(sub);
    }
  } catch {
    locals.staff = null;
  }

  if (!locals.staff) {
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return context.redirect('/admin/signin');
  }
  return next();
});
