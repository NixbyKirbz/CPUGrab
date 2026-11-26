import { createBrowserClient } from '@supabase/ssr';
export const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
export function getSupabase() {
  if (!configured)
    throw new Error('Connect Supabase using .env.local to use accounts and reservations.');
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
