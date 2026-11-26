'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { configured, getSupabase } from '@/lib/supabase/client';
import { useCart } from '@/stores/cart';
import type { User } from '@supabase/supabase-js';
import type { Role } from '@/types';
type Session = {
  user: User | null;
  role: Role;
  name: string;
  loading: boolean;
  toast: (message: string) => void;
};
const Context = createContext<Session>({
  user: null,
  role: 'student',
  name: 'Centralian',
  loading: true,
  toast: () => {},
});
export const useSession = () => useContext(Context);
function SessionProvider({ children }: { children: React.ReactNode }) {
  const query = useQueryClient();
  const [session, setSession] = useState<Omit<Session, 'toast'>>({
    user: null,
    role: 'student',
    name: 'Centralian',
    loading: true,
  });
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  const toast = useCallback((value: string) => setMessage(value), []);
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(''), 5000);
    return () => clearTimeout(id);
  }, [message]);
  useEffect(() => {
    const online = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void query.invalidateQueries();
    };
    online();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller)
                toast('An update is ready. Close and reopen CPUGrab to use it.');
            });
          });
        })
        .catch(() => {});
    }
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, [query, toast]);
  useEffect(() => {
    if (!configured) {
      useCart.getState().scope('guest');
      const timer = setTimeout(() => setSession((s) => ({ ...s, loading: false })), 0);
      return () => clearTimeout(timer);
    }
    const db = getSupabase();
    let active = true;
    const refresh = async (user: User | null) => {
      useCart.getState().scope(user?.id || 'guest');
      if (!user) {
        if (active) setSession({ user: null, role: 'student', name: 'Centralian', loading: false });
        return;
      }
      const [profile, roles] = await Promise.all([
        db.from('profiles').select('full_name').eq('id', user.id).single(),
        db.from('user_roles').select('role').eq('user_id', user.id).single(),
      ]);
      if (active)
        setSession({
          user,
          name: profile.data?.full_name?.split(' ')[0] || 'Centralian',
          role: roles.data?.role || 'student',
          loading: false,
        });
    };
    void db.auth.getUser().then(({ data }) => refresh(data.user));
    const {
      data: { subscription },
    } = db.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        void refresh(session?.user || null);
        void query.invalidateQueries();
      }, 0);
    });
    const channel = db
      .channel('app-updates')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        void query.invalidateQueries();
        if (payload.table === 'notifications' && payload.eventType === 'INSERT') {
          toast(String(payload.new.title));
          if (
            'Notification' in window &&
            Notification.permission === 'granted' &&
            document.hidden
          ) {
            void db
              .from('profiles')
              .select('notifications_enabled')
              .eq('id', payload.new.user_id)
              .single()
              .then(({ data }) => {
                if (data?.notifications_enabled)
                  new Notification(String(payload.new.title), {
                    body: String(payload.new.message),
                    icon: '/icons/icon-192.png',
                  });
              });
          }
        }
      })
      .subscribe();
    return () => {
      active = false;
      subscription.unsubscribe();
      void db.removeChannel(channel);
      query.clear();
    };
  }, [query, toast]);
  return (
    <Context.Provider value={{ ...session, toast }}>
      {offline && (
        <div className="network-banner" role="status">
          You’re offline. Previously loaded public menus are available. Reconnect to reserve or
          claim orders.
        </div>
      )}
      {children}
      {message && (
        <div className="toast" role="status" onClick={() => setMessage('')}>
          {message}
        </div>
      )}
    </Context.Provider>
  );
}
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: true } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>{children}</SessionProvider>
    </QueryClientProvider>
  );
}
