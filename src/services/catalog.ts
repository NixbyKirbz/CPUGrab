import { configured, getSupabase } from '@/lib/supabase/client';
import { demoCatalog } from '@/lib/demo';
import type { Catalog } from '@/types';
export async function fetchCatalog(): Promise<Catalog> {
  if (!configured) return demoCatalog;
  if (typeof window !== 'undefined' && !navigator.onLine) {
    const cached = localStorage.getItem('cpugrab-public-catalog');
    if (cached) return JSON.parse(cached).catalog as Catalog;
    throw new Error(
      'No public menu is saved on this device yet. Reconnect to load the campus menus.',
    );
  }
  const db = getSupabase();
  const results = await Promise.all([
    db.from('locations').select('*').eq('is_active', true).order('display_order'),
    db.from('stalls').select('*').eq('approval_status', 'approved').order('name'),
    db.from('menu_items').select('*').eq('is_archived', false).order('name'),
    db.from('categories').select('*').order('display_order'),
    db.from('platform_settings').select('*').eq('id', 1).single(),
  ]);
  for (const result of results) if (result.error) throw result.error;
  const catalog = {
    locations: results[0].data,
    stalls: results[1].data,
    items: results[2].data,
    categories: results[3].data,
    settings: results[4].data,
  } as Catalog;
  // Only the approved public catalog; no profiles, orders, sessions, or pickup tokens.
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(
        'cpugrab-public-catalog',
        JSON.stringify({ catalog, savedAt: new Date().toISOString() }),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  return catalog;
}
export async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!navigator.onLine) throw new Error('You are offline. Reconnect to make this change.');
  const { data, error } = await getSupabase().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
