'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/providers';
import { Busy, ErrorBox } from '@/components/ui';
import { money, time } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';
import { orderSelect } from '@/services/orders';
import { rpc } from '@/services/catalog';
import { useCart } from '@/stores/cart';
import type { Catalog, MenuItem, Order } from '@/types';

type Suggestion = {
  item_id: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  total_centavos: number;
};

export function MealPlanning({ catalog }: { catalog: Catalog }) {
  const { user, toast } = useSession();
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: recent = [] } = useQuery({
    queryKey: ['quick-reorder', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('orders')
        .select(orderSelect)
        .eq('student_id', user!.id)
        .eq('status', 'completed')
        .eq('payment_status', 'paid')
        .order('completed_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data as Order[];
    },
  });

  const reorder = async (order: Order) => {
    setBusy(true);
    try {
      const latest = await getSupabase()
        .from('menu_items')
        .select('*')
        .in(
          'id',
          order.order_items.map((line) => line.menu_item_id),
        );
      if (latest.error) throw latest.error;
      const items = latest.data as MenuItem[];
      const lines = order.order_items.map((line) => ({
        item: items.find(
          (item) =>
            item.id === line.menu_item_id &&
            item.is_available &&
            !item.is_archived &&
            (item.stock_quantity === null || item.stock_quantity >= line.quantity),
        ),
        quantity: line.quantity,
      }));
      if (!lines.length || lines.some((line) => !line.item)) {
        toast('Some items or quantities from this meal are no longer available.');
        return;
      }
      const windows = await rpc('pickup_schedule', { p_stall: order.stall_id });
      const portions = lines.reduce((total, line) => total + line.quantity, 0);
      if (
        !(windows as { availability: string; portions_left: number }[]).some(
          (slot) =>
            slot.availability !== 'full' &&
            slot.availability !== 'unavailable' &&
            slot.portions_left >= portions,
        )
      ) {
        toast('This stall has no available pickup time for that meal today.');
        return;
      }
      const cart = useCart.getState();
      if (cart.lines.length && !window.confirm('Replace your current cart with this meal?')) return;
      cart.clear();
      lines.forEach(({ item, quantity }) => cart.add(item!, quantity));
      router.push('/student/cart');
    } catch (problem) {
      toast(
        problem instanceof Error ? problem.message : 'Could not check availability for this meal.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ marginTop: 24 }}>
      {recent.length > 0 && (
        <>
          <h2>Quick Reorder</h2>
          <ul>
            {recent.map((order) => (
              <li key={order.id}>
                {order.order_items
                  .map((line) => `${line.quantity} × ${line.item_name_snapshot}`)
                  .join(', ')}{' '}
                <button className="text-button" disabled={busy} onClick={() => void reorder(order)}>
                  Reorder
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>Find food for your break</summary>
        <form
          className="form-stack"
          style={{ marginTop: 16 }}
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const start = String(form.get('start'));
            const end = String(form.get('end'));
            setError(null);
            setSuggestions(null);
            if (start >= end) {
              setError(new Error('Choose an end time after your break starts.'));
              return;
            }
            setBusy(true);
            try {
              setSuggestions(
                (await rpc('break_recommendations', {
                  p_start: start,
                  p_end: end,
                  p_budget: Math.round(Number(form.get('budget')) * 100),
                })) as Suggestion[],
              );
            } catch (problem) {
              setError(problem);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Break starts <input name="start" type="time" required />
          </label>
          <label>
            Break ends <input name="end" type="time" required />
          </label>
          <label>
            Budget (₱){' '}
            <input name="budget" type="number" min="1" max="100000" step="0.01" required />
          </label>
          <button className="secondary-button" disabled={busy}>
            <Busy busy={busy}>Find a meal today</Busy>
          </button>
        </form>
        {Boolean(error) && <ErrorBox error={error} />}
        {suggestions?.length === 0 && (
          <p role="status">No meals fit that budget and pickup window today.</p>
        )}
        {Boolean(suggestions?.length) && (
          <ul aria-label="Meals that fit your break">
            {suggestions?.map((suggestion) => {
              const item = catalog.items.find((entry) => entry.id === suggestion.item_id);
              if (!item) return null;
              return (
                <li key={suggestion.item_id}>
                  <Link href={`/student/food/${item.id}`}>{item.name}</Link>
                  {' · '}
                  {time(suggestion.start_time)}–{time(suggestion.end_time)}
                  {' · '}
                  {money(suggestion.total_centavos)} including fees
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}
