import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  identifierPattern,
  portalCookie,
  portalCookieOptions,
  portalHome,
} from '@/lib/auth-portal';
import { serverSupabase } from '@/lib/supabase/server';

const schema = z.object({
  identifier: z.string().trim().min(3).max(320),
  password: z.string().min(8).max(128),
  portal: z.enum(['student', 'seller']),
});
const emailFormat = z.email();
const invalid = () =>
  NextResponse.json(
    { error: 'The email or student number and password do not match.' },
    { status: 401 },
  );
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

export async function POST(request: Request) {
  const result = schema.safeParse(await request.json().catch(() => null));
  if (!result.success)
    return NextResponse.json(
      { error: 'Enter your login information and password.' },
      { status: 400 },
    );
  const { identifier, password, portal } = result.data;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  let email = identifier;
  const byStudentNumber = !emailFormat.safeParse(identifier).success;
  if (byStudentNumber) {
    if (portal === 'seller' || !identifierPattern.test(identifier)) return invalid();
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!secret)
      return NextResponse.json(
        { error: 'Student-number login is unavailable. Sign in with your email for now.' },
        { status: 503 },
      );
    const lookup = createClient(url, secret, clientOptions);
    const found = await lookup.rpc('student_login_email', { p_student_number: identifier });
    if (found.error)
      return NextResponse.json(
        { error: 'Student-number login is temporarily unavailable.' },
        { status: 503 },
      );
    // Do the same password check for unknown numbers so the result does not disclose account existence.
    email =
      found.data ??
      `missing-${createHash('sha256').update(identifier.toLowerCase()).digest('hex').slice(0, 20)}@cpugrab.invalid`;
  }

  const auth = createClient(url, key, clientOptions);
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) return invalid();
  const [profile, role] = await Promise.all([
    auth.from('profiles').select('account_kind,is_suspended').eq('id', data.user.id).maybeSingle(),
    auth.from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle(),
  ]);
  if (profile.error || role.error)
    return NextResponse.json(
      { error: 'Could not load your campus account. Try again.' },
      { status: 503 },
    );
  if (!profile.data || !role.data || profile.data.is_suspended) return invalid();
  const actual = role.data.role === 'admin' ? 'student' : profile.data.account_kind;
  if (actual !== portal) {
    return NextResponse.json(
      {
        error:
          portal === 'seller'
            ? 'This is a student account. Use Student Login or create a separate Stall Portal account.'
            : 'This is a stall account. Use Stall Portal to sign in.',
      },
      { status: 403 },
    );
  }
  const db = await serverSupabase(portal);
  const { error: sessionError } = await db.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (sessionError)
    return NextResponse.json(
      { error: 'Could not start your session. Try again.' },
      { status: 503 },
    );
  const response = NextResponse.json({ next: portalHome(portal, role.data.role) });
  response.cookies.set(portalCookie, portal, portalCookieOptions);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
