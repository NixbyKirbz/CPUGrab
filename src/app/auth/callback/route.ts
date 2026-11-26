import { NextResponse } from 'next/server';
import { serverSupabase } from '@/lib/supabase/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code) {
    const db = await serverSupabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) {
      const next = url.searchParams.get('next');
      return NextResponse.redirect(
        new URL(next === '/reset-password' ? next : '/login', url.origin),
      );
    }
  }
  return NextResponse.redirect(new URL('/login?error=verification', url.origin));
}
