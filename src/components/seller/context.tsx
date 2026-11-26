'use client';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { getSupabase } from '@/lib/supabase/client';
import type { Stall } from '@/types';
export function useStall() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['seller-stall', user?.id],
    enabled: Boolean(user),
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
