'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { useStall } from './context';
import { getSupabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/upload';
import { rpc } from '@/services/catalog';
import { useSession } from '@/components/providers';
import { PageTitle, ErrorBox, Loading, Busy, Empty } from '@/components/ui';
import { foodHandlingStandards, StallVerification } from '@/components/stall-verification';
import { Install } from '@/components/install';
import { day, time } from '@/lib/format';
import type { Location } from '@/types';
export function StallApplication() {
  const { user, loading } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('locations')
        .select('*')
        .eq('is_active', true)
        .order('display_order');
      if (error) throw error;
      return data as Location[];
    },
  });
  if (loading) return <Loading />;
  if (!user)
    return (
      <Empty title="Continue to Stall Portal" text="Sign in to continue your stall application.">
        <Link className="primary-button" href="/login?role=seller">
          Sign in to Stall Portal
        </Link>
      </Empty>
    );
  return (
    <>
      <PageTitle
        title="Let’s meet your stall."
        subtitle="Tell us a little about your food. We’ll take care of the queue."
      />
      <section className="panel" style={{ maxWidth: 650 }}>
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const f = new FormData(e.currentTarget);
              const image = await uploadImage(f.get('image') as File, user.id);
              const stallId = await rpc<string>('register_seller', {
                p_name: String(f.get('name')).trim(),
                p_location: f.get('location'),
                p_contact: f.get('contact'),
                p_image: image,
              });
              await rpc('accept_stall_standards', { p_stall: stallId });
              window.location.replace('/seller/dashboard');
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Stall name
            <input name="name" required maxLength={100} />
          </label>
          <label>
            Owner / representative
            <input value={user.user_metadata.full_name || user.email} readOnly />
          </label>
          <label>
            Contact number
            <input name="contact" type="tel" required minLength={7} maxLength={30} />
          </label>
          <label>
            Campus location
            <select name="location" required>
              <option value="">Choose your location</option>
              {locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stall photo
            <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
          </label>
          <label className="check-label">
            <input type="checkbox" required /> {foodHandlingStandards}
          </label>
          <p className="help-text">
            Every stall is reviewed by an administrator. You can publish your menu and accept
            reservations after approval.
          </p>
          {Boolean(error) && <ErrorBox error={error} />}
          <button className="primary-button" disabled={busy}>
            <Busy busy={busy}>Submit stall application</Busy>
          </button>
        </form>
      </section>
    </>
  );
}
export function SellerSettings() {
  const { data: stall, isPending, error: stallError } = useStall();
  const { user, toast } = useSession();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data: slots = [] } = useQuery({
    queryKey: ['seller-slots', stall?.id],
    enabled: Boolean(stall),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('pickup_slots')
        .select('*')
        .eq('stall_id', stall!.id)
        .gt('end_time', new Date().toISOString())
        .order('start_time')
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  if (isPending) return <Loading />;
  if (stallError) return <ErrorBox error={stallError} />;
  if (!stall)
    return <Empty title="No stall found" text="Apply as a stall partner to get started." />;
  return (
    <>
      <PageTitle
        title="Your stall, your way"
        subtitle="The details that keep your campus running smoothly."
      />
      <div className="two-col">
        <section className="panel">
          <h2>Stall profile</h2>
          <form
            key={stall.updated_at as string | undefined}
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                if (!navigator.onLine) throw new Error('Reconnect to update your stall.');
                const f = new FormData(e.currentTarget);
                const file = f.get('image') as File;
                const image =
                  file?.size && user ? await uploadImage(file, user.id) : stall.image_url;
                const { error } = await getSupabase()
                  .from('stalls')
                  .update({
                    name: String(f.get('name')).trim(),
                    description: String(f.get('description')),
                    contact_number: String(f.get('contact')),
                    opening_hours: String(f.get('hours')),
                    delivery_enabled: f.has('delivery'),
                    reservation_mode: f.get('reservation-mode'),
                    busy_order_limit: Number(f.get('busy-order-limit')),
                    reservation_opens_at: f.get('reservation-opens'),
                    reservation_closes_at: f.get('reservation-closes'),
                    delivery_closes_at: f.get('delivery-closes'),
                    image_url: image,
                    cover_image_url: image,
                  })
                  .eq('id', stall.id)
                  .select('id')
                  .single();
                if (error) throw error;
                await query.invalidateQueries({ queryKey: ['seller-stall'] });
                toast('Stall details saved.');
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Stall name
              <input name="name" defaultValue={stall.name} required maxLength={100} />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={stall.description} maxLength={1000} />
            </label>
            <label>
              Contact number
              <input name="contact" defaultValue={stall.contact_number} required maxLength={30} />
            </label>
            <label>
              Opening hours
              <input name="hours" defaultValue={stall.opening_hours} required maxLength={120} />
            </label>
            <label>
              Online reservations
              <select name="reservation-mode" defaultValue={stall.reservation_mode ?? 'normal'}>
                <option value="normal">Accepting reservations</option>
                <option value="busy">Busy · limited pickup slots</option>
                <option value="paused">Temporarily paused</option>
              </select>
            </label>
            <label>
              Maximum orders per slot in busy mode
              <input
                name="busy-order-limit"
                type="number"
                min="1"
                max="500"
                required
                defaultValue={stall.busy_order_limit ?? 5}
              />
            </label>
            <div className="form-grid">
              <label>
                Reservations open (Manila time)
                <input
                  name="reservation-opens"
                  type="time"
                  min="07:00"
                  max="17:00"
                  required
                  defaultValue={stall.reservation_opens_at?.slice(0, 5) ?? '07:00'}
                />
              </label>
              <label>
                Last pickup ends
                <input
                  name="reservation-closes"
                  type="time"
                  min="07:00"
                  max="17:00"
                  required
                  defaultValue={stall.reservation_closes_at?.slice(0, 5) ?? '17:00'}
                />
              </label>
            </div>
            <label className="check-label">
              <input type="checkbox" name="delivery" defaultChecked={stall.delivery_enabled} />
              Offer campus delivery
            </label>
            <label>
              Delivery cutoff (Manila time)
              <input
                type="time"
                name="delivery-closes"
                defaultValue={stall.delivery_closes_at?.slice(0, 5) ?? '17:00'}
                required
              />
            </label>
            <label>
              Stall photo
              <input type="file" name="image" accept="image/jpeg,image/png,image/webp" />
            </label>
            <p className="help-text">Location changes are managed by your campus administrator.</p>
            {Boolean(error) && <ErrorBox error={error} />}
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Save stall details</Busy>
            </button>
          </form>
        </section>
        <aside>
          <section className="panel">
            <h2>Pickup schedules</h2>
            <p className="help-text" style={{ marginBottom: 16 }}>
              Times use Asia/Manila. Existing reservations retain their original schedule.
            </p>
            <form
              className="form-stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                const form = e.currentTarget;
                try {
                  const f = new FormData(form);
                  const start = `${f.get('date')}T${f.get('start')}:00+08:00`;
                  const end = `${f.get('date')}T${f.get('end')}:00+08:00`;
                  if (new Date(start).getTime() <= Date.now() || new Date(end) <= new Date(start))
                    throw new Error('Choose a future start time and a later end time.');
                  const { error } = await getSupabase()
                    .from('pickup_slots')
                    .insert({
                      stall_id: stall.id,
                      start_time: start,
                      end_time: end,
                      max_reservations: Number(f.get('capacity')),
                      max_portions: Number(f.get('portions')),
                    });
                  if (error) throw error;
                  await query.invalidateQueries({ queryKey: ['seller-slots'] });
                  form.reset();
                  toast('Pickup schedule added.');
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Date
                <input type="date" name="date" required />
              </label>
              <div className="form-grid">
                <label>
                  From
                  <input type="time" name="start" required />
                </label>
                <label>
                  Until
                  <input type="time" name="end" required />
                </label>
              </div>
              <label>
                Maximum reservations
                <input type="number" name="capacity" min="1" max="500" defaultValue="20" required />
              </label>
              <label>
                Maximum food portions
                <input
                  name="portions"
                  type="number"
                  min="1"
                  max="10000"
                  defaultValue="50"
                  required
                />
              </label>
              <button className="secondary-button" disabled={busy}>
                Add pickup slot
              </button>
            </form>
            <div style={{ marginTop: 20 }}>
              {slots.map((s) => (
                <div className="detail-row" key={s.id}>
                  <span>
                    {day(s.start_time)} · {time(s.start_time)} – {time(s.end_time)}
                    <br />
                    <small>Capacity: {s.max_reservations}</small>
                  </span>
                  <button
                    className={`toggle ${s.is_active ? 'on' : ''}`}
                    role="switch"
                    aria-label={`Enable ${time(s.start_time)} slot`}
                    aria-checked={s.is_active}
                    onClick={async () => {
                      const { error } = await getSupabase()
                        .from('pickup_slots')
                        .update({ is_active: !s.is_active })
                        .eq('id', s.id);
                      if (error) toast(error.message);
                      else await query.invalidateQueries({ queryKey: ['seller-slots'] });
                    }}
                  >
                    <span />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <section className="panel" style={{ marginTop: 20 }}>
            <Install />
            <Link
              href="/seller/account"
              className="text-button"
              style={{ display: 'block', textAlign: 'center', marginTop: 10 }}
            >
              Account, notification preferences & sign out →
            </Link>
          </section>
          {user?.id === stall.owner_id && <StallVerification stallId={stall.id} />}
        </aside>
      </div>
    </>
  );
}
