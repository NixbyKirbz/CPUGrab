'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { LogOut, Store, ShieldCheck, HelpCircle, ChevronRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/upload';
import { useSession } from './providers';
import { useCart } from '@/stores/cart';
import { PageTitle, Empty, ErrorBox, Busy, Modal, Loading } from './ui';
import { Install } from './install';
import { useRouter } from 'next/navigation';
export function Profile() {
  const { user, role, toast } = useSession();
  const router = useRouter();
  const query = useQueryClient();
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const { data: profile, isPending } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  if (!user)
    return (
      <>
        <PageTitle title="Your campus account" />
        <Empty
          title="Make your breaks better"
          text="Create an account to reserve meals, save favorites, and keep track of pickups."
        >
          <Link className="primary-button" href="/login">
            Sign in to CPUGrab
          </Link>
        </Empty>
        <div className="panel" style={{ marginTop: 20 }}>
          <Install />
        </div>
      </>
    );
  if (isPending) return <Loading />;
  return (
    <>
      <PageTitle
        title="A little about you"
        subtitle="Your account, your preferences, your campus day."
      />
      <div className="two-col">
        <section className="panel">
          <div className="profile-card">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Your profile photo"
                style={{ width: 65, height: 65, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <span className="avatar">{profile?.full_name?.charAt(0) || 'C'}</span>
            )}
            <div>
              <h2>{profile?.full_name}</h2>
              <p>{user.email}</p>
              <small className="muted">{role} account</small>
            </div>
          </div>
          <form
            key={profile?.updated_at}
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setSaved(false);
              setError(null);
              try {
                const form = new FormData(e.currentTarget);
                const file = form.get('avatar') as File;
                const avatar = file?.size ? await uploadImage(file, user.id) : profile?.avatar_url;
                const { error } = await getSupabase()
                  .from('profiles')
                  .update({
                    full_name: String(form.get('full_name')).trim(),
                    student_id: String(form.get('student_id')),
                    avatar_url: avatar,
                    notifications_enabled: form.get('notifications') === 'on',
                  })
                  .eq('id', user.id);
                if (error) throw error;
                setSaved(true);
                await query.invalidateQueries({ queryKey: ['profile'] });
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Full name
              <input name="full_name" defaultValue={profile?.full_name} required maxLength={120} />
            </label>
            <label>
              Student ID
              <input name="student_id" defaultValue={profile?.student_id} maxLength={40} />
            </label>
            <label>
              Profile photo
              <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp" />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                name="notifications"
                defaultChecked={profile?.notifications_enabled}
              />
              Show optional browser notification previews
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={async () => {
                if (!('Notification' in window)) {
                  toast(
                    'This browser does not support notification previews. Your in-app updates are still available.',
                  );
                  return;
                }
                const permission = await Notification.requestPermission();
                toast(
                  permission === 'granted'
                    ? 'Browser previews are enabled while CPUGrab is open.'
                    : 'Your in-app notifications are still available.',
                );
              }}
            >
              Allow browser notification previews
            </button>
            <p className="help-text">
              Order updates remain available in your in-app notification inbox.
            </p>
            {Boolean(error) && <ErrorBox error={error} />}{' '}
            {saved && (
              <p className="help-text" role="status">
                Your profile has been saved.
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Save account details</Busy>
            </button>
          </form>
        </section>
        <aside className="panel">
          <h2>Make yourself at home</h2>
          <Install />
          <div className="profile-links" style={{ marginTop: 18 }}>
            {role === 'seller' && (
              <Link href="/seller/dashboard">
                <span>
                  <Store size={16} style={{ display: 'inline', marginRight: 8 }} />
                  Stall portal
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            {role === 'admin' && (
              <Link href="/admin">
                <span>
                  <ShieldCheck size={16} style={{ display: 'inline', marginRight: 8 }} />
                  Administrator dashboard
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            {role === 'student' && (
              <Link href="/register/stall">
                <span>
                  <Store size={16} style={{ display: 'inline', marginRight: 8 }} />
                  Apply as a stall partner
                </span>
                <ChevronRight size={16} />
              </Link>
            )}
            <Link href="/forgot-password">
              Reset password
              <ChevronRight size={16} />
            </Link>
            <button onClick={() => setHelp(true)}>
              <span>
                <HelpCircle size={16} style={{ display: 'inline', marginRight: 8 }} />
                Help with CPUGrab
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={async () => {
                await getSupabase().auth.signOut();
                useCart.getState().scope('guest');
                query.clear();
                router.push('/student/home');
                router.refresh();
              }}
            >
              <span>
                <LogOut size={16} style={{ display: 'inline', marginRight: 8 }} />
                Sign out
              </span>
            </button>
          </div>
        </aside>
      </div>
      {help && (
        <Modal title="A smoother campus break" onClose={() => setHelp(false)}>
          <div className="form-stack">
            <p>
              Browse a location, choose a stall, add your meal, and select an available pickup time.
            </p>
            <p>
              Pay at checkout with simulated GCash or CPUGrab Wallet, then show your private pickup
              QR at the stall. Keep the code private.
            </p>
            <p>
              Need to cancel? You can cancel reserved orders more than 15 minutes before pickup. For
              ready orders or later changes, contact the stall directly.
            </p>
            <p className="help-text">
              CPUGrab is for campus pickup. Availability and pricing are confirmed when the
              reservation is created.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
