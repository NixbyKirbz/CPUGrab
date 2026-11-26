'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MenuItem } from '@/types';
export type CartLine = MenuItem & { quantity: number };
type Cart = {
  owner: string;
  lines: CartLine[];
  scope: (owner: string) => void;
  add: (item: MenuItem, quantity?: number, replace?: boolean) => boolean;
  quantity: (id: string, value: number) => void;
  clear: () => void;
};
export const useCart = create<Cart>()(
  persist(
    (set, get) => ({
      owner: 'guest',
      lines: [],
      scope: (owner) => {
        if (get().owner !== owner) set({ owner, lines: [] });
      },
      add: (item, quantity = 1, replace = false) => {
        const lines = get().lines;
        if (lines.length && lines[0].stall_id !== item.stall_id && !replace) return false;
        const base = replace ? [] : lines;
        const existing = base.find((x) => x.id === item.id);
        set({
          lines: existing
            ? base.map((x) =>
                x.id === item.id ? { ...x, quantity: Math.min(99, x.quantity + quantity) } : x,
              )
            : [...base, { ...item, quantity: Math.min(99, quantity) }],
        });
        return true;
      },
      quantity: (id, value) =>
        set({
          lines: get()
            .lines.map((x) => (x.id === id ? { ...x, quantity: Math.min(99, value) } : x))
            .filter((x) => x.quantity > 0),
        }),
      clear: () => set({ lines: [] }),
    }),
    { name: 'cpugrab-cart', partialize: (state) => ({ owner: state.owner, lines: state.lines }) },
  ),
);
