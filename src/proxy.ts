import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  loginHref,
  portalCookie,
  portalCookieOptions,
  portalForPath,
  portalHome,
  portalSessionCookie,
  type Portal,
} from '@/lib/auth-portal';

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const authScreen = pathname === '/login' || pathname === '/register';
  const root = pathname === '/';
  const stallApplication = pathname === '/register/stall';
  const sellerArea = pathname === '/seller' || pathname.startsWith('/seller/');
  const adminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const preference = request.cookies.get(portalCookie)?.value === 'seller' ? 'seller' : 'student';
  const chosen = root
    ? searchParams.get('role') === 'seller'
      ? 'seller'
      : preference
    : portalForPath(pathname, searchParams.get('role'));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const changed = NextResponse.next();

  const finish = (response: NextResponse) => {
    changed.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
  const go = (destination: string, remember?: Portal) => {
    if (remember) changed.cookies.set(portalCookie, remember, portalCookieOptions);
    return finish(NextResponse.redirect(new URL(destination, request.url)));
  };
  if (!url || !key) return authScreen ? finish(NextResponse.next()) : go(loginHref(chosen));

  const client = (portal: Portal) =>
    createServerClient(url, key, {
      cookieOptions: portalSessionCookie(portal),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) =>
          values.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            changed.cookies.set(name, value, options);
          }),
      },
    });
  const read = async (portal: Portal) => {
    const db = client(portal);
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return { db, actor: null };
    const [profile, role] = await Promise.all([
      db.from('profiles').select('account_kind,is_suspended').eq('id', user.id).maybeSingle(),
      db.from('user_roles').select('role').eq('user_id', user.id).maybeSingle(),
    ]);
    if (profile.error || role.error || !profile.data || !role.data || profile.data.is_suspended)
      return { db, actor: null };
    const kind: Portal =
      role.data.role === 'admin'
        ? 'student'
        : profile.data.account_kind === 'seller'
          ? 'seller'
          : 'student';
    return { db, actor: { id: user.id, kind, role: role.data.role } };
  };

  const migrateLegacyStallSession = async (legacy: Awaited<ReturnType<typeof read>>) => {
    if (legacy.actor?.kind !== 'seller') return null;
    const current = await read('seller');
    if (current.actor?.kind !== 'seller') {
      // The legacy client already validated this account with Auth above.
      const {
        data: { session },
      } = await legacy.db.auth.getSession();
      if (!session || session.user.id !== legacy.actor.id) return null;
      const { error } = await current.db.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) return null;
    }
    const legacyName = 'sb-' + new URL(url).hostname.split('.')[0] + '-auth-token';
    for (const { name } of request.cookies.getAll()) {
      if (name === legacyName || name.startsWith(legacyName + '.')) {
        request.cookies.delete(name);
        changed.cookies.set(name, '', { path: '/', maxAge: 0 });
      }
    }
    return current.actor?.kind === 'seller' ? current.actor : legacy.actor;
  };

  const active = await read(chosen);
  let actor = active.actor?.kind === chosen ? active.actor : null;
  if (chosen === 'seller' && !actor) {
    const legacy = await read('student');
    actor = await migrateLegacyStallSession(legacy);
  }
  if (chosen === 'student' && active.actor?.kind === 'seller') {
    const seller = await migrateLegacyStallSession(active);
    if (seller && !authScreen) return go(portalHome('seller', seller.role), 'seller');
  }
  if (chosen === 'student' && !actor && (root || pathname === '/student/home')) {
    const seller = await read('seller');
    if (seller.actor?.kind === 'seller')
      return go(portalHome('seller', seller.actor.role), 'seller');
  }
  // Older home-screen installs open /student/home directly instead of the manifest's root URL.
  if (pathname === '/student/home' && preference === 'seller') {
    const seller = await read('seller');
    if (seller.actor?.kind === 'seller')
      return go(portalHome('seller', seller.actor.role), 'seller');
    return go(loginHref('seller'));
  }
  if (!actor) return authScreen ? finish(NextResponse.next({ request })) : go(loginHref(chosen));
  if (root || authScreen) return go(portalHome(chosen, actor.role), chosen);
  if (adminArea && actor.role !== 'admin') return go('/student/home', 'student');
  if (stallApplication && actor.role === 'seller') return go('/seller/dashboard', 'seller');
  if (sellerArea && actor.role !== 'seller') return go('/register/stall', 'seller');
  if (chosen === 'seller' && request.headers.get('sec-fetch-mode') === 'navigate') {
    changed.cookies.set(portalCookie, 'seller', portalCookieOptions);
  }
  return finish(NextResponse.next({ request }));
}

export const config = {
  matcher: [
    '/',
    '/student/:path*',
    '/seller/:path*',
    '/admin/:path*',
    '/login',
    '/register/:path*',
  ],
};
