'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingBag, Banknote, ShieldCheck, Trash2, CalendarDays } from 'lucide-react';
import { useCart } from '@/stores/cart';
import { fetchCatalog, rpc } from '@/services/catalog';
import { money, time, day, cartTotals } from '@/lib/format';
import { useSession } from '@/components/providers';
import { PageTitle, Empty, Quantity, Loading, ErrorBox, Modal, Busy } from '@/components/ui';
import type { Slot } from '@/types';
export function Checkout({ checkout = false }: { checkout?: boolean }) {
  const router = useRouter();
  const { user } = useSession();
  const lines = useCart((s) => s.lines);
  const [hydrated, setHydrated] = useState(false);
  const [slot, setSlot] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setHydrated(true), 0);
    return () => clearTimeout(timer);
  }, []);
  const {
    data,
    isPending,
    error: catalogError,
  } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const stallId = lines[0]?.stall_id;
  const {
    data: slots = [],
    error: slotError,
    refetch: refreshSlots,
  } = useQuery({
    queryKey: ['slots', stallId],
    enabled: Boolean(user && checkout && stallId),
    queryFn: () => rpc<Slot[]>('available_pickup_slots', { p_stall: stallId }),
  });
  if (!hydrated || isPending) return <Loading />;
  if (catalogError || !data) return <ErrorBox error={catalogError} />;
  if (!lines.length)
    return (
      <>
        <PageTitle title="Your cart" />
        <Empty
          title="A good meal is waiting"
          text="Explore campus stalls and add something delicious to your cart."
        >
          <Link className="primary-button" href="/student/home">
            Find your next bite
          </Link>
        </Empty>
      </>
    );
  const stall = data.stalls.find((s) => s.id === stallId);
  const totals = cartTotals(
    lines,
    data.settings.reservation_fee_centavos,
    data.settings.default_markup_centavos,
  );
  const selected = slots.find((s) => s.id === slot);
  const invalid =
    lines.some((l) => {
      const current = data.items.find((i) => i.id === l.id);
      return !current || !current.is_available || current.price_centavos !== l.price_centavos;
    }) || !stall?.is_open;
  const reserve = async () => {
    if (!user || !selected) return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.onLine) throw new Error('Reconnect to confirm your reservation.');
      key.current ??= crypto.randomUUID();
      const id = await rpc<string>('create_reservation', {
        p_stall: stallId,
        p_slot: slot,
        p_items: lines.map((l) => ({ id: l.id, quantity: l.quantity })),
        p_key: key.current,
        p_notes: notes,
      });
      useCart.getState().clear();
      router.push(`/student/order/${id}?confirmed=1`);
    } catch (e) {
      setError(e);
      setConfirm(false);
      void refreshSlots();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title={checkout ? 'One last look. Then lunch.' : 'Your order'}
        subtitle={
          stall
            ? `${stall.name} · ${data.locations.find((l) => l.id === stall.location_id)?.name}`
            : undefined
        }
        back={checkout ? '/student/cart' : `/student/stall/${stallId}`}
      />
      {Boolean(error) && <ErrorBox error={error} />}{' '}
      {invalid && (
        <div className="notice">
          The menu has changed, or the stall is closed.{' '}
          <Link
            href={`/student/stall/${stallId}`}
            className="text-button"
            onClick={() => useCart.getState().clear()}
          >
            Clear cart and review menu →
          </Link>
        </div>
      )}
      <div className="two-col">
        <div>
          <section className="panel">
            <h2>Your campus cravings</h2>
            {lines.map((line) => (
              <div className="cart-line" key={line.id}>
                <img src={line.image_url} alt={line.name} />
                <div>
                  <h3>{line.name}</h3>
                  <strong>{money(line.price_centavos)}</strong>
                  <button
                    aria-label={`Remove ${line.name}`}
                    className="remove"
                    onClick={() => useCart.getState().quantity(line.id, 0)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <Quantity
                  value={line.quantity}
                  onChange={(q) => {
                    useCart.getState().quantity(line.id, q);
                    key.current = null;
                  }}
                />
              </div>
            ))}
          </section>
          {checkout && (
            <section className="panel" style={{ marginTop: 20 }}>
              <h2>Pick a time that works for you</h2>
              {!user ? (
                <div className="notice">Sign in to see available pickup times.</div>
              ) : (
                <>
                  {Boolean(slotError) && (
                    <ErrorBox error={slotError} retry={() => void refreshSlots()} />
                  )}
                  <label>
                    <span style={{ display: 'flex', gap: 7 }}>
                      <CalendarDays size={16} />
                      Pickup schedule · Asia/Manila
                    </span>
                    <select
                      value={slot}
                      onChange={(e) => {
                        setSlot(e.target.value);
                        key.current = null;
                      }}
                      required
                    >
                      <option value="">Choose an available pickup time</option>
                      {slots.map((s) => (
                        <option value={s.id} key={s.id}>
                          {day(s.start_time)} · {time(s.start_time)} – {time(s.end_time)} ·{' '}
                          {s.remaining} left
                        </option>
                      ))}
                    </select>
                  </label>
                  {!slots.length && !slotError && (
                    <p className="help-text" style={{ marginTop: 10 }}>
                      No future pickup slots are open. Please check back or contact the stall.
                    </p>
                  )}
                </>
              )}
              <label style={{ marginTop: 20 }}>
                Notes for the stall (optional)
                <textarea
                  value={notes}
                  maxLength={500}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything the stall should know?"
                />
              </label>
            </section>
          )}
        </div>
        <aside className="panel summary-panel">
          <h2>The details, all clear</h2>
          <div className="detail-row">
            <span>Food subtotal</span>
            <strong>{money(totals.subtotal)}</strong>
          </div>
          <div className="detail-row">
            <span>Reservation fee</span>
            <strong>{money(data.settings.reservation_fee_centavos)}</strong>
          </div>
          <p className="help-text">
            {money(data.settings.stall_fee_share_centavos)} supports the stall ·{' '}
            {money(data.settings.platform_fee_share_centavos)} supports CPUGrab
          </p>
          {totals.adjustment > 0 && (
            <div className="detail-row">
              <span>Food price adjustment</span>
              <strong>{money(totals.adjustment)}</strong>
            </div>
          )}
          <div className="detail-row total-row">
            <span>Total to pay</span>
            <strong>{money(totals.total)}</strong>
          </div>
          <div className="payment-info" style={{ marginTop: 20 }}>
            <Banknote size={24} />
            <div>
              <strong>Cash upon pickup</strong>
              <small>Pay the stall when you claim your meal.</small>
            </div>
          </div>
          {checkout ? (
            user ? (
              <button
                className="primary-button"
                disabled={!selected || invalid || busy}
                onClick={() => setConfirm(true)}
              >
                <ShoppingBag size={17} />
                Reserve order
              </button>
            ) : (
              <Link href="/login" className="primary-button">
                Sign in to reserve
              </Link>
            )
          ) : (
            <Link className="primary-button" href="/student/checkout">
              Choose pickup time →
            </Link>
          )}
          <p className="help-text" style={{ display: 'flex', gap: 5, marginTop: 13 }}>
            <ShieldCheck size={15} />
            Final prices and availability are checked securely before confirmation.
          </p>
        </aside>
      </div>
      {confirm && (
        <Modal
          title="Confirm your reservation"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p style={{ marginBottom: 20, fontSize: 12 }}>
            Your next meal is almost sorted. Check these details before reserving.
          </p>
          <div className="detail-row">
            <span>Stall</span>
            <strong>{stall?.name}</strong>
          </div>
          <div className="detail-row">
            <span>Pickup</span>
            <strong>
              {selected &&
                `${day(selected.start_time)} · ${time(selected.start_time)} – ${time(selected.end_time)}`}
            </strong>
          </div>
          <div className="detail-row total-row">
            <span>Cash at pickup</span>
            <strong>{money(totals.total)}</strong>
          </div>
          <p className="help-text" style={{ margin: '15px 0' }}>
            The server checks the current menu and calculates the final total. No payment is
            collected online.
          </p>
          <button
            className="primary-button full-width"
            disabled={busy}
            onClick={() => void reserve()}
          >
            <Busy busy={busy}>Confirm reservation</Busy>
          </button>
          <button
            className="text-button full-width"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Go back
          </button>
        </Modal>
      )}
    </>
  );
}
