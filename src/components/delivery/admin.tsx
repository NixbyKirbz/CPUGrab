'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase/client';
import { useSession } from '@/components/providers';
import { Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { deliveryLabel, money, time } from '@/lib/format';
import { fetchCatalog, rpc } from '@/services/catalog';
import type { Delivery, DeliveryWorker } from '@/types';

export function AdminDelivery() {
  const { user, role, toast } = useSession();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const enabled = Boolean(user && role === 'admin');
  const catalog = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog, enabled });
  const dashboard = useQuery({
    queryKey: ['admin-delivery', user?.id],
    enabled,
    refetchInterval: 15_000,
    queryFn: async () => {
      const db = getSupabase();
      const [workers, deliveries] = await Promise.all([
        db.from('delivery_workers').select('*').order('updated_at', { ascending: false }),
        db.from('deliveries').select('*').order('created_at', { ascending: false }).limit(100),
      ]);
      if (workers.error) throw new Error(workers.error.message);
      if (deliveries.error) throw new Error(deliveries.error.message);
      return {
        workers: workers.data as DeliveryWorker[],
        deliveries: deliveries.data as Delivery[],
      };
    },
  });
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await client.invalidateQueries();
      toast(message);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const review = (worker: DeliveryWorker, status: DeliveryWorker['review_status']) =>
    run(
      () => rpc('review_delivery_worker', { p_student: worker.user_id, p_status: status }),
      'Delivery worker review saved.',
    );
  if (!enabled || dashboard.isPending) return <Loading />;
  if (dashboard.error)
    return <ErrorBox error={dashboard.error} retry={() => void dashboard.refetch()} />;
  return (
    <>
      <PageTitle title="Campus deliveries" />
      <div className="inline-actions delivery-tabs">
        <Link className="secondary-button" href="/admin/locations">
          Manage drop-off points
        </Link>
        <Link className="secondary-button" href="/admin/settings">
          Manage fees
        </Link>
      </div>
      {Boolean(error) && <ErrorBox error={error} />}
      <section className="form-stack">
        <h2>Worker applications</h2>
        {!dashboard.data?.workers.length && (
          <Empty title="No worker applications yet" text="Students can apply from their profile." />
        )}
        <div className="delivery-grid">
          {dashboard.data?.workers.map((worker) => (
            <article className="panel form-stack" key={worker.user_id}>
              <h3>
                {worker.full_name} · {worker.review_status}
              </h3>
              <p>Student number {worker.student_number}</p>
              <p>{worker.contact}</p>
              <p>Demo verification {worker.demo_verification}</p>
              <div className="inline-actions">
                {worker.review_status !== 'approved' && (
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void review(worker, 'approved')}
                  >
                    Approve
                  </button>
                )}
                {worker.review_status === 'pending' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void review(worker, 'declined')}
                  >
                    Decline
                  </button>
                )}
                {worker.review_status === 'approved' && (
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void review(worker, 'suspended')}
                  >
                    Suspend
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="form-stack">
        <h2>Latest deliveries</h2>
        {!dashboard.data?.deliveries.length && <p>No campus deliveries yet.</p>}
        {dashboard.data?.deliveries.map((delivery) => (
          <article className="panel form-stack" key={delivery.order_id}>
            <strong>{deliveryLabel[delivery.phase]}</strong>
            <p>
              {catalog.data?.stalls.find((item) => item.id === delivery.stall_id)?.name ??
                'Campus stall'}{' '}
              →{' '}
              {catalog.data?.locations.find((item) => item.id === delivery.dropoff_id)?.name ??
                'Campus drop-off'}
            </p>
            <p>
              Pickup at {time(delivery.pickup_start)} · {money(delivery.compensation_centavos)}{' '}
              simulated worker compensation
            </p>
            {delivery.worker_id && (
              <p>
                Worker:{' '}
                {dashboard.data.workers.find((item) => item.user_id === delivery.worker_id)
                  ?.full_name ?? 'Assigned'}
              </p>
            )}
            {delivery.issue_note && <p>Worker report: {delivery.issue_note}</p>}
            {delivery.phase === 'handover_issue' && (
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(
                    () =>
                      rpc('resolve_delivery_issue', {
                        p_order: delivery.order_id,
                        p_refund: form.has('refund'),
                        p_compensate: form.has('compensate'),
                        p_reason: form.get('reason'),
                      }),
                    'Handover issue resolved.',
                  );
                }}
              >
                <label>
                  Resolution reason
                  <textarea name="reason" required minLength={3} maxLength={500} />
                </label>
                <label className="delivery-checkbox">
                  <input type="checkbox" name="refund" /> Refund original payment
                </label>
                <label className="delivery-checkbox">
                  <input type="checkbox" name="compensate" /> Record simulated worker compensation
                </label>
                <button className="secondary-button" disabled={busy}>
                  Resolve handover issue
                </button>
              </form>
            )}
            <small>Order ID {delivery.order_id}</small>
          </article>
        ))}
      </section>
    </>
  );
}
