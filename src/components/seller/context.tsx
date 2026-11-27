'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { getSupabase } from '@/lib/supabase/client';
import type { Stall } from '@/types';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { Empty, ErrorBox, Loading } from '@/components/ui';
export function useStall() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['seller-stall', user?.id],
    enabled: Boolean(user),
    refetchInterval: (query) => (query.state.data?.approval_status === 'pending' ? 10_000 : false),
    queryFn: async () => {
      const db = getSupabase();
      const own = await db
        .from('stalls')
        .select('*')
        .eq('owner_id', user!.id)
        .limit(1)
        .maybeSingle();
      if (own.error) throw own.error;
      if (own.data) return own.data as Stall;
      const member = await db
        .from('stall_members')
        .select('stall_id')
        .eq('user_id', user!.id)
        .limit(1)
        .maybeSingle();
      if (member.error) throw member.error;
      if (!member.data) return null;
      const { data, error } = await db
        .from('stalls')
        .select('*')
        .eq('id', member.data.stall_id)
        .single();
      if (error) throw error;
      return data as Stall;
    },
  });
}

export function SellerAccess({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const stall = useStall();
  if (user && stall.data?.approval_status === 'approved') {
    return <Shell role="seller">{children}</Shell>;
  }
  return (
    <main id="main-content" className="main-content app-layout" style={{ maxWidth: 620 }}>
      <Link href="/" aria-label="CPUGrab home" className="brand">
        <img src="/brand/logo.png" alt="CPUGrab" width="170" height="57" />
      </Link>
      {loading || (user && stall.isPending) ? (
        <Loading />
      ) : stall.error ? (
        <ErrorBox error={stall.error} retry={() => void stall.refetch()} />
      ) : !user ? (
        <Empty title="Stall Portal" text="Sign in to continue.">
          <Link className="primary-button" href="/login?role=seller">
            Sign in
          </Link>
        </Empty>
      ) : !stall.data ? (
        <Empty title="Set up your stall" text="Submit your stall details for administrator review.">
          <Link className="primary-button" href="/register/stall">
            Apply for a stall
          </Link>
        </Empty>
      ) : (
        <Empty
          title={
            stall.data.approval_status === 'pending'
              ? 'Your stall application is under review'
              : 'Your stall is suspended'
          }
          text={
            stall.data.approval_status === 'pending'
              ? `${stall.data.name} is waiting for administrator approval. This page will update when your application is approved.`
              : 'Contact an administrator for help with your stall.'
          }
        >
          <Link className="secondary-button" href="/student/profile">
            Your account
          </Link>
        </Empty>
      )}
    </main>
  );
}
