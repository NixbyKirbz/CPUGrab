'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { Store, MapPin, UserRound, Check, Plus, Pencil, Settings } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { rpc } from '@/services/catalog';
import { useSession } from './providers';
import { uploadImage } from '@/lib/upload';
import { PageTitle, ErrorBox, Loading, Empty, Busy, Modal } from './ui';
import type { Stall, Location, Pricing } from '@/types';
export function Admin({
  view = 'overview',
}: {
  view?: 'overview' | 'stalls' | 'locations' | 'accounts' | 'settings';
}) {
  const { user, toast } = useSession();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [location, setLocation] = useState<Partial<Location> | null>(null);
  const {
    data,
    isPending,
    error: loadError,
  } = useQuery({
    queryKey: ['admin'],
    enabled: Boolean(user),
    queryFn: async () => {
      const db = getSupabase();
      const [stalls, locations, profiles, settings] = await Promise.all([
        db.from('stalls').select('*').order('created_at', { ascending: false }),
        db.from('locations').select('*').order('display_order'),
        db
          .from('profiles')
          .select('id,full_name,is_suspended,created_at')
          .order('created_at', { ascending: false })
          .limit(100),
        db.from('platform_settings').select('*').eq('id', 1).single(),
      ]);
      for (const r of [stalls, locations, profiles, settings]) if (r.error) throw r.error;
      return {
        stalls: stalls.data as Stall[],
        locations: locations.data as Location[],
        profiles: profiles.data!,
        settings: settings.data as Pricing & { university_email_domains: string[] },
      };
    },
  });
  const action = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await query.invalidateQueries();
      toast(message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!user)
    return (
      <Empty
        title="Administrator access required"
        text="Sign in with a campus administrator account."
      >
        <Link href="/login" className="primary-button">
          Sign in
        </Link>
      </Empty>
    );
  if (isPending) return <Loading />;
  if (loadError || !data) return <ErrorBox error={loadError} />;
  const pending = data.stalls.filter((s) => s.approval_status === 'pending');
  const titles = {
    overview: 'Keep campus connected.',
    stalls: 'Campus stalls',
    locations: 'Campus locations',
    accounts: 'Campus accounts',
    settings: 'Platform settings',
  };
  return (
    <>
      <PageTitle
        title={titles[view]}
        subtitle="A little care behind every campus meal."
        action={
          view === 'locations' ? (
            <button
              className="primary-button"
              onClick={() => setLocation({ is_active: true, display_order: 0 })}
            >
              <Plus size={16} />
              Add location
            </button>
          ) : undefined
        }
      />
      {Boolean(error) && <ErrorBox error={error} />}
      {view === 'overview' && (
        <>
          <div className="stats-row">
            <Link href="/admin/stalls" className="stat-card">
              <Store size={30} />
              <div>
                <strong>{pending.length}</strong>
                <p>Stalls awaiting approval</p>
              </div>
            </Link>
            <Link href="/admin/locations" className="stat-card">
              <MapPin size={30} />
              <div>
                <strong>{data.locations.filter((l) => l.is_active).length}</strong>
                <p>Active campus locations</p>
              </div>
            </Link>
          </div>
          <div className="dashboard-links">
            <Link href="/admin/stalls">
              <Store size={25} />
              <h2>Review stall partners</h2>
              <p>Approve applications and manage visibility.</p>
            </Link>
            <Link href="/admin/accounts">
              <UserRound size={25} />
              <h2>Manage accounts</h2>
              <p>Keep campus access safe and appropriate.</p>
            </Link>
            <Link href="/admin/settings">
              <Settings size={25} />
              <h2>Keep fees transparent</h2>
              <p>Configure reservation fees and adjustments.</p>
            </Link>
          </div>
          <div className="section-heading">
            <h2>Awaiting your review</h2>
          </div>
          {pending.length === 0 ? (
            <Empty title="All caught up" text="New stall applications will appear here." />
          ) : (
            <div className="order-grid">
              {pending.map((s) => (
                <div className="panel" key={s.id}>
                  <h3>{s.name}</h3>
                  <p className="help-text" style={{ margin: '10px 0 15px' }}>
                    {data.locations.find((l) => l.id === s.location_id)?.name} · {s.contact_number}
                  </p>
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          rpc('manage_seller_approval', { p_stall: s.id, p_status: 'approved' }),
                        'Stall approved.',
                      )
                    }
                  >
                    <Check size={16} />
                    Approve stall
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {view === 'stalls' && (
        <div className="panel table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Stall</th>
                <th>Location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.stalls.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                    <p className="help-text">{s.contact_number}</p>
                  </td>
                  <td>{data.locations.find((l) => l.id === s.location_id)?.name}</td>
                  <td>
                    <span
                      className={`status ${s.approval_status === 'approved' ? 'ready' : s.approval_status === 'suspended' ? 'cancelled' : ''}`}
                    >
                      {s.approval_status}
                    </span>
                  </td>
                  <td>
                    <div className="inline-actions">
                      {s.approval_status !== 'approved' && (
                        <button
                          className="primary-button"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                rpc('manage_seller_approval', {
                                  p_stall: s.id,
                                  p_status: 'approved',
                                }),
                              'Stall approved.',
                            )
                          }
                        >
                          Approve
                        </button>
                      )}
                      {s.approval_status === 'approved' && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () =>
                                rpc('manage_seller_approval', {
                                  p_stall: s.id,
                                  p_status: 'suspended',
                                }),
                              'Stall suspended.',
                            )
                          }
                        >
                          Suspend
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'locations' && (
        <div className="order-grid">
          {data.locations.map((l) => (
            <div className="panel" key={l.id}>
              <img
                src={l.image_url}
                alt={l.name}
                style={{
                  height: 150,
                  width: '100%',
                  objectFit: 'cover',
                  borderRadius: 9,
                  marginBottom: 15,
                }}
              />
              <h3>{l.name}</h3>
              <p className="help-text" style={{ margin: '8px 0 16px' }}>
                {l.description}
              </p>
              <div className="inline-actions">
                <button className="secondary-button" onClick={() => setLocation(l)}>
                  <Pencil size={14} />
                  Edit
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const { error } = await getSupabase()
                        .from('locations')
                        .update({ is_active: !l.is_active })
                        .eq('id', l.id);
                      if (error) throw error;
                    }, 'Location updated.')
                  }
                >
                  {l.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {view === 'accounts' && (
        <div className="panel table-wrap">
          <p className="help-text" style={{ marginBottom: 15 }}>
            Showing the latest 100 accounts. Personal email and student IDs are intentionally
            excluded.
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Full name</th>
                <th>Access</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.full_name}</td>
                  <td>{p.is_suspended ? 'Suspended' : 'Active'}</td>
                  <td>
                    <button
                      className="secondary-button"
                      disabled={busy || p.id === user.id}
                      onClick={() =>
                        void action(
                          () =>
                            rpc('set_account_suspension', {
                              p_user: p.id,
                              p_suspended: !p.is_suspended,
                            }),
                          'Account access updated.',
                        )
                      }
                    >
                      {p.is_suspended ? 'Restore access' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === 'settings' && (
        <section className="panel" style={{ maxWidth: 700 }}>
          <h2>Clear fees. Better breaks.</h2>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void action(async () => {
                const fee = Math.round(Number(form.get('fee')) * 100),
                  stall = Math.round(Number(form.get('stall')) * 100),
                  platform = Math.round(Number(form.get('platform')) * 100);
                if (fee !== stall + platform)
                  throw new Error('The stall and platform shares must equal the reservation fee.');
                const { error } = await getSupabase()
                  .from('platform_settings')
                  .update({
                    reservation_fee_centavos: fee,
                    delivery_fee_centavos: Math.round(Number(form.get('delivery')) * 100),
                    group_delivery_fee_centavos: Math.round(Number(form.get('group-fee')) * 100),
                    group_delivery_max_orders: Number(form.get('group-limit')),
                    stall_fee_share_centavos: stall,
                    platform_fee_share_centavos: platform,
                    default_markup_centavos: Number(form.get('markup')),
                    university_email_domains: String(form.get('domains'))
                      .toLowerCase()
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                  .eq('id', 1);
                if (error) throw error;
              }, 'Platform settings saved.');
            }}
          >
            <label>
              Reservation fee (₱)
              <input
                name="fee"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={data.settings.reservation_fee_centavos / 100}
              />
            </label>
            <div className="form-grid">
              <label>
                Stall share (₱)
                <input
                  name="stall"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={data.settings.stall_fee_share_centavos / 100}
                />
              </label>
              <label>
                Platform share (₱)
                <input
                  name="platform"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={data.settings.platform_fee_share_centavos / 100}
                />
              </label>
            </div>
            <label>
              Campus delivery fee and worker compensation (₱)
              <input
                name="delivery"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={(data.settings.delivery_fee_centavos ?? 1500) / 100}
              />
            </label>
            <label>
              Group delivery fee per order (₱)
              <input
                name="group-fee"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={(data.settings.group_delivery_fee_centavos ?? 1000) / 100}
              />
            </label>
            <label>
              Maximum orders per group trip
              <input
                name="group-limit"
                type="number"
                min="2"
                max="4"
                step="1"
                required
                defaultValue={data.settings.group_delivery_max_orders ?? 3}
              />
            </label>
            <label>
              Per-item price adjustment
              <select name="markup" defaultValue={data.settings.default_markup_centavos}>
                {[0, 200, 300, 400, 500].map((n) => (
                  <option key={n} value={n}>
                    ₱{n / 100}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Confirmed university email domains
              <input
                name="domains"
                placeholder="Leave empty until domains are confirmed"
                defaultValue={data.settings.university_email_domains.join(', ')}
              />
              <span className="help-text">
                Comma-separated. Enforced by the database at signup. Keep UNIVERSITY_EMAIL_DOMAINS
                in sync if configured.
              </span>
            </label>
            <p className="notice">
              Changes apply to new reservations. Existing orders retain their fee and price
              snapshots. No financial transfers are performed.
            </p>
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Save platform settings</Busy>
            </button>
          </form>
        </section>
      )}
      {location && (
        <Modal
          title={location.id ? 'Edit campus location' : 'Add campus location'}
          onClose={() => {
            if (!busy) setLocation(null);
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void action(async () => {
                const file = form.get('image') as File;
                const image = file?.size ? await uploadImage(file, user.id) : location.image_url;
                if (!image) throw new Error('Add a location photo.');
                const value = {
                  name: String(form.get('name')).trim(),
                  description: String(form.get('description')),
                  image_url: image,
                  display_order: Number(form.get('order')),
                  is_active: form.get('active') === 'on',
                  is_delivery_dropoff: form.get('delivery') === 'on',
                };
                const result = location.id
                  ? await getSupabase().from('locations').update(value).eq('id', location.id)
                  : await getSupabase().from('locations').insert(value);
                if (result.error) throw result.error;
                setLocation(null);
              }, 'Location saved.');
            }}
          >
            <label>
              Location name
              <input name="name" defaultValue={location.name} required maxLength={100} />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={location.description} />
            </label>
            <label>
              Location photo
              <input
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                required={!location.image_url}
              />
            </label>
            <label>
              Display order
              <input name="order" type="number" defaultValue={location.display_order} />
            </label>
            <label className="check-label">
              <input name="active" type="checkbox" defaultChecked={location.is_active} />
              Active
            </label>
            <label className="check-label">
              <input
                name="delivery"
                type="checkbox"
                defaultChecked={location.is_delivery_dropoff}
              />
              Approved campus drop-off point
            </label>
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Save location</Busy>
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
