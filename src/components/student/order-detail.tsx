'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, QrCode, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getSupabase } from '@/lib/supabase/client';
import { fetchCatalog, rpc } from '@/services/catalog';
import { money, time, day, statusLabel } from '@/lib/format';
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
        <span>Order</span>
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
        <strong>{o.payment_status === 'paid' ? 'Cash received' : 'Cash upon pickup'}</strong>
      </div>
    </>
  );
  return pickup ? (
    <>
      <PageTitle title="Your pickup code" back={`/student/order/${id}`} />
      <section className="panel qr-panel">
        <h2>Good food. One quick scan.</h2>
        <p>Show this QR code at the stall to claim your order. Keep it private.</p>
        {!active ? (
          <span className={`status ${o.status}`}>{statusLabel(o.status)}</span>
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
    <div className="success-page">
      {confirmed && active && (
        <div className="success-icon">
          <Check size={43} />
        </div>
      )}
      <h1>{confirmed && active ? 'Your meal is reserved!' : `Order #${o.order_number}`}</h1>
      <p>
        {confirmed && active
          ? 'One less thing between you and a good break.'
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
      </section>
      {active && (
        <Link className="primary-button full-width" href={`/student/pickup/${id}`}>
          <QrCode size={18} />
          View pickup QR code
        </Link>
      )}
      <Link className="secondary-button full-width" href="/student/orders">
        View my orders
      </Link>
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
