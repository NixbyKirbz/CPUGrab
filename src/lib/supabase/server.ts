import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { portalSessionCookie, type Portal } from '@/lib/auth-portal';
export async function serverSupabase(portal: Portal = 'student') {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: portalSessionCookie(portal),
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (values) => {
          try {
            values.forEach(({ name, value, options }) => jar.set(name, value, options));
          } catch {
            /* Proxy handles refresh during rendering. */
          }
        },
      },
    },
  );
}
