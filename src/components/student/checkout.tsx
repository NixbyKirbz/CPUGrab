'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShoppingBag, Trash2, CalendarDays, CalendarCheck } from 'lucide-react';
import { useCart } from '@/stores/cart';
import { fetchCatalog, rpc } from '@/services/catalog';
import { money, time, cartTotals, paymentMethodLabel } from '@/lib/format';
import { useSession } from '@/components/providers';
import { PageTitle, Empty, Quantity, Loading, ErrorBox, Modal, Busy } from '@/components/ui';
import type { PaymentMethod, Slot } from '@/types';
import { useWalletBalance, WalletCashIn, walletBalanceKey } from './wallet-cash-in';

const paymentMethods = ['wallet', 'gcash'] satisfies PaymentMethod[];

export function Checkout({ checkout = false }: { checkout?: boolean }) {
  const router = useRouter();
  const query = useQueryClient();
  const { user, role } = useSession();
  const lines = useCart((s) => s.lines);
  const [hydrated, setHydrated] = useState(false);
  const [slot, setSlot] = useState('');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [cashIn, setCashIn] = useState(false);
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
  const walletBalance = useWalletBalance(checkout && role === 'student' ? user?.id : undefined);
  const {
    data: slots = [],
    isPending: slotsPending,
    error: slotError,
    refetch: refreshSlots,
  } = useQuery({
    queryKey: ['slots', stallId, user?.id],
    enabled: Boolean(user && checkout && stallId),
    refetchInterval: 30_000,
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
  const location = data.locations.find((l) => l.id === stall?.location_id);
  const totals = cartTotals(
    lines,
    data.settings.reservation_fee_centavos,
    data.settings.default_markup_centavos,
  );
  const selected = slots.find((s) => s.id === slot);
  const walletShort = walletBalance.data !== undefined && walletBalance.data < totals.total;
  const canPay =
    paymentMethod === 'gcash' ||
    (paymentMethod === 'wallet' && walletBalance.isSuccess && !walletShort);
  const invalid =
    lines.some((l) => {
      const current = data.items.find((i) => i.id === l.id);
      return !current || !current.is_available || current.price_centavos !== l.price_centavos;
    }) || !stall?.is_open;
  const reserve = async () => {
    if (!user || !selected || !canPay || !paymentMethod || invalid) return;
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
        p_payment_method: paymentMethod,
        p_total_centavos: totals.total,
      });
      void query.invalidateQueries({ queryKey: walletBalanceKey });
      void query.invalidateQueries({ queryKey: ['orders'] });
      useCart.getState().clear();
      router.push(`/student/order/${id}?confirmed=1`);
    } catch (e) {
      setError(e);
      setConfirm(false);
      void refreshSlots();
      void query.invalidateQueries({ queryKey: ['catalog'] });
      void query.invalidateQueries({ queryKey: walletBalanceKey });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="checkout-page">
      <PageTitle
        title={checkout ? 'Pickup & Payment' : 'Your Order'}
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
            {stall && (
              <div className="cart-stall">
                <img src={stall.image_url} alt="" draggable={false} />
                <div>
                  <h2>{stall.name}</h2>
                  <p>{location?.name}</p>
                </div>
              </div>
            )}
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
        </div>
        <aside className="panel summary-panel">
          <div className="detail-row">
            <span>Subtotal</span>
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
            <span>Total</span>
            <strong>{money(totals.total)}</strong>
          </div>
          {checkout && (
            <section className="pickup-options">
              <h2>Today’s Pickup Times</h2>
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
                      Pickup time · Asia/Manila
                    </span>
                    <select
                      value={slot}
                      onChange={(e) => {
                        setSlot(e.target.value);
                        key.current = null;
                      }}
                      required
                      disabled={slotsPending || !slots.length}
                    >
                      <option value="">
                        {slotsPending ? 'Loading pickup times…' : 'Choose a pickup time'}
                      </option>
                      {slots.map((s) => (
                        <option value={s.id} key={s.id}>
                          {time(s.start_time)} – {time(s.end_time)} · {s.remaining} left
                        </option>
                      ))}
                    </select>
                  </label>
                  {!slots.length && !slotsPending && !slotError && (
                    <p className="help-text" style={{ marginTop: 10 }}>
                      No pickup times are available for today.
                    </p>
                  )}
                </>
              )}
              <label style={{ marginTop: 20 }}>
                Notes for the stall (optional)
                <textarea
                  value={notes}
                  maxLength={500}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    key.current = null;
                  }}
                  placeholder="Anything the stall should know?"
                />
              </label>
            </section>
          )}
          {checkout && user && role === 'student' && (
            <fieldset className="checkout-payment">
              <legend>Payment method</legend>
              {paymentMethods.map((method) => (
                <label className="payment-option" key={method}>
                  <input
                    type="radio"
                    name="payment-method"
                    value={method}
                    checked={paymentMethod === method}
                    disabled={busy}
                    onChange={() => {
                      setPaymentMethod(method);
                      key.current = null;
                    }}
                  />
                  <span>
                    <strong>{paymentMethodLabel[method]}</strong>
                    {method === 'wallet' && walletBalance.data !== undefined && (
                      <small>Balance {money(walletBalance.data)}</small>
                    )}
                  </span>
                </label>
              ))}
              {paymentMethod === 'wallet' && walletBalance.isError && (
                <ErrorBox error={walletBalance.error} retry={() => void walletBalance.refetch()} />
              )}
              {paymentMethod === 'wallet' && walletShort && (
                <p className="notice">Cash in more credits or switch to GCash to continue.</p>
              )}
              <button className="secondary-button full-width" onClick={() => setCashIn(true)}>
                Cash in to wallet
              </button>
              <p className="help-text">Prototype only. Both payment methods are simulated.</p>
            </fieldset>
          )}
          {checkout && !user && (
            <p className="help-text">Sign in to pay with GCash or CPUGrab Wallet.</p>
          )}
          {checkout ? (
            user ? (
              <button
                className="primary-button"
                disabled={!selected || !canPay || invalid || busy}
                onClick={() => setConfirm(true)}
              >
                <ShoppingBag size={17} />
                Review and pay
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
        </aside>
      </div>
      {cashIn && <WalletCashIn onClose={() => setCashIn(false)} />}
      {confirm && paymentMethod && (
        <Modal
          title="Confirm Payment"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="confirm-intro">
            <CalendarCheck size={24} />
            <p>Review your reservation before confirming the simulated payment.</p>
          </div>
          <div className="detail-row">
            <span>Stall</span>
            <strong>{stall?.name}</strong>
          </div>
          <div className="detail-row">
            <span>Location</span>
            <strong>{location?.name}</strong>
          </div>
          <div className="detail-row">
            <span>Pickup Time</span>
            <strong>
              {selected && `Today · ${time(selected.start_time)} – ${time(selected.end_time)}`}
            </strong>
          </div>
          <div className="detail-row total-row">
            <span>Payment method</span>
            <strong>{paymentMethodLabel[paymentMethod]}</strong>
          </div>
          <div className="detail-row total-row">
            <span>Total Payment</span>
            <strong>{money(totals.total)}</strong>
          </div>
          <button
            className="primary-button full-width"
            disabled={busy || !canPay}
            onClick={() => void reserve()}
          >
            <Busy busy={busy}>Pay {money(totals.total)}</Busy>
          </button>
          <button
            className="secondary-button full-width"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Cancel
          </button>
        </Modal>
      )}
    </div>
  );
}
