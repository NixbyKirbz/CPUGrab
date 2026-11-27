import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase/server';
import { loginHref, portalCookie, portalCookieOptions, portalForPath } from '@/lib/auth-portal';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const portal = portalForPath('/auth/callback', url.searchParams.get('role'));
  if (code) {
    const db = await serverSupabase(portal);
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const next = url.searchParams.get('next');
      const response = NextResponse.redirect(
        new URL(
          next === '/reset-password'
            ? `/reset-password${portal === 'seller' ? '?role=seller' : ''}`
            : loginHref(portal),
          url.origin,
        ),
      );
      response.cookies.set(portalCookie, portal, portalCookieOptions);
      return response;
    }
  }
  const failure = new URL(loginHref(portal), url.origin);
  failure.searchParams.set('error', 'verification');
  return NextResponse.redirect(failure);
}
