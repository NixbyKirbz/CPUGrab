'use client';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Eye, EyeOff, ArrowLeft, Mail, LockKeyhole } from 'lucide-react';
import { configured, getSupabase } from '@/lib/supabase/client';
import { identifierPattern } from '@/lib/auth-portal';
import { Busy, ErrorBox } from './ui';
const schema = z.object({
  email: z.string().trim(),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  full_name: z.string().optional(),
  student_id: z.string().optional(),
  confirm: z.string().optional(),
});
type Fields = z.infer<typeof schema>;
export function Auth({
  mode,
  seller = false,
}: {
  mode: 'login' | 'register' | 'forgot' | 'reset';
  seller?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const acceptsStudentNumber = mode === 'login' && !seller;
  const identifierLabel = acceptsStudentNumber
    ? 'Email address or student number'
    : 'Email address';
  const roleQuery = seller ? '?role=seller' : '';
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(timer);
  }, []);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Fields>({
    resolver: zodResolver(
      schema.refine(
        ({ email }) =>
          mode === 'reset' ||
          z.email().safeParse(email).success ||
          (acceptsStudentNumber && identifierPattern.test(email)),
        {
          path: ['email'],
          message: acceptsStudentNumber
            ? 'Enter your email address or student number.'
            : 'Enter a valid email address.',
        },
      ),
    ),
    defaultValues: { email: '', password: '' },
  });
  const submit = async (values: Fields) => {
    setError(null);
    setNotice('');
    setBusy(true);
    try {
      if (!configured)
        throw new Error(
          'Supabase is not configured yet. Copy .env.example to .env.local and add your project URL and publishable key.',
        );
      if (mode === 'register') {
        if (!values.full_name?.trim() || (!seller && !values.student_id?.trim()))
          throw new Error('Complete your full name and student ID.');
        if (values.password !== values.confirm) throw new Error('The passwords do not match.');
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...values, account_type: seller ? 'seller' : 'student' }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (body.signedIn) {
          window.location.replace(seller ? '/register/stall' : '/');
          return;
        }
        setNotice(
          'Check your email to verify your account. Then sign in' +
            (seller ? ' and complete your stall application.' : '.'),
        );
      } else if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: values.email,
            password: values.password,
            portal: seller ? 'seller' : 'student',
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        window.location.replace(body.next);
      } else if (mode === 'forgot') {
        const { error } = await getSupabase().auth.resetPasswordForEmail(values.email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password${seller ? '&role=seller' : ''}`,
        });
        if (error) throw error;
        setNotice('If an account exists, a password reset link is on its way.');
      } else {
        const { error } = await getSupabase().auth.updateUser({ password: values.password });
        if (error) throw error;
        setNotice('Password updated. You can now sign in.');
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const title =
    mode === 'login'
      ? 'Campus Food Reservation'
      : mode === 'register'
        ? seller
          ? 'Bring your stall to campus.'
          : 'Your next great break starts here.'
        : mode === 'forgot'
          ? 'Forgot your password?'
          : 'Choose a new password';
  return (
    <div
      className={`auth-layout ${mode === 'login' ? 'login-layout' : ''} ${seller ? 'stall-auth' : ''}`}
    >
      <aside className="auth-art">
        <img src="/brand/logo.png" alt="CPUGrab" />
        <h1>
          Reserve.
          <br />
          Pick Up.
          <br />
          <span>Skip the Line.</span>
        </h1>
        <p>Good food. More time. A little more room for your campus day.</p>
        <small>Central Philippine University · Campus food reservation</small>
      </aside>
      <main id="main-content" className="auth-main">
        <div className="auth-form">
          <img
            className="auth-mobile-brand"
            src="/brand/logo.png"
            alt="CPUGrab"
            draggable={false}
          />
          {seller && <span className="stall-portal-label">Stall Portal</span>}
          <h2>{title}</h2>
          <p>
            {mode === 'login'
              ? 'Central Philippine University'
              : mode === 'register'
                ? 'A few details, and you’re one step closer to a better break.'
                : 'We’ll help you get back to your campus favorites.'}
          </p>
          {Boolean(error) && <ErrorBox error={error} />}{' '}
          {notice ? (
            <div className="notice">
              {notice}
              <div>
                <Link className="text-button" href={seller ? '/login?role=seller' : '/login'}>
                  Back to sign in →
                </Link>
              </div>
            </div>
          ) : (
            <form method="post" className="form-stack" onSubmit={handleSubmit(submit)}>
              {mode === 'register' && (
                <>
                  <label>
                    Full name
                    <input
                      autoComplete="name"
                      {...register('full_name')}
                      required
                      maxLength={120}
                    />
                  </label>
                  {!seller && (
                    <label>
                      Student ID
                      <input {...register('student_id')} required maxLength={40} />
                    </label>
                  )}
                </>
              )}
              {mode !== 'reset' && (
                <label>
                  <span className={mode === 'login' ? 'sr-only' : undefined}>
                    {identifierLabel}
                  </span>
                  <div className="auth-field">
                    {mode === 'login' && <Mail size={19} aria-hidden="true" />}
                    <input
                      type={acceptsStudentNumber ? 'text' : 'email'}
                      autoComplete={mode === 'login' ? 'username' : 'email'}
                      placeholder={mode === 'login' ? identifierLabel : undefined}
                      autoCapitalize="none"
                      {...register('email')}
                    />
                  </div>
                  {errors.email && <span className="field-error">{errors.email.message}</span>}
                </label>
              )}
              {mode === 'reset' && (
                <input type="hidden" {...register('email')} value="reset@example.com" />
              )}
              {mode !== 'forgot' ? (
                <label>
                  <span className={mode === 'login' ? 'sr-only' : undefined}>Password</span>
                  <div className="password-wrap">
                    {mode === 'login' && (
                      <LockKeyhole size={19} className="password-icon" aria-hidden="true" />
                    )}
                    <input
                      type={visible ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder={mode === 'login' ? 'Password' : undefined}
                      {...register('password')}
                    />
                    <button
                      type="button"
                      aria-label={visible ? 'Hide password' : 'Show password'}
                      onClick={() => setVisible(!visible)}
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {errors.password && (
                    <span className="field-error">{errors.password.message}</span>
                  )}
                </label>
              ) : (
                <input type="hidden" {...register('password')} value="unused-password" />
              )}
              {mode === 'register' && (
                <label>
                  Confirm password
                  <input
                    type={visible ? 'text' : 'password'}
                    autoComplete="new-password"
                    {...register('confirm')}
                    required
                  />
                </label>
              )}
              {mode === 'login' && (
                <div className="auth-links">
                  <Link href={`/forgot-password${roleQuery}`}>Forgot password?</Link>
                </div>
              )}
              <button className="primary-button full-width" disabled={!ready || busy}>
                <Busy busy={busy}>
                  {mode === 'login'
                    ? 'Log In'
                    : mode === 'register'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset link'
                        : 'Update password'}
                </Busy>
              </button>
              {seller && mode === 'register' && (
                <p className="help-text">
                  Use an email address for your stall account. After signup, submit your stall
                  details for administrator review.
                </p>
              )}
            </form>
          )}
          <div className="auth-bottom">
            {mode === 'login' ? (
              <>
                <Link
                  className="secondary-button full-width"
                  href={seller ? '/register?role=seller' : '/register'}
                >
                  Create Account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <Link href={seller ? '/login?role=seller' : '/login'}>Sign in</Link>
              </>
            )}
          </div>
          {mode === 'login' && !seller && (
            <div className="auth-bottom">
              <a href="/login?role=seller">Stall Portal</a>
            </div>
          )}
          {seller && (
            <a className="auth-home" href="/login">
              <ArrowLeft size={14} /> Student login
            </a>
          )}
        </div>
      </main>
    </div>
  );
}
