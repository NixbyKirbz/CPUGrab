import { NextResponse } from 'next/server';
import { z } from 'zod';
import { serverSupabase } from '@/lib/supabase/server';
const schema = z
  .object({
    email: z.email(),
    password: z.string().min(8).max(128),
    confirm: z.string(),
    full_name: z.string().trim().min(1).max(120),
    student_id: z.string().max(40).optional(),
    account_type: z.enum(['student', 'seller']),
  })
  .refine((x) => x.password === x.confirm, 'Passwords must match')
  .refine(
    (x) => x.account_type === 'seller' || Boolean(x.student_id?.trim()),
    'Student ID required',
  );
export async function POST(request: Request) {
  try {
    const value = schema.parse(await request.json());
    const allowed = (process.env.UNIVERSITY_EMAIL_DOMAINS || '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      value.account_type === 'student' &&
      allowed.length &&
      !allowed.includes(value.email.split('@')[1].toLowerCase())
    )
      return NextResponse.json(
        { error: 'Use an approved university email address.' },
        { status: 400 },
      );
    const url = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const db = await serverSupabase();
    const { error } = await db.auth.signUp({
      email: value.email,
      password: value.password,
      options: {
        emailRedirectTo: `${url}/auth/callback`,
        data: {
          full_name: value.full_name,
          student_id: value.student_id,
          account_type: value.account_type,
        },
      },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues[0].message
            : 'Registration could not be completed. Check your configuration.',
      },
      { status: 400 },
    );
  }
}
