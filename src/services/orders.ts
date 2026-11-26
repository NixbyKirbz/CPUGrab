import { getSupabase } from '@/lib/supabase/client';
import type { Order } from '@/types';
export async function fetchOrders(stall?: string): Promise<Order[]> {
  let q = getSupabase()
    .from('orders')
    .select('*,order_items(*),pickup_slots(start_time,end_time)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (stall) q = q.eq('stall_id', stall);
  const { data, error } = await q;
  if (error) throw error;
  return data as Order[];
}
