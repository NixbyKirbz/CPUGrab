import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authScreen = pathname === '/login' || pathname === '/register';
  const sellerArea = pathname.startsWith('/seller/');
  const adminArea = pathname === '/admin' || pathname.startsWith('/admin/');
  const stallApplication = pathname === '/register/stall';
  let response = NextResponse.next({ request });
  const go = (destination: string) => {
    const redirect = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set('Cache-Control', 'private, no-store');
    return redirect;
  };
  const sellerIntent =
    sellerArea || stallApplication || request.nextUrl.searchParams.get('role') === 'seller';
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return authScreen ? response : go(sellerIntent ? '/login?role=seller' : '/login');
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !authScreen) return go(sellerIntent ? '/login?role=seller' : '/login');
  if (user && (pathname === '/' || authScreen || sellerArea || adminArea || stallApplication)) {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    const role = data?.role;
    const home =
      role === 'admin'
        ? '/admin'
        : role === 'seller'
          ? '/seller/dashboard'
          : sellerIntent || user.user_metadata.account_type === 'seller'
            ? '/register/stall'
            : '/student/home';
    if (pathname === '/' || authScreen) return go(home);
    if (sellerArea && role !== 'seller' && role !== 'admin') return go('/register/stall');
    if (adminArea && role !== 'admin') return go(home);
    if (stallApplication && role === 'seller') return go('/seller/dashboard');
    if (stallApplication && role === 'admin') return go('/admin');
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
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
