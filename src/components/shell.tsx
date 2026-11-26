'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  CalendarDays,
  Heart,
  UserRound,
  ShoppingBag,
  MapPin,
  ChevronDown,
  Bell,
  ScanLine,
  Utensils,
  Settings,
  LayoutDashboard,
  Store,
  ShieldCheck,
  ArrowUpRight,
  Search,
} from 'lucide-react';
import { useCart } from '@/stores/cart';
import { configured, getSupabase } from '@/lib/supabase/client';
import { useSession } from './providers';
import { useQuery } from '@tanstack/react-query';
import { Modal, Empty, Loading } from './ui';
import { useState } from 'react';
import type { Role } from '@/types';
import { fetchCatalog } from '@/services/catalog';
export function Shell({ children, role = 'student' }: { children: React.ReactNode; role?: Role }) {
  const path = usePathname();
  const { user, name, loading, role: accountRole } = useSession();
  const count = useCart((s) => s.lines.reduce((sum, x) => sum + x.quantity, 0));
  const [notifications, setNotifications] = useState(false);
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
  const { data: notices = [] } = useQuery({
    queryKey: ['notifications', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('notifications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return data;
    },
  });
  const links =
    role === 'student'
      ? [
          { label: 'Home', href: '/student/home', icon: Home },
          { label: 'My orders', href: '/student/orders', icon: CalendarDays },
          { label: 'Favorites', href: '/student/favorites', icon: Heart },
          { label: 'Profile', href: '/student/profile', icon: UserRound },
        ]
      : role === 'seller'
        ? [
            { label: 'Home', href: '/seller/dashboard', icon: Home },
            { label: 'Orders', href: '/seller/orders', icon: CalendarDays },
            { label: 'QR Scan', href: '/seller/scanner', icon: ScanLine },
            { label: 'Menu', href: '/seller/menu', icon: Utensils },
            { label: 'Settings', href: '/seller/settings', icon: Settings },
          ]
        : [
            { label: 'Overview', href: '/admin', icon: LayoutDashboard },
            { label: 'Stalls', href: '/admin/stalls', icon: Store },
            { label: 'Locations', href: '/admin/locations', icon: MapPin },
            { label: 'Accounts', href: '/admin/accounts', icon: UserRound },
            { label: 'Settings', href: '/admin/settings', icon: Settings },
          ];
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link
            href={
              role === 'student'
                ? '/student/home'
                : role === 'seller'
                  ? '/seller/dashboard'
                  : '/admin'
            }
            className="brand"
          >
            <img src="/brand/logo.png" alt="CPUGrab" width="170" height="57" />
          </Link>
          <span className="header-divider" />
          <Link href="/student/location/all" className="campus">
            <span className="campus-pin">
              <MapPin size={19} />
            </span>
            <span>
              <small>
                {role === 'student' ? 'PICKUP ON CAMPUS' : `${role.toUpperCase()} PORTAL`}
              </small>
              <strong>
                Central Philippine University <ChevronDown size={13} />
              </strong>
            </span>
          </Link>
          <nav className="desktop-nav">
            {links.slice(0, role === 'seller' ? 5 : 3).map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} className={path === href ? 'active' : ''}>
                <Icon size={17} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <button
              className="icon-button notification-button"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={21} />
              {notices.some((n) => !n.is_read) && <i />}
            </button>
            {role === 'student' && (
              <Link
                href="/student/cart"
                className="cart-icon"
                aria-label={`Cart with ${count} items`}
              >
                <ShoppingBag size={20} />
                {count > 0 && <span>{count}</span>}
              </Link>
            )}
            <Link
              className="avatar"
              href={user ? '/student/profile' : '/login'}
              aria-label={user ? 'Your profile' : 'Sign in'}
            >
              {user ? name.charAt(0) : <UserRound size={20} />}
            </Link>
          </div>
        </div>
      </header>
      <div className="app-layout">
        {role === 'admin' && (
          <aside className="admin-sidebar">
            <p className="eyebrow">CAMPUS MANAGEMENT</p>
            {links.map(({ href, label, icon: Icon }) => (
              <Link className={path === href ? 'active' : ''} href={href} key={href}>
                <Icon size={18} />
                {label}
              </Link>
            ))}
            <span>
              <ShieldCheck size={17} />
              Administrator access
            </span>
          </aside>
        )}
        <main
          id="main-content"
          className={`main-content ${role !== 'student' ? 'portal-content' : ''}`}
        >
          {(!configured || catalog?.stalls.some((stall) => stall.is_demo)) && (
            <div className="demo-strip">
              <span>
                <i />
                Demo preview · Illustrative campus listings and prices
              </span>
              <Link href="/login">
                Connect your campus <ArrowUpRight size={13} />
              </Link>
            </div>
          )}
          {role !== 'student' && loading ? (
            <Loading />
          ) : role !== 'student' && (!user || (accountRole !== role && accountRole !== 'admin')) ? (
            <Empty
              title={`${role === 'seller' ? 'Stall partner' : 'Administrator'} access required`}
              text="Sign in with an authorized campus account to continue."
            >
              <Link className="primary-button" href="/login">
                Sign in
              </Link>
            </Empty>
          ) : (
            children
          )}
          <footer className="footer">
            <img src="/brand/logo.png" alt="CPUGrab" width="98" height="33" />
            <span>Made for your campus day.</span>
            <span className="footer-tagline">Reserve. Pick Up. Skip the Line.</span>
          </footer>
        </main>
      </div>
      <nav
        className={`bottom-nav ${role === 'seller' ? 'seller-nav' : ''}`}
        aria-label="Main navigation"
      >
        {links.map(({ label, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`${path === href ? 'active' : ''} ${label === 'QR Scan' ? 'scan-nav' : ''}`}
          >
            <Icon size={22} />
            <span>{label === 'My orders' ? 'Orders' : label}</span>
          </Link>
        ))}
      </nav>
      {notifications && (
        <Modal title="Notifications" onClose={() => setNotifications(false)}>
          {notices.length ? (
            <div className="notification-list">
              {notices.map((n) => (
                <Link
                  key={n.id}
                  href={`/student/order/${n.order_id}`}
                  onClick={async () => {
                    setNotifications(false);
                    await getSupabase()
                      .from('notifications')
                      .update({ is_read: true })
                      .eq('id', n.id);
                  }}
                >
                  <strong>{n.title}</strong>
                  <p>{n.message}</p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Bell size={30} />
              <h3>You’re all caught up</h3>
              <p>Your reservation updates will appear here.</p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
export function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder = 'What are you craving today?',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
}) {
  return (
    <form
      className="search-field"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search size={21} />
      <input
        aria-label="Search food, stalls or locations"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {onSubmit && <button type="submit">Search</button>}
    </form>
  );
}
