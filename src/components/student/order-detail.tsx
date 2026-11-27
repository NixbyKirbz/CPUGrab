'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getSupabase } from '@/lib/supabase/client';
import { fetchCatalog, rpc } from '@/services/catalog';
import {
  money,
  time,
  day,
  statusLabel,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/format';
import { useSession } from '@/components/providers';
import { PageTitle, Loading, ErrorBox, Empty } from '@/components/ui';
import { CancelDialog } from '@/components/orders';
import { orderSelect } from '@/services/orders';
import { CustomerDelivery } from '@/components/delivery/customer';
import { OrderSupport } from '@/components/order-support';
import type { Order } from '@/types';
export function OrderDetail({ id, pickup = false }: { id: string; pickup?: boolean }) {
  const { user } = useSession();
  const params = useSearchParams();
  const [cancel, setCancel] = useState(false);
  const query = useQueryClient();
  const {
    data: o,
    isPending,
    error,
  } = useQuery({
    queryKey: ['orders', id, user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('orders')
        .select(orderSelect)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Order;
    },
  });
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  if (!user)
    return (
      <Empty title="Sign in to view your order" text="Your reservations are private.">
        <Link className="primary-button" href="/login">
          Sign in
        </Link>
      </Empty>
    );
  if (isPending) return <Loading />;
  if (error || !o) return <ErrorBox error={error} />;
  const stall = catalog?.stalls.find((s) => s.id === o.stall_id);
  const active = ['reserved', 'ready'].includes(o.status);
  const confirmed = params.get('confirmed') === '1';
  const canPickUp = active && o.payment_status === 'paid' && !o.delivery;
  const showConfirmation = !pickup && confirmed && canPickUp;
  const details = (
    <>
      <div className="detail-row">
        <span>Order Number</span>
        <strong>#{o.order_number}</strong>
      </div>
      <div className="detail-row">
        <span>Stall</span>
        <strong>{stall?.name}</strong>
      </div>
      <div className="detail-row">
        <span>Location</span>
        <strong>{catalog?.locations.find((l) => l.id === stall?.location_id)?.name}</strong>
      </div>
      <div className="detail-row">
        <span>Pickup</span>
        <strong>
          {day(o.pickup_slots.start_time)}
          <br />
          {time(o.pickup_slots.start_time)} – {time(o.pickup_slots.end_time)}
        </strong>
      </div>
      <div className="detail-row">
        <span>Payment</span>
        <strong>
          {o.payment_status === 'unpaid'
            ? paymentStatusLabel.unpaid
            : `${paymentMethodLabel[o.payment_method]} · ${paymentStatusLabel[o.payment_status]}`}
        </strong>
      </div>
      {o.payment_reference && (
        <div className="detail-row">
          <span>Payment reference</span>
          <small>{o.payment_reference}</small>
        </div>
      )}
      {o.refund_reference && (
        <div className="detail-row">
          <span>Refund reference</span>
          <small>{o.refund_reference}</small>
        </div>
      )}
    </>
  );
  if (pickup && o.delivery)
    return (
      <Empty title="Campus delivery" text="Use the customer handover code on your order.">
        <Link className="primary-button" href={`/student/order/${id}`}>
          View delivery
        </Link>
      </Empty>
    );
  return pickup ? (
    <>
      <PageTitle title="Your pickup code" back={`/student/order/${id}`} />
      <section className="panel qr-panel">
        <h2>Good food. One quick scan.</h2>
        <p>Show your QR or give your six-digit pickup PIN at the stall.</p>
        {!canPickUp ? (
          <span className={`status ${o.status}`}>
            {active ? paymentStatusLabel.unpaid : statusLabel(o.status)}
          </span>
        ) : (
          <ConfirmationCode id={id} userId={user.id} />
        )}
        {details}
      </section>
    </>
  ) : (
    <div className={`success-page ${showConfirmation ? 'reservation-confirmation' : ''}`}>
      {showConfirmation && (
        <>
          <header className="confirmation-title">
            <Link className="icon-button" href="/student/home" aria-label="Back to Home">
              <ArrowLeft size={18} />
            </Link>
            <strong>Reservation Confirmed</strong>
          </header>
          <div className="success-icon">
            <Check size={25} />
          </div>
          <ConfirmationCode id={id} userId={user.id} />
        </>
      )}
      <h1>{showConfirmation ? 'Your Meal is Reserved!' : `Order #${o.order_number}`}</h1>
      <p>
        {showConfirmation
          ? 'Show your QR or give your six-digit pickup PIN at the stall.'
          : statusLabel(o.status)}
      </p>
      {o.delivery && (
        <CustomerDelivery
          delivery={o.delivery}
          dropoff={catalog?.locations.find((item) => item.id === o.delivery?.dropoff_id)?.name}
        />
      )}
      <section className="panel">
        {details}
        <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', margin: '13px 0' }} />
        {o.order_items.map((i, n) => (
          <div className="detail-row" key={n}>
            <span>
              {i.item_name_snapshot} × {i.quantity}
            </span>
            <strong>{money(i.subtotal_centavos)}</strong>
          </div>
        ))}
        <div className="detail-row">
          <span>Reservation fee</span>
          <strong>{money(o.reservation_fee_centavos)}</strong>
        </div>
        {o.delivery && (
          <div className="detail-row">
            <span>Campus delivery fee</span>
            <strong>{money(o.delivery_fee_centavos)}</strong>
          </div>
        )}
        {o.reward_discount_centavos > 0 && (
          <div className="detail-row">
            <span>Promotional discount</span>
            <strong>−{money(o.reward_discount_centavos)}</strong>
          </div>
        )}
        <div className="detail-row total-row">
          <span>Total</span>
          <strong>{money(o.total_centavos)}</strong>
        </div>
        {o.customer_notes && (
          <p className="help-text" style={{ marginTop: 13 }}>
            Notes: {o.customer_notes}
          </p>
        )}
        {o.cancellation_reason && <p className="notice">Cancelled: {o.cancellation_reason}</p>}
        {active && o.payment_status === 'unpaid' && (
          <p className="notice">
            This reservation predates online checkout. Cancel it or contact the stall, then place a
            new reservation with GCash or CPUGrab Wallet.
          </p>
        )}
      </section>
      {canPickUp && !showConfirmation && (
        <Link className="primary-button full-width" href={`/student/pickup/${id}`}>
          <QrCode size={18} />
          View pickup QR code
        </Link>
      )}
      <Link
        className={`${showConfirmation ? 'primary-button' : 'secondary-button'} full-width`}
        href="/student/orders"
      >
        View My Orders
      </Link>
      {showConfirmation && (
        <Link className="secondary-button full-width" href="/student/home">
          Back to Home
        </Link>
      )}
      {o.status === 'reserved' && (
        <button className="text-button" style={{ marginTop: 15 }} onClick={() => setCancel(true)}>
          Cancel reservation
        </button>
      )}
      <OrderSupport orderId={o.id} order={o} />
      {cancel && (
        <CancelDialog
          order={o}
          onClose={() => {
            setCancel(false);
            void query.invalidateQueries({ queryKey: ['orders'] });
          }}
        />
      )}
    </div>
  );
}

function ConfirmationCode({ id, userId }: { id: string; userId: string }) {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['confirmation-pickup-code', userId, id],
    queryFn: () => rpc<{ token: string; pin: string }>('issue_pickup_credentials', { p_order: id }),
    staleTime: 'static',
    gcTime: 0,
    retry: false,
  });
  return (
    <div className="confirmation-code">
      {data ? (
        <>
          <QRCodeSVG
            title="Pickup QR code"
            value={`cpugrab:pickup:${data.token}`}
            size={192}
            level="M"
            marginSize={4}
          />
          <p className="eyebrow">Pickup PIN</p>
          <div className="qr-token">
            {data.pin.slice(0, 3)} {data.pin.slice(3)}
          </div>
        </>
      ) : error ? (
        <ErrorBox error="Could not load your pickup code." retry={() => void refetch()} />
      ) : (
        <p role="status">
          {isFetching ? 'Loading pickup code…' : 'Reconnect to load your pickup code.'}
        </p>
      )}
    </div>
  );
}
