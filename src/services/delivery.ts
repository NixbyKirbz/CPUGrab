import { rpc } from './catalog';

export type DeliveryStage = 'pickup' | 'handover';
export type DeliveryCredentials = { pin: string; qr: string };

export function deliveryCode(raw: string, stage: DeliveryStage) {
  const value = raw.trim();
  if (/^\d{6}$/.test(value)) return { code: value };
  const match = /^cpugrab:delivery-(pickup|handover):([a-f0-9-]{36}):([a-f0-9]{64})$/i.exec(value);
  if (!match || match[1] !== stage)
    throw new Error('Use the QR code or six-digit PIN for this delivery step.');
  return { orderId: match[2], code: match[3] };
}

export async function deliveryAction(orderId: string, action: string, value: string | null = null) {
  const result = await rpc<string>('delivery_action', {
    p_order: orderId,
    p_action: action,
    p_value: value,
  });
  if (result === 'invalid_code') throw new Error('The code did not match this delivery.');
  if (result === 'locked') throw new Error('Too many attempts. Try again in two minutes.');
}
