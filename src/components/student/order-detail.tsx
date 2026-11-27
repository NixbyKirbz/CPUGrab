'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, QrCode, RefreshCw } from 'lucide-react';
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
import { PageTitle, Loading, ErrorBox, Empty, Busy } from '@/components/ui';
import { CancelDialog } from '@/components/orders';
import type { Order } from '@/types';
export function OrderDetail({ id, pickup = false }: { id: string; pickup?: boolean }) {
  const { user } = useSession();
  const params = useSearchParams();
  const [cancel, setCancel] = useState(false);
  const query = useQueryClient();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [tokenError, setTokenError] = useState<unknown>(null);
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
        .select('*,order_items(*),pickup_slots(start_time,end_time)')
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
  const canPickUp = active && o.payment_status === 'paid';
  const showConfirmation = !pickup && confirmed && canPickUp;
  const generate = async () => {
    setBusy(true);
    setTokenError(null);
    try {
      setToken(await rpc<string>('issue_pickup_token', { p_order: id }));
    } catch (e) {
      setTokenError(e);
    } finally {
      setBusy(false);
    }
  };
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
    </>
  );
  return pickup ? (
    <>
      <PageTitle title="Your pickup code" back={`/student/order/${id}`} />
      <section className="panel qr-panel">
        <h2>Good food. One quick scan.</h2>
        <p>Show this QR code at the stall to claim your order. Keep it private.</p>
        {!canPickUp ? (
          <span className={`status ${o.status}`}>
            {active ? paymentStatusLabel.unpaid : statusLabel(o.status)}
          </span>
        ) : (
          <>
            {token ? (
              <>
                <div className="qr-code">
                  <QRCodeSVG
                    value={`cpugrab:pickup:${token}`}
                    size={250}
                    level="M"
                    marginSize={2}
                  />
                </div>
                <p className="help-text">
                  Camera unavailable? Let the seller enter this secure code:
                </p>
                <div className="qr-token">{token}</div>
              </>
            ) : (
              <div className="empty-state" style={{ padding: '30px 20px' }}>
                <QrCode size={55} />
                <p>
                  Generate a private pickup code when you’re ready. Generating a new code replaces
                  any earlier one.
                </p>
              </div>
            )}
            {Boolean(tokenError) && <ErrorBox error={tokenError} />}
            <button
              className="primary-button full-width"
              style={{ margin: '20px 0' }}
              disabled={busy}
              onClick={() => void generate()}
            >
              <Busy busy={busy}>
                {token ? (
                  <>
                    <RefreshCw size={16} />
                    Refresh code
                  </>
                ) : (
                  'Generate pickup QR'
                )}
              </Busy>
            </button>
          </>
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
          ? 'Show this QR code at the stall to claim your order.'
          : statusLabel(o.status)}
      </p>
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
    queryFn: () => rpc<string>('issue_pickup_token', { p_order: id }),
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
            value={`cpugrab:pickup:${data}`}
            size={192}
            level="M"
            marginSize={4}
          />
          <details>
            <summary>Manual pickup code</summary>
            <div className="qr-token">{data}</div>
          </details>
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
