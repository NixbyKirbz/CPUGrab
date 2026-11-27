import { createBrowserClient } from '@supabase/ssr';
import { portalForPath, portalSessionCookie, type Portal } from '@/lib/auth-portal';
export const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
function createPortalClient(portal: Portal) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { isSingleton: false, cookieOptions: portalSessionCookie(portal) },
  );
}
const clients = new Map<Portal, ReturnType<typeof createPortalClient>>();
export function getSupabase(portal?: Portal) {
  if (!configured)
    throw new Error('Connect Supabase using .env.local to use accounts and reservations.');
  const current =
    portal ??
    (typeof window !== 'undefined'
      ? portalForPath(
          window.location.pathname,
          new URLSearchParams(window.location.search).get('role'),
        )
      : 'student');
  const existing = typeof window !== 'undefined' ? clients.get(current) : undefined;
  if (existing) return existing;
  const client = createPortalClient(current);
  if (typeof window !== 'undefined') clients.set(current, client);
  return client;
}
