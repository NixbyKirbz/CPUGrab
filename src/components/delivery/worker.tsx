'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { Busy, Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { deliveryLabel, money, time, day } from '@/lib/format';
import { fetchCatalog, rpc } from '@/services/catalog';
import { deliveryAction } from '@/services/delivery';
import { DeliveryCodes, VerifyDeliveryCode } from './codes';
import type { Catalog, Delivery, DeliveryWorker } from '@/types';

function manilaTodayAt(value: FormDataEntryValue | null) {
  if (!value) return null;
  const date = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Manila',
    dateStyle: 'short',
  }).format(new Date());
  return `${date}T${value}:00+08:00`;
}

function manilaClock(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    : '';
}

function useClock() {
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return clock;
}

export function WorkerDashboard() {
  const { user, role, loading, toast } = useSession();
  const client = useQueryClient();
  const [tab, setTab] = useState<'availability' | 'deliveries' | 'earnings'>('deliveries');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const clock = useClock();
  const worker = useQuery({
    queryKey: ['delivery-worker', user?.id],
    enabled: Boolean(user && role === 'student'),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('delivery_workers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as DeliveryWorker | null;
    },
  });
  const approved = worker.data?.review_status === 'approved';
  const jobs = useQuery({
    queryKey: ['worker-deliveries', user?.id],
    enabled: Boolean(user && approved),
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('deliveries')
        .select('*')
        .or(`offered_to.eq.${user!.id},worker_id.eq.${user!.id}`)
        .order('pickup_start')
        .limit(100);
      if (error) throw new Error(error.message);
      return data as Delivery[];
    },
  });
  const catalog = useQuery({
    queryKey: ['catalog'],
    queryFn: fetchCatalog,
    enabled: Boolean(approved),
  });
  const run = async (task: () => Promise<unknown>, result?: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await client.invalidateQueries();
      if (result) toast(result);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (!user || role !== 'student')
    return (
      <Empty title="Student delivery" text="Use your student account to apply for delivery work." />
    );
  if (worker.isPending) return <Loading />;
  if (worker.error) return <ErrorBox error={worker.error} retry={() => void worker.refetch()} />;
  const profile = worker.data;
  if (!profile || profile.review_status === 'declined') {
    return (
      <>
        <PageTitle title="Become a campus delivery worker" back="/student/profile" />
        <section className="panel">
          {profile && (
            <p className="notice">
              An administrator declined your previous application. You can submit updated details.
            </p>
          )}
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  rpc('apply_delivery_worker', {
                    p_contact: form.get('contact'),
                    p_demo_verification: form.get('evidence'),
                  }),
                'Delivery application submitted.',
              );
            }}
          >
            <p>
              We’ll use the name and student number on your existing profile. An administrator must
              approve your application.
            </p>
            <label>
              Contact details
              <input
                name="contact"
                required
                minLength={7}
                maxLength={100}
                defaultValue={profile?.contact}
              />
            </label>
            <label>
              Demo student ID reference
              <input
                name="evidence"
                required
                minLength={3}
                maxLength={120}
                defaultValue={profile?.demo_verification}
                placeholder="Fictional reference for this prototype"
              />
            </label>
            <p className="help-text">
              Use a fictional verification reference. Add your work hours and preferred areas after
              approval.
            </p>
            {Boolean(error) && <ErrorBox error={error} />}
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Submit application</Busy>
            </button>
          </form>
        </section>
      </>
    );
  }
  if (!approved)
    return (
      <>
        <PageTitle title="Campus delivery worker" back="/student/profile" />
        <Empty
          title={
            profile.review_status === 'pending'
              ? 'Your worker application is under review'
              : 'Delivery work is suspended'
          }
          text={
            profile.review_status === 'pending'
              ? 'You can go online and accept deliveries after an administrator approves your application.'
              : 'Contact an administrator for help with your delivery worker account.'
          }
        />
      </>
    );
  const deliveries = jobs.data ?? [];
  const offers = deliveries.filter(
    (job) => job.phase === 'pending' && (!clock || Date.parse(job.offer_expires_at) > clock),
  );
  const visibleOffers = offers.filter(
    (job, index) =>
      !job.group_id || offers.findIndex((other) => other.group_id === job.group_id) === index,
  );
  const active = deliveries.filter(
    (job) =>
      job.worker_id === user.id &&
      ['assigned', 'collected', 'on_the_way', 'arrived', 'handover_issue'].includes(job.phase),
  );
  const completed = deliveries.filter((job) => job.worker_id === user.id && job.settled_at);
  const available = Boolean(
    profile.available_until && (!clock || Date.parse(profile.available_until) > clock),
  );
  const online =
    available &&
    Boolean(profile.available_from && (!clock || Date.parse(profile.available_from) <= clock));
  const names = catalog.data;
  return (
    <>
      <PageTitle
        title="Delivery worker dashboard"
        subtitle={
          online
            ? `Online until ${time(profile.available_until!)}`
            : available
              ? `Scheduled from ${time(profile.available_from!)}`
              : 'Offline'
        }
        back="/student/profile"
      />
      <nav className="inline-actions delivery-tabs" aria-label="Delivery worker dashboard">
        <button
          type="button"
          className="secondary-button"
          aria-pressed={tab === 'availability'}
          onClick={() => setTab('availability')}
        >
          Availability
        </button>
        <button
          type="button"
          className="secondary-button"
          aria-pressed={tab === 'deliveries'}
          onClick={() => setTab('deliveries')}
        >
          Deliveries {visibleOffers.length > 0 && `(${visibleOffers.length})`}
        </button>
        <button
          type="button"
          className="secondary-button"
          aria-pressed={tab === 'earnings'}
          onClick={() => setTab('earnings')}
        >
          Earnings
        </button>
        <Link href="/student/profile" className="secondary-button">
          Profile
        </Link>
      </nav>
      {Boolean(error) && <ErrorBox error={error} />}
      {tab === 'availability' && (
        <section className="panel">
          <form
            className="form-stack"
            key={profile.available_until ?? 'offline'}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(
                () =>
                  rpc('set_delivery_availability', {
                    p_from: manilaTodayAt(form.get('from')),
                    p_until: manilaTodayAt(form.get('until')),
                    p_class: manilaTodayAt(form.get('class')),
                    p_areas: form.getAll('area'),
                  }),
                'Availability saved.',
              );
            }}
          >
            <h2>Work periods</h2>
            <p>
              Times use Manila time today. Offers leave a buffer for travel, and overlapping jobs
              are blocked.
            </p>
            <label>
              Available from (optional)
              <input
                name="from"
                type="time"
                defaultValue={available && !online ? manilaClock(profile.available_from) : ''}
              />
            </label>
            <label>
              Available until
              <input
                name="until"
                type="time"
                defaultValue={available ? manilaClock(profile.available_until) : ''}
                required
              />
            </label>
            <label>
              Next class starts (optional)
              <input
                name="class"
                type="time"
                defaultValue={available ? manilaClock(profile.next_class_at) : ''}
              />
            </label>
            <fieldset className="form-stack">
              <legend>Preferred drop-off points</legend>
              <p className="help-text">Leave all unchecked to accept offers anywhere on campus.</p>
              {names?.locations
                .filter((item) => item.is_delivery_dropoff)
                .map((item) => (
                  <label className="delivery-checkbox" key={item.id}>
                    <input
                      type="checkbox"
                      name="area"
                      value={item.id}
                      defaultChecked={profile.preferred_areas.includes(item.id)}
                    />{' '}
                    {item.name}
                  </label>
                ))}
            </fieldset>
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>{online ? 'Save availability' : 'Go online'}</Busy>
            </button>
            {available && (
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      rpc('set_delivery_availability', {
                        p_until: null,
                        p_class: null,
                        p_areas: profile.preferred_areas,
                      }),
                    'You are offline.',
                  )
                }
              >
                Go offline
              </button>
            )}
          </form>
        </section>
      )}
      {tab === 'deliveries' && (
        <>
          {jobs.isPending && <Loading />}
          {jobs.error && <ErrorBox error={jobs.error} retry={() => void jobs.refetch()} />}
          {!jobs.isPending && !jobs.error && !offers.length && !active.length && (
            <Empty
              title="No current deliveries"
              text={
                online
                  ? 'New offers will appear here when a student checks out.'
                  : 'Go online to receive offers.'
              }
            >
              {!online && (
                <button className="primary-button" onClick={() => setTab('availability')}>
                  Set availability
                </button>
              )}
            </Empty>
          )}
          {(offers.length > 0 || active.length > 0) && (
            <div className="delivery-grid">
              {[...visibleOffers, ...active].map((job) => (
                <WorkerJob
                  key={job.order_id}
                  job={job}
                  groupOrders={
                    job.group_id
                      ? offers.filter((offer) => offer.group_id === job.group_id).length
                      : 0
                  }
                  catalog={names}
                  now={clock}
                  busy={busy}
                  action={(name, value) =>
                    void run(() => deliveryAction(job.order_id, name, value))
                  }
                  refresh={() => void client.invalidateQueries()}
                />
              ))}
            </div>
          )}
        </>
      )}
      {tab === 'earnings' && (
        <section className="panel form-stack">
          <h2>Simulated earnings</h2>
          <strong>
            {money(completed.reduce((sum, job) => sum + job.worker_earnings_centavos, 0))}
          </strong>
          {jobs.error && <ErrorBox error={jobs.error} retry={() => void jobs.refetch()} />}
          {!jobs.isPending && !jobs.error && !completed.length && (
            <p>No completed deliveries yet.</p>
          )}
          {completed.map((job) => (
            <div className="detail-row" key={job.order_id}>
              <span>
                {names?.locations.find((item) => item.id === job.dropoff_id)?.name ??
                  'Campus drop-off'}{' '}
                · {job.settled_at && day(job.settled_at)} · {deliveryLabel[job.phase]}
              </span>
              <strong>{money(job.worker_earnings_centavos)}</strong>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function WorkerJob({
  job,
  groupOrders,
  catalog,
  now,
  busy,
  action,
  refresh,
}: {
  job: Delivery;
  groupOrders: number;
  catalog?: Catalog;
  now: number;
  busy: boolean;
  action: (name: string, value?: string) => void;
  refresh: () => void;
}) {
  const stall = catalog?.stalls.find((item) => item.id === job.stall_id);
  const location = catalog?.locations.find((item) => item.id === job.dropoff_id);
  const waiting = !now || !job.wait_until || Date.parse(job.wait_until) > now;
  return (
    <section className="panel form-stack">
      <h2>{deliveryLabel[job.phase]}</h2>
      {job.group_id && (
        <p>
          Group trip
          {job.phase === 'pending'
            ? ` · ${groupOrders} ${groupOrders === 1 ? 'order' : 'orders'} so far`
            : ''}
        </p>
      )}
      <p>
        <strong>{stall?.name ?? 'Campus stall'}</strong> → {location?.name ?? 'Campus drop-off'}
      </p>
      <p>
        Pickup {time(job.pickup_start)} – {time(job.pickup_end)} · Deliver by{' '}
        {time(job.delivery_until)}
      </p>
      <p>Simulated compensation {money(job.compensation_centavos)}</p>
      {job.recipient_name && <p>Authorized recipient: {job.recipient_name}</p>}
      {job.customer_ready_at && <p>Customer confirmed they can meet you.</p>}
      {job.phase === 'pending' && (
        <>
          <p className="help-text">Offer expires at {time(job.offer_expires_at)}.</p>
          <div className="inline-actions">
            <button
              className="primary-button"
              disabled={busy || (Boolean(job.group_id) && groupOrders < 2)}
              onClick={() => action('accept')}
            >
              Accept delivery
            </button>
            <button className="secondary-button" disabled={busy} onClick={() => action('decline')}>
              Decline
            </button>
          </div>
        </>
      )}
      {job.phase === 'assigned' && <DeliveryCodes orderId={job.order_id} stage="pickup" />}
      {job.phase === 'collected' && (
        <button className="primary-button" disabled={busy} onClick={() => action('start')}>
          Start delivery
        </button>
      )}
      {job.phase === 'on_the_way' && (
        <button className="primary-button" disabled={busy} onClick={() => action('arrive')}>
          Mark arrived
        </button>
      )}
      {job.phase === 'arrived' && waiting && (
        <>
          <p>Wait until {job.wait_until && time(job.wait_until)}.</p>
          <VerifyDeliveryCode orderId={job.order_id} stage="handover" onVerified={refresh} />
        </>
      )}
      {job.phase === 'arrived' && !waiting && (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            action('report_issue', String(new FormData(event.currentTarget).get('attempts')));
          }}
        >
          <label>
            Contact attempts
            <textarea name="attempts" required minLength={3} maxLength={500} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Report customer unavailable
          </button>
        </form>
      )}
      {job.delay_decision === 'pending' &&
        ['assigned', 'collected', 'on_the_way', 'arrived'].includes(job.phase) && (
          <div className="form-stack">
            <p>Customer requests {job.delay_requested_minutes} extra minutes.</p>
            <div className="inline-actions">
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => action('accept_delay')}
              >
                Accept delay
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => action('decline_delay')}
              >
                Decline delay
              </button>
            </div>
          </div>
        )}
    </section>
  );
}
