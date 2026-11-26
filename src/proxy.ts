import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return response;
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
  const role = request.nextUrl.pathname.startsWith('/seller')
    ? 'seller'
    : request.nextUrl.pathname.startsWith('/admin')
      ? 'admin'
      : null;
  if (role) {
    if (!user) return NextResponse.redirect(new URL('/login', request.url));
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    if (data?.role !== role && data?.role !== 'admin')
      return NextResponse.redirect(new URL('/student/home', request.url));
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = {
  matcher: ['/student/:path*', '/seller/:path*', '/admin/:path*', '/login', '/register'],
};
