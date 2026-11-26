'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { CalendarDays, Utensils, Settings, ChevronRight } from 'lucide-react';
import { useStall } from './context';
import { useSession } from '@/components/providers';
import { fetchCatalog } from '@/services/catalog';
import { getSupabase } from '@/lib/supabase/client';
import { Loading, ErrorBox, Empty, PageTitle } from '@/components/ui';
import { useState } from 'react';
export function SellerDashboard() {
  const { data: stall, isPending, error } = useStall();
  const { toast } = useSession();
  const query = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const location = catalog?.locations.find((item) => item.id === stall?.location_id);
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
    <div className="seller-dashboard">
      <section className="seller-overview">
        <img src={stall.image_url} alt={stall.name} />
        <div>
          <h1>{stall.name}</h1>
          <p>{location?.name || stall.opening_hours}</p>
        </div>
        <div className="seller-open">
          <span className={`status-dot ${stall.is_open ? 'open' : ''}`}>
            {stall.is_open ? 'Open' : 'Closed'}
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
      <div className="dashboard-links">
        {[
          {
            href: '/seller/orders',
            icon: CalendarDays,
            title: 'Orders',
          },
          {
            href: '/seller/menu',
            icon: Utensils,
            title: 'Menu Management',
          },
          {
            href: '/seller/settings',
            icon: Settings,
            title: 'Stall Settings',
          },
        ].map(({ href, icon: Icon, title }) => (
          <Link href={href} key={href}>
            <Icon size={21} />
            <h2>{title}</h2>
            <ChevronRight size={19} />
          </Link>
        ))}
      </div>
    </div>
  );
}
