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
import { useRewards } from './rewards';

const paymentMethods = ['wallet', 'gcash'] satisfies PaymentMethod[];

export function Checkout({ checkout = false }: { checkout?: boolean }) {
  const router = useRouter();
  const query = useQueryClient();
  const { user, role } = useSession();
  const lines = useCart((s) => s.lines);
  const [hydrated, setHydrated] = useState(false);
  const [slot, setSlot] = useState('');
  const [fulfillment, setFulfillment] = useState('');
  const [deliveryMode, dropoff] = fulfillment.split(':');
  const groupDelivery = deliveryMode === 'group';
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [cashIn, setCashIn] = useState(false);
  const [rewardId, setRewardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef<string | null>(null);
  const simulationKey = useRef<string | null>(null);
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
  const rewards = useRewards(checkout && role === 'student' ? user?.id : undefined);
  const participating = data?.stalls.some(
    (stall) => stall.id === stallId && stall.delivery_enabled,
  );
  const deliveryOptions = useQuery({
    queryKey: ['delivery-options', user?.id, stallId, slot],
    enabled: Boolean(user && checkout && participating && slot),
    queryFn: async () => {
      const [individual, group] = await Promise.all([
        rpc<string[]>('delivery_options', { p_stall: stallId, p_slot: slot }),
        rpc<string[]>('delivery_options', { p_stall: stallId, p_slot: slot, p_group: true }),
      ]);
      return { individual, group };
    },
    refetchInterval: 15_000,
  });
  const {
    data: slots = [],
    isPending: slotsPending,
    error: slotError,
    refetch: refreshSlots,
  } = useQuery({
    queryKey: ['slots', stallId, user?.id],
    enabled: Boolean(user && checkout && stallId),
    refetchInterval: 30_000,
    queryFn: () => rpc<Slot[]>('pickup_schedule', { p_stall: stallId }),
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
  const portions = lines.reduce((sum, line) => sum + line.quantity, 0);
  const canUseSlot = (period: Slot) =>
    (period.availability === 'available' || period.availability === 'limited') &&
    (period.portions_left ?? 0) >= portions;
  const selected = slots.find((s) => s.id === slot && canUseSlot(s));
  const individualFee = data.settings.delivery_fee_centavos ?? 0;
  const groupFee = data.settings.group_delivery_fee_centavos ?? 0;
  const deliveryFee = groupDelivery ? groupFee : individualFee;
  const hasDelivery = Boolean(
    deliveryOptions.data?.individual.length || deliveryOptions.data?.group.length,
  );
  const fullPrice = totals.total + (dropoff ? deliveryFee : 0);
  const availableRewards =
    rewards.data?.available.filter((reward) => reward.amount_centavos < fullPrice) ?? [];
  const appliedReward = availableRewards.find((reward) => reward.id === rewardId);
  const total = fullPrice - (appliedReward?.amount_centavos ?? 0);
  const validFulfillment =
    !dropoff ||
    Boolean(
      (groupDelivery ? deliveryOptions.data?.group : deliveryOptions.data?.individual)?.includes(
        dropoff,
      ),
    );
  const selectedDropoff = data.locations.find((item) => item.id === dropoff);
  const walletShort = walletBalance.data !== undefined && walletBalance.data < total;
  const canPay =
    paymentMethod === 'gcash' ||
    (paymentMethod === 'wallet' && walletBalance.isSuccess && !walletShort);
  const invalid =
    lines.some((l) => {
      const current = data.items.find((i) => i.id === l.id);
      return (
        !current ||
        !current.is_available ||
        current.price_centavos !== l.price_centavos ||
        (current.stock_quantity !== null && current.stock_quantity < l.quantity)
      );
    }) ||
    !stall?.is_open ||
    stall.reservation_mode === 'paused';
  const reserve = async () => {
    if (!user || !selected || !canPay || !paymentMethod || invalid || !validFulfillment) return;
    setBusy(true);
    setError(null);
    try {
      if (!navigator.onLine) throw new Error('Reconnect to confirm your reservation.');
      key.current ??= crypto.randomUUID();
      const endpoint = appliedReward
        ? 'create_reward_reservation'
        : dropoff
          ? 'create_delivery_reservation'
          : 'create_reservation';
      const id = await rpc<string>(endpoint, {
        p_stall: stallId,
        p_slot: slot,
        p_items: lines.map((l) => ({ id: l.id, quantity: l.quantity })),
        p_key: key.current,
        p_notes: notes,
        p_payment_method: paymentMethod,
        p_total_centavos: total,
        ...(dropoff || appliedReward ? { p_dropoff: dropoff || null, p_group: groupDelivery } : {}),
        ...(appliedReward ? { p_reward: appliedReward.id } : {}),
      });
      void query.invalidateQueries({ queryKey: walletBalanceKey });
      void query.invalidateQueries({ queryKey: ['rewards'] });
      void query.invalidateQueries({ queryKey: ['orders'] });
      useCart.getState().clear();
      router.push(`/student/order/${id}?confirmed=1`);
    } catch (e) {
      setError(e);
      setConfirm(false);
      void refreshSlots();
      void query.invalidateQueries({ queryKey: ['delivery-options'] });
      void query.invalidateQueries({ queryKey: ['catalog'] });
      void query.invalidateQueries({ queryKey: walletBalanceKey });
      void query.invalidateQueries({ queryKey: ['rewards'] });
    } finally {
      setBusy(false);
    }
  };
  const simulateUnpaid = async (status: 'failed' | 'cancelled') => {
    setBusy(true);
    try {
      simulationKey.current ??= crypto.randomUUID();
      const reference = await rpc<string>('record_gcash_attempt', {
        p_key: simulationKey.current,
        p_amount: total,
        p_status: status,
      });
      simulationKey.current = null;
      setConfirm(false);
      setError(
        new Error(
          `Simulated GCash payment ${status}. Your cart is ready to retry. Reference ${reference}.`,
        ),
      );
    } catch (error) {
      setError(error);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="checkout-page">
      <PageTitle
        title={checkout ? 'Order Options & Payment' : 'Your Order'}
        back={checkout ? '/student/cart' : `/student/stall/${stallId}`}
      />
      {Boolean(error) && <ErrorBox error={error} />}{' '}
      {stall?.reservation_mode === 'paused' && (
        <p className="notice">Online reservations are temporarily paused at this stall.</p>
      )}
      {stall?.reservation_mode === 'busy' && (
        <p className="notice">This stall has limited pickup slots while busy.</p>
      )}
      {invalid && stall?.reservation_mode !== 'paused' && (
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
          {dropoff && (
            <div className="detail-row">
              <span>Campus delivery fee</span>
              <strong>{money(deliveryFee)}</strong>
            </div>
          )}
          {availableRewards.length > 0 && (
            <label>
              CPUGrab reward
              <select
                value={appliedReward?.id ?? ''}
                onChange={(event) => {
                  setRewardId(event.target.value);
                  key.current = null;
                }}
              >
                <option value="">Pay without a reward</option>
                {availableRewards.map((reward) => (
                  <option key={reward.id} value={reward.id}>
                    Apply {money(reward.amount_centavos)} discount
                  </option>
                ))}
              </select>
            </label>
          )}
          {appliedReward && (
            <div className="detail-row">
              <span>Promotional discount</span>
              <strong>−{money(appliedReward.amount_centavos)}</strong>
            </div>
          )}
          <div className="detail-row total-row">
            <span>Total</span>
            <strong>{money(total)}</strong>
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
                        setFulfillment('');
                        key.current = null;
                      }}
                      required
                      disabled={slotsPending || !slots.length}
                    >
                      <option value="">
                        {slotsPending ? 'Loading pickup times…' : 'Choose a pickup time'}
                      </option>
                      {slots.map((s) => (
                        <option value={s.id} key={s.id} disabled={!canUseSlot(s)}>
                          {time(s.start_time)} – {time(s.end_time)} ·{' '}
                          {s.availability === 'unavailable'
                            ? 'Unavailable'
                            : s.availability === 'full'
                              ? 'Fully booked'
                              : !canUseSlot(s)
                                ? 'Too few portions'
                                : `${s.remaining} orders · ${s.portions_left} portions left`}
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
              {slot && (hasDelivery || Boolean(dropoff)) && (
                <label style={{ marginTop: 20 }}>
                  How will you receive your order?
                  <select
                    value={fulfillment}
                    onChange={(event) => {
                      setFulfillment(event.target.value);
                      key.current = null;
                    }}
                  >
                    <option value="">Self-pickup</option>
                    {!validFulfillment && (
                      <option value={fulfillment} disabled>
                        Delivery no longer available
                      </option>
                    )}
                    {data.locations
                      .filter((location) => deliveryOptions.data?.individual.includes(location.id))
                      .map((location) => (
                        <option key={location.id} value={`individual:${location.id}`}>
                          Delivery to {location.name} · +{money(individualFee)}
                        </option>
                      ))}
                    {data.locations
                      .filter((location) => deliveryOptions.data?.group.includes(location.id))
                      .map((location) => (
                        <option key={`group:${location.id}`} value={`group:${location.id}`}>
                          Group delivery to {location.name} · +{money(groupFee)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {participating && slot && deliveryOptions.isSuccess && !hasDelivery && (
                <p className="help-text">
                  Campus delivery is unavailable for this time. Choose self-pickup or another time.
                </p>
              )}
              {dropoff && validFulfillment && (
                <p className="notice">
                  {groupDelivery
                    ? 'At least two students must book the same stall, slot, and drop-off. You’ll receive an automatic simulated refund if the group fails to form or no worker accepts within the offer window.'
                    : 'Delivery is confirmed when a worker accepts. If nobody accepts within three minutes, your simulated payment will be refunded automatically.'}
                </p>
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
                disabled={!selected || !canPay || invalid || busy || !validFulfillment}
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
          title={
            paymentMethod === 'gcash' ? 'GCash Payment · Simulation' : 'Confirm Wallet Payment'
          }
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="confirm-intro">
            <CalendarCheck size={24} />
            <p>Review your reservation before confirming the simulated payment to CPUGrab.</p>
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
            <span>Fulfillment</span>
            <strong>
              {selectedDropoff
                ? `${groupDelivery ? 'Group delivery' : 'Delivery'} to ${selectedDropoff.name}`
                : 'Self-pickup'}
            </strong>
          </div>
          <div className="detail-row total-row">
            <span>Total Payment</span>
            <strong>{money(total)}</strong>
          </div>
          <button
            className="primary-button full-width"
            disabled={busy || !canPay || !validFulfillment}
            onClick={() => void reserve()}
          >
            <Busy busy={busy}>Pay {money(total)}</Busy>
          </button>
          {paymentMethod === 'gcash' && (
            <button
              className="text-button full-width"
              disabled={busy}
              onClick={() => void simulateUnpaid('failed')}
            >
              Test a failed payment
            </button>
          )}
          <button
            className="secondary-button full-width"
            disabled={busy}
            onClick={() =>
              paymentMethod === 'gcash' ? void simulateUnpaid('cancelled') : setConfirm(false)
            }
          >
            Cancel
          </button>
        </Modal>
      )}
    </div>
  );
}
