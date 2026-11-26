import { describe, it, expect, beforeEach } from 'vitest';
import { cartTotals, money, time } from '../src/lib/format';
import { useCart } from '../src/stores/cart';
import { demoCatalog } from '../src/lib/demo';
describe('Transparent centavo pricing', () => {
  it('calculates quantity, fee, and optional adjustments without floats', () => {
    expect(
      cartTotals(
        [
          { price_centavos: 7000, quantity: 1 },
          { price_centavos: 4000, quantity: 2 },
        ],
        1500,
        200,
      ),
    ).toEqual({ subtotal: 15000, adjustment: 600, total: 17100 });
  });
  it('formats Philippine currency and Manila pickup times', () => {
    expect(money(12550)).toContain('125.50');
    expect(time('2026-11-26T04:00:00Z')).toBe('12:00 PM');
  });
});
describe('Single-stall user-scoped cart', () => {
  beforeEach(() => useCart.setState({ owner: 'student-a', lines: [] }));
  it('merges quantities and removes an item at zero', () => {
    const item = demoCatalog.items[0];
    useCart.getState().add(item);
    useCart.getState().add(item, 2);
    expect(useCart.getState().lines[0].quantity).toBe(3);
    useCart.getState().quantity(item.id, 0);
    expect(useCart.getState().lines).toHaveLength(0);
  });
  it('requires consent before changing stalls', () => {
    useCart.getState().add(demoCatalog.items[0]);
    expect(useCart.getState().add(demoCatalog.items[4])).toBe(false);
    expect(useCart.getState().lines[0].stall_id).toBe(demoCatalog.stalls[0].id);
    useCart.getState().add(demoCatalog.items[4], 1, true);
    expect(useCart.getState().lines).toHaveLength(1);
    expect(useCart.getState().lines[0].stall_id).toBe(demoCatalog.stalls[1].id);
  });
  it('clears private cart state when accounts change', () => {
    useCart.getState().add(demoCatalog.items[0]);
    useCart.getState().scope('student-b');
    expect(useCart.getState().lines).toEqual([]);
    expect(useCart.getState().owner).toBe('student-b');
  });
});
