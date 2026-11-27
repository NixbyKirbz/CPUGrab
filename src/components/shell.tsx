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
  Wallet,
  Bike,
  X,
} from 'lucide-react';
import { useCart } from '@/stores/cart';
import { configured, getSupabase } from '@/lib/supabase/client';
import { useSession } from './providers';
import { useQuery } from '@tanstack/react-query';
import { Modal, Empty, Loading } from './ui';
import { useState } from 'react';
import type { Role } from '@/types';
import { fetchCatalog } from '@/services/catalog';
import { WalletCashIn } from './student/wallet-cash-in';
export function Shell({ children, role = 'student' }: { children: React.ReactNode; role?: Role }) {
  const path = usePathname();
  const studentHome = role === 'student' && path === '/student/home';
  const dashboard = studentHome || path === '/seller/dashboard' || path === '/admin';
  const { user, name, loading, role: accountRole } = useSession();
  const count = useCart((s) => s.lines.reduce((sum, x) => sum + x.quantity, 0));
  const [notifications, setNotifications] = useState(false);
  const [wallet, setWallet] = useState(false);
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
            { label: 'Pickup', href: '/seller/scanner', icon: ScanLine },
            { label: 'Menu', href: '/seller/menu', icon: Utensils },
            { label: 'Settings', href: '/seller/settings', icon: Settings },
          ]
        : [
            { label: 'Overview', href: '/admin', icon: LayoutDashboard },
            { label: 'Stalls', href: '/admin/stalls', icon: Store },
            { label: 'Locations', href: '/admin/locations', icon: MapPin },
            { label: 'Deliveries', href: '/admin/delivery', icon: Bike },
            { label: 'Accounts', href: '/admin/accounts', icon: UserRound },
            { label: 'Reports', href: '/admin/reports', icon: CalendarDays },
            { label: 'Rewards', href: '/admin/rewards', icon: Wallet },
            { label: 'Settings', href: '/admin/settings', icon: Settings },
          ];
  return (
    <>
      <header className={`topbar ${role}-topbar`}>
        <div className="topbar-inner">
          <Link
            href={
              role === 'student'
                ? '/student/home'
                : role === 'seller'
                  ? '/seller/dashboard'
                  : '/admin'
            }
            aria-label="CPUGrab home"
            className="brand"
          >
            <img src="/brand/logo.png" alt="CPUGrab" width="170" height="57" />
          </Link>
          <span className="header-divider" />
          <Link
            href={
              role === 'student'
                ? '/student/location/all'
                : role === 'seller'
                  ? '/seller/dashboard'
                  : '/admin'
            }
            className="campus"
          >
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
              className={role === 'student' ? 'avatar student-header-profile' : 'avatar'}
              href={user ? (role === 'seller' ? '/seller/account' : '/student/profile') : '/login'}
              aria-label={user ? 'Your profile' : 'Sign in'}
            >
              {user ? name.charAt(0) : <UserRound size={20} />}
            </Link>
            {studentHome && (
              <button
                type="button"
                className="icon-button wallet-button"
                aria-label="Cash in to CPUGrab Wallet"
                aria-haspopup="dialog"
                onClick={() => setWallet(true)}
              >
                <Wallet size={21} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </header>
      <div className={`app-layout ${role}-layout`}>
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
          {dashboard && (
            <img
              className="dashboard-banner"
              src="/brand/banner.png"
              alt="CPUGrab campus banner"
              width={2172}
              height={724}
              fetchPriority="high"
              draggable={false}
            />
          )}
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
          {role === 'admin' && loading ? (
            <Loading />
          ) : role === 'admin' && (!user || accountRole !== 'admin') ? (
            <Empty
              title="Administrator access required"
              text="Sign in with an authorized campus account to continue."
            >
              <Link className="primary-button" href="/login">
                Sign in
              </Link>
            </Empty>
          ) : (
            children
          )}
          {dashboard && (
            <footer className="dashboard-footer">
              <div className="footer-banner" aria-hidden="true" />
              <div className="footer-caption">
                <span>CPUGrab</span>
                <span>Central Philippine University</span>
              </div>
            </footer>
          )}
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
            aria-current={path === href ? 'page' : undefined}
            className={`${path === href ? 'active' : ''} ${href === '/seller/scanner' ? 'scan-nav' : ''}`}
          >
            <Icon size={22} />
            <span>{label === 'My orders' ? 'Orders' : label}</span>
          </Link>
        ))}
      </nav>
      {studentHome && wallet && <WalletCashIn onClose={() => setWallet(false)} />}
      {notifications && (
        <Modal title="Notifications" onClose={() => setNotifications(false)}>
          {notices.length ? (
            <div className="notification-list">
              {notices.map((n) => (
                <Link
                  key={n.id}
                  href={role === 'seller' ? '/seller/orders' : `/student/order/${n.order_id}`}
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
  onClear,
  placeholder = 'What are you craving today?',
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onClear?: () => void;
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
      <Search size={20} aria-hidden="true" />
      <input
        aria-label="Search food, stalls or locations"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && onClear ? (
        <button type="button" aria-label="Clear search" onClick={onClear}>
          <X size={19} />
        </button>
      ) : (
        onSubmit && (
          <button type="submit" aria-label="Search">
            <Search size={19} />
          </button>
        )
      )}
    </form>
  );
}
