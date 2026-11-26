'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CalendarDays, Check, QrCode, Banknote } from 'lucide-react';
import { fetchOrders } from '@/services/orders';
import { fetchCatalog, rpc } from '@/services/catalog';
import { money, time, day, statusLabel } from '@/lib/format';
import { useSession } from './providers';
import { PageTitle, Loading, ErrorBox, Empty, Modal, Busy } from './ui';
import type { Order, OrderStatus } from '@/types';
export function CancelDialog({ order, onClose }: { order: Order; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const query = useQueryClient();
  return (
    <Modal
      title="Cancel reservation"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await rpc('cancel_order', {
              p_order: order.id,
              p_reason: reason === 'Other' ? other : reason,
            });
            await query.invalidateQueries({ queryKey: ['orders'] });
            onClose();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="help-text">Please tell us why you’re cancelling #{order.order_number}.</p>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Select a reason</option>
            {[
              'Food item unavailable',
              'Stall is closing',
              'Unable to fulfill reservation',
              'Customer request',
              'Payment issue',
              'Other',
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        {reason === 'Other' && (
          <label>
            Explanation
            <textarea
              value={other}
              onChange={(e) => setOther(e.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
        )}
        {Boolean(error) && <ErrorBox error={error} />}
        <button className="danger-button" disabled={busy}>
          <Busy busy={busy}>Confirm cancellation</Busy>
        </button>
      </form>
    </Modal>
  );
}
export function Orders({ seller = false, stall }: { seller?: boolean; stall?: string }) {
  const { user, toast } = useSession();
  const query = useQueryClient();
  const [tab, setTab] = useState<string>(seller ? 'reserved' : 'upcoming');
  const [cancel, setCancel] = useState<Order | null>(null);
  const [busy, setBusy] = useState('');
  const {
    data: orders = [],
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ['orders', user?.id, stall],
    enabled: Boolean(user && (!seller || stall)),
    queryFn: () => fetchOrders(stall),
  });
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  if (!user)
    return (
      <>
        <PageTitle title="My orders" />
        <Empty
          title="Your meals, in one place"
          text="Sign in to see your reservations and pickup codes."
        >
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        </Empty>
      </>
    );
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} retry={() => void refetch()} />;
  const tabs = seller
    ? [
        ['reserved', 'Pending'],
        ['ready', 'Ready for pickup'],
        ['completed', 'Completed'],
        ['cancelled', 'Cancelled'],
      ]
    : [
        ['upcoming', 'Upcoming'],
        ['completed', 'Completed'],
        ['cancelled', 'Cancelled'],
      ];
  const filtered = orders
    .filter((o) =>
      tab === 'upcoming' ? ['reserved', 'ready'].includes(o.status) : o.status === tab,
    )
    .sort(
      (a, b) =>
        new Date(a.pickup_slots.start_time).getTime() -
        new Date(b.pickup_slots.start_time).getTime(),
    );
  return (
    <>
      <PageTitle
        title={seller ? 'Your reservations' : 'My orders'}
        subtitle={
          seller
            ? 'A quick look. A simple action. Back to serving.'
            : 'Your next meal is something to look forward to.'
        }
        action={
          seller ? (
            <Link className="primary-button" href="/seller/scanner">
              <QrCode size={17} />
              Scan pickup
            </Link>
          ) : undefined
        }
      />
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}{' '}
            {orders.filter((o) =>
              id === 'upcoming' ? ['reserved', 'ready'].includes(o.status) : o.status === id,
            ).length > 0 &&
              `(${orders.filter((o) => (id === 'upcoming' ? ['reserved', 'ready'].includes(o.status) : o.status === id)).length})`}
          </button>
        ))}
      </div>
      {!filtered.length ? (
        <Empty
          title={
            tab === 'upcoming'
              ? 'No upcoming reservations'
              : `No ${tab === 'reserved' ? 'pending' : tab} orders`
          }
          text={
            seller
              ? 'New reservations will appear here automatically.'
              : 'Find your next favorite meal and reserve a spot in your day.'
          }
        >
          {!seller && (
            <Link href="/student/home" className="primary-button">
              Explore campus food
            </Link>
          )}
        </Empty>
      ) : (
        <div className="order-grid">
          {filtered.map((o) => (
            <article className="order-card" key={o.id}>
              <div className="order-card-head">
                <h3>#{o.order_number}</h3>
                <span className={`status ${o.status}`}>{statusLabel(o.status as OrderStatus)}</span>
              </div>
              <h4>{catalog?.stalls.find((s) => s.id === o.stall_id)?.name}</h4>
              <ul>
                {o.order_items.map((i, n) => (
                  <li key={n}>
                    {i.item_name_snapshot} × {i.quantity}
                  </li>
                ))}
              </ul>
              <div className="detail-row">
                <span>
                  <Banknote size={14} style={{ display: 'inline', marginRight: 5 }} />
                  {o.payment_status === 'paid' ? 'Cash received' : 'Cash at pickup'}
                </span>
                <strong>{money(o.total_centavos)}</strong>
              </div>
              <div className="order-pickup">
                <CalendarDays size={16} />
                {day(o.pickup_slots.start_time)} · {time(o.pickup_slots.start_time)} –{' '}
                {time(o.pickup_slots.end_time)}
              </div>
              {o.cancellation_reason && (
                <p className="help-text" style={{ marginTop: 12 }}>
                  Cancellation reason: {o.cancellation_reason}
                </p>
              )}
              {o.completed_at && (
                <p className="help-text" style={{ marginTop: 12 }}>
                  Picked up {day(o.completed_at)} at {time(o.completed_at)}
                </p>
              )}
              <div className="order-actions">
                {seller ? (
                  ['reserved', 'ready'].includes(o.status) && (
                    <>
                      {o.status === 'reserved' && (
                        <button
                          className="ready-button"
                          disabled={busy === o.id}
                          onClick={async () => {
                            setBusy(o.id);
                            try {
                              await rpc('mark_order_ready', { p_order: o.id });
                              await query.invalidateQueries({ queryKey: ['orders'] });
                            } catch (e) {
                              toast(e instanceof Error ? e.message : 'Could not update order.');
                            } finally {
                              setBusy('');
                            }
                          }}
                        >
                          <Check size={15} />
                          Mark as ready
                        </button>
                      )}
                      <button className="danger-button" onClick={() => setCancel(o)}>
                        Cancel
                      </button>
                    </>
                  )
                ) : (
                  <>
                    <Link className="secondary-button" href={`/student/order/${o.id}`}>
                      View details
                    </Link>
                    {['reserved', 'ready'].includes(o.status) && (
                      <Link className="primary-button" href={`/student/pickup/${o.id}`}>
                        <QrCode size={15} />
                        Pickup code
                      </Link>
                    )}
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {cancel && <CancelDialog order={cancel} onClose={() => setCancel(null)} />}
    </>
  );
}
