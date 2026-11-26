'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Heart, MapPin, ShoppingBag, Clock3 } from 'lucide-react';
import { fetchCatalog } from '@/services/catalog';
import { configured, getSupabase } from '@/lib/supabase/client';
import { useSession } from '@/components/providers';
import { Loading, ErrorBox, Quantity, Empty } from '@/components/ui';
import { money } from '@/lib/format';
import { useCart } from '@/stores/cart';
import { FoodCard } from './browse';
export function useFavorites() {
  const { user } = useSession();
  return useQuery({
    queryKey: ['favorites', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('favorites')
        .select('*')
        .eq('user_id', user!.id);
      if (error) throw error;
      return data;
    },
  });
}
export function FavoriteButton({
  id,
  kind = 'stall_id',
}: {
  id: string;
  kind?: 'stall_id' | 'menu_item_id';
}) {
  const { user, toast } = useSession();
  const query = useQueryClient();
  const { data = [] } = useFavorites();
  const [busy, setBusy] = useState(false);
  const favorite = data.find((f) => f[kind] === id);
  return (
    <button
      className="icon-button"
      aria-label={favorite ? 'Remove from favorites' : 'Save to favorites'}
      aria-pressed={Boolean(favorite)}
      disabled={busy}
      onClick={async () => {
        if (!configured || !user) {
          toast('Sign in to save your favorites.');
          return;
        }
        setBusy(true);
        try {
          const db = getSupabase();
          const { error } = favorite
            ? await db.from('favorites').delete().eq('id', favorite.id)
            : await db.from('favorites').insert({ user_id: user.id, [kind]: id });
          if (error) throw error;
          await query.invalidateQueries({ queryKey: ['favorites'] });
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not update favorites.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <Heart
        size={23}
        fill={favorite ? '#ffb800' : 'none'}
        color={favorite ? '#b68000' : 'currentColor'}
      />
    </button>
  );
}
export function Menu({ id, food = false }: { id: string; food?: boolean }) {
  const { data, error, isPending } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const [cat, setCat] = useState('all');
  const [quantity, setQuantity] = useState(1);
  const { toast } = useSession();
  const lines = useCart((s) => s.lines);
  if (isPending) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const item = food ? data.items.find((i) => i.id === id) : undefined;
  const stall = data.stalls.find((s) => s.id === (item?.stall_id || id));
  if (!stall || (food && !item))
    return (
      <Empty title="This menu is unavailable" text="The stall may no longer be published.">
        <Link className="primary-button" href="/student/home">
          Explore campus
        </Link>
      </Empty>
    );
  const location = data.locations.find((l) => l.id === stall.location_id);
  const subtotal = lines.reduce((sum, x) => sum + x.price_centavos * x.quantity, 0);
  const count = lines.reduce((sum, x) => sum + x.quantity, 0);
  const add = () => {
    if (!item) return;
    if (!useCart.getState().add(item, quantity)) {
      if (!window.confirm('Replace your current cart with food from this stall?')) return;
      useCart.getState().add(item, quantity, true);
    }
    toast(`${quantity} × ${item.name} added to cart`);
  };
  return (
    <>
      {food && item ? (
        <>
          <Link className="back-link" style={{ marginTop: 25 }} href={`/student/stall/${stall.id}`}>
            ← Back to {stall.name}
          </Link>
          <div className="food-detail">
            <img src={item.image_url} alt={item.name} />
            <div className="food-detail-copy">
              <Link className="eyebrow" href={`/student/stall/${stall.id}`}>
                {stall.name} · {location?.name}
              </Link>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <h1>{item.name}</h1>
                <FavoriteButton id={item.id} kind="menu_item_id" />
              </div>
              <span className={`status-dot ${item.is_available && stall.is_open ? 'open' : ''}`}>
                {!stall.is_open
                  ? 'Stall closed'
                  : item.is_available
                    ? 'Available for pickup'
                    : 'Currently unavailable'}
              </span>
              <p>{item.description}</p>
              <strong>{money(item.price_centavos)}</strong>
              <Quantity value={quantity} onChange={(q) => setQuantity(Math.max(1, q))} />
              <button
                className="primary-button"
                disabled={!item.is_available || !stall.is_open}
                onClick={add}
              >
                <ShoppingBag size={17} />
                Add to cart · {money(item.price_centavos * quantity)}
              </button>
              <p className="help-text">Pickup only. Reservation fee shown at checkout.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="stall-cover" style={{ backgroundImage: `url(${stall.cover_image_url})` }}>
            <Link className="icon-button" href="/student/home" aria-label="Back to home">
              <ArrowLeft size={20} />
            </Link>
          </div>
          <div className="stall-detail-heading">
            <div>
              <p className="eyebrow">CAMPUS FAVORITES</p>
              <h1>{stall.name}</h1>
              <p>
                <MapPin size={14} />
                {location?.name}
                <span>·</span>
                <span className={`status-dot ${stall.is_open ? 'open' : ''}`}>
                  {stall.is_open ? 'Open for reservations' : 'Closed'}
                </span>
              </p>
            </div>
            <FavoriteButton id={stall.id} />
          </div>
          <p>{stall.description}</p>
          <p className="help-text" style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <Clock3 size={14} />
            {stall.opening_hours}
          </p>
          <div className="chips">
            <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>
              All food
            </button>
            {data.categories.map((c) => (
              <button
                className={cat === c.id ? 'active' : ''}
                key={c.id}
                onClick={() => setCat(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="menu-grid">
            {data.items
              .filter((i) => i.stall_id === id && (cat === 'all' || i.category_id === cat))
              .map((i) => (
                <FoodCard key={i.id} item={i} catalog={data} />
              ))}
          </div>
        </>
      )}
      {count > 0 && (
        <Link className="floating-cart" href="/student/cart">
          <ShoppingBag size={20} />
          View cart ({count})<strong>{money(subtotal)}</strong>
        </Link>
      )}
    </>
  );
}
