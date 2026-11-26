'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Check, Plus, Info, CheckCircle2, XCircle } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { rpc } from '@/services/catalog';
import { money } from '@/lib/format';
import { useSession } from '@/components/providers';
import { PageTitle, Loading, ErrorBox, Empty } from '@/components/ui';
import { useStall } from './context';
import type { MenuItem, Category } from '@/types';
export function SellerMenu() {
  const { data: stall } = useStall();
  const { toast } = useSession();
  const query = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [cat, setCat] = useState('all');
  const [busy, setBusy] = useState<string[]>([]);
  const {
    data: items = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ['seller-menu', stall?.id],
    enabled: Boolean(stall),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('menu_items')
        .select('*')
        .eq('stall_id', stall!.id)
        .eq('is_archived', false)
        .order('created_at');
      if (error) throw error;
      return data as MenuItem[];
    },
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('categories')
        .select('*')
        .order('display_order');
      if (error) throw error;
      return data as Category[];
    },
  });
  const toggle = async (item: MenuItem) => {
    setBusy((x) => [...x, item.id]);
    await query.cancelQueries({ queryKey: ['seller-menu', stall?.id] });
    const previous = query.getQueryData(['seller-menu', stall?.id]);
    query.setQueryData(
      ['seller-menu', stall?.id],
      items.map((i) => (i.id === item.id ? { ...i, is_available: !i.is_available } : i)),
    );
    try {
      await rpc('update_menu_availability', { p_item: item.id, p_available: !item.is_available });
    } catch (e) {
      query.setQueryData(['seller-menu', stall?.id], previous);
      toast(e instanceof Error ? e.message : 'Could not update availability.');
    } finally {
      setBusy((x) => x.filter((id) => id !== item.id));
      await query.invalidateQueries({ queryKey: ['seller-menu'] });
      await query.invalidateQueries({ queryKey: ['catalog'] });
    }
  };
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!stall || stall.approval_status !== 'approved')
    return (
      <Empty
        title="Stall approval required"
        text="Your menu will be available after your stall is approved."
      />
    );
  return (
    <div className="seller-menu-page">
      <PageTitle
        title="Menu Management"
        back="/seller/dashboard"
        action={
          <button
            className={edit ? 'gold-button' : 'secondary-button'}
            style={{ marginTop: 0 }}
            onClick={() => setEdit(!edit)}
          >
            {edit ? <Check size={16} /> : <Pencil size={16} />} {edit ? 'Done' : 'Edit'}
          </button>
        }
      />
      <div className="chips">
        <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>
          All
        </button>
        {categories.map((c) => (
          <button key={c.id} className={cat === c.id ? 'active' : ''} onClick={() => setCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="seller-menu">
        {items
          .filter((i) => cat === 'all' || i.category_id === cat)
          .map((item) => (
            <article key={item.id} className="seller-menu-card">
              <Link
                href={`/seller/menu/${item.id}/edit`}
                className="seller-menu-image"
                style={edit ? undefined : { display: 'none' }}
                aria-label={`Edit ${item.name}`}
              >
                <img src={item.image_url} alt={item.name} />
                <span className="pencil">
                  <Pencil size={23} />
                </span>
              </Link>
              {!edit && (
                <button
                  className="seller-menu-image"
                  onClick={() => void toggle(item)}
                  disabled={busy.includes(item.id)}
                  aria-label={`${item.is_available ? 'Make unavailable' : 'Make available'}: ${item.name}`}
                  aria-pressed={item.is_available}
                >
                  <img
                    src={item.image_url}
                    alt={item.name}
                    style={{
                      filter: item.is_available ? 'none' : 'grayscale(1)',
                      opacity: item.is_available ? 1 : 0.65,
                    }}
                  />
                </button>
              )}
              <div>
                <h3>{item.name}</h3>
                <strong>{money(item.price_centavos)}</strong>
                <span className={`availability-label ${item.is_available ? '' : 'off'}`}>
                  {item.is_available ? <CheckCircle2 size={11} /> : <XCircle size={11} />}{' '}
                  {item.is_available ? 'Available' : 'Unavailable'}
                </span>
              </div>
            </article>
          ))}
      </div>
      {!items.length && (
        <Empty
          title="Your menu is a fresh start"
          text="Add your first item to give students something to look forward to."
        />
      )}
      <Link
        href="/seller/menu/new"
        className="gold-button full-width"
        style={{ fontSize: 13, marginTop: 25 }}
      >
        <Plus size={20} />
        Add New Item
      </Link>
      <p className="menu-help">
        <Info size={18} />
        {edit
          ? 'Tap a food picture to edit its name, price, photo, description, or category. Press Done to return to availability mode.'
          : 'Tap a food picture to change its availability. Gray means unavailable. Tap again to make it available.'}
      </p>
    </div>
  );
}
