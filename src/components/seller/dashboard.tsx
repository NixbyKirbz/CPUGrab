'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, Utensils, Settings, ScanLine, MapPin } from 'lucide-react';
import { useStall } from './context';
import { useSession } from '@/components/providers';
import { fetchOrders } from '@/services/orders';
import { getSupabase } from '@/lib/supabase/client';
import { Loading, ErrorBox, Empty, PageTitle } from '@/components/ui';
import { useState } from 'react';
export function SellerDashboard() {
  const { data: stall, isPending, error } = useStall();
  const { user, toast } = useSession();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: orders = [] } = useQuery({
    queryKey: ['orders', user?.id, stall?.id],
    enabled: Boolean(stall?.id),
    queryFn: () => fetchOrders(stall!.id),
  });
  if (isPending) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!stall)
    return (
      <Empty
        title="Your stall starts here"
        text="Submit a stall application and an administrator will review it."
      >
        <Link href="/register/stall" className="primary-button">
          Apply for a stall
        </Link>
      </Empty>
    );
  if (stall.approval_status !== 'approved')
    return (
      <>
        <PageTitle title={stall.name} />
        <Empty
          title={
            stall.approval_status === 'pending'
              ? 'Your application is being reviewed'
              : 'Your stall is suspended'
          }
          text="Your stall will become visible and accept reservations after administrator approval."
        />
        <Link className="text-button" href="/student/profile">
          Your account →
        </Link>
      </>
    );
  return (
    <>
      <PageTitle
        title="A good day to serve."
        subtitle="Everything you need. Right where you need it."
      />
      <section className="seller-overview">
        <img src={stall.image_url} alt={stall.name} />
        <div>
          <p className="eyebrow">YOUR CAMPUS STALL</p>
          <h1>{stall.name}</h1>
          <p>
            <MapPin size={13} style={{ display: 'inline' }} /> {stall.opening_hours}
          </p>
        </div>
        <div className="seller-open">
          <span className={`status-dot ${stall.is_open ? 'open' : ''}`}>
            {stall.is_open ? 'Open for reservations' : 'Closed'}
          </span>
          <button
            className={`toggle ${stall.is_open ? 'on' : ''}`}
            role="switch"
            aria-checked={stall.is_open}
            aria-label="Accept reservations"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { error } = await getSupabase()
                  .from('stalls')
                  .update({ is_open: !stall.is_open })
                  .eq('id', stall.id);
                if (error) throw error;
                await query.invalidateQueries({ queryKey: ['seller-stall'] });
                await query.invalidateQueries({ queryKey: ['catalog'] });
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Could not change stall status.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <span />
          </button>
        </div>
      </section>
      <div className="stats-row">
        <Link href="/seller/orders" className="stat-card">
          <CalendarDays size={30} />
          <div>
            <strong>{orders.filter((o) => o.status === 'reserved').length}</strong>
            <p>Pending reservations</p>
          </div>
        </Link>
        <Link href="/seller/orders" className="stat-card">
          <CheckCircle2 size={30} />
          <div>
            <strong>{orders.filter((o) => o.status === 'ready').length}</strong>
            <p>Ready for pickup</p>
          </div>
        </Link>
      </div>
      <div className="dashboard-links">
        {[
          {
            href: '/seller/orders',
            icon: CalendarDays,
            title: 'Orders',
            text: 'A quick view of your reservations.',
          },
          {
            href: '/seller/menu',
            icon: Utensils,
            title: 'Menu management',
            text: 'Today’s food. A tap to update.',
          },
          {
            href: '/seller/settings',
            icon: Settings,
            title: 'Stall settings',
            text: 'Keep your campus stall up to date.',
          },
        ].map(({ href, icon: Icon, title, text }) => (
          <Link href={href} key={href}>
            <Icon size={27} />
            <h2>{title}</h2>
            <p>{text}</p>
          </Link>
        ))}
      </div>
      <Link className="primary-button full-width" style={{ marginTop: 25 }} href="/seller/scanner">
        <ScanLine size={21} />
        Scan a pickup QR
      </Link>
      <p className="help-text" style={{ textAlign: 'center', marginTop: 15 }}>
        Reservation counts reflect CPUGrab bookings only.
      </p>
    </>
  );
}
