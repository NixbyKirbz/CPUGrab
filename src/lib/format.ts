export const money = (centavos: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: centavos % 100 ? 2 : 0,
  }).format(centavos / 100);
export const time = (date: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
export const day = (date: string) =>
  new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
export const statusLabel = (status: string) =>
  ({
    reserved: 'Reserved',
    ready: 'Ready for pickup',
    completed: 'Completed',
    cancelled: 'Cancelled',
  })[status] || status;
export function cartTotals(
  items: { price_centavos: number; quantity: number }[],
  fee: number,
  markup: number,
) {
  const subtotal = items.reduce((sum, item) => sum + item.price_centavos * item.quantity, 0);
  const adjustment = items.reduce((sum, item) => sum + markup * item.quantity, 0);
  return { subtotal, adjustment, total: subtotal + adjustment + fee };
}
