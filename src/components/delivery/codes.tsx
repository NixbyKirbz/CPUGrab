'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useSession } from '@/components/providers';
import { Busy, ErrorBox, Loading } from '@/components/ui';
import { rpc } from '@/services/catalog';
import {
  deliveryAction,
  deliveryCode,
  type DeliveryCredentials,
  type DeliveryStage,
} from '@/services/delivery';

export function DeliveryCodes({ orderId, stage }: { orderId: string; stage: DeliveryStage }) {
  const { user } = useSession();
  const [revealed, setRevealed] = useState(false);
  const code = useQuery({
    queryKey: ['delivery-code', user?.id, orderId, stage],
    queryFn: () =>
      rpc<DeliveryCredentials>('delivery_credentials', { p_order: orderId, p_stage: stage }),
    enabled: Boolean(user && revealed),
    gcTime: 0,
    retry: false,
  });
  return (
    <div className="form-stack">
      <button type="button" className="secondary-button" onClick={() => setRevealed(!revealed)}>
        {revealed ? 'Hide' : 'Show'} {stage === 'pickup' ? 'stall pickup' : 'customer handover'}{' '}
        code
      </button>
      {revealed &&
        (code.isPending ? (
          <Loading />
        ) : code.error ? (
          <ErrorBox error={code.error} />
        ) : (
          code.data && (
            <div className="delivery-code">
              <QRCodeSVG
                value={code.data.qr}
                title={stage === 'pickup' ? 'Worker pickup QR code' : 'Customer handover QR code'}
                size={184}
                marginSize={4}
              />
              <strong className="qr-token" aria-label={`PIN ${code.data.pin}`}>
                {code.data.pin}
              </strong>
              <p className="help-text">
                {stage === 'pickup'
                  ? 'Show this code to the stall when collecting the meal.'
                  : 'Share this code with the worker at handover or with the person you chose to receive the meal.'}
              </p>
            </div>
          )
        ))}
    </div>
  );
}

export function VerifyDeliveryCode({
  orderId,
  stage,
  onVerified,
}: {
  orderId: string;
  stage: DeliveryStage;
  onVerified: () => void;
}) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const verify = async (raw: string) => {
    const decoded = deliveryCode(raw, stage);
    if (decoded.orderId && decoded.orderId !== orderId)
      throw new Error('This QR belongs to another delivery.');
    await deliveryAction(orderId, stage === 'pickup' ? 'collect' : 'handover', decoded.code);
  };
  const submit = async (getCode: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await verify(await getCode());
      onVerified();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(async () => pin);
      }}
    >
      <label>
        {stage === 'pickup' ? 'Worker pickup PIN' : 'Customer handover PIN'}
        <input
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="off"
        />
      </label>
      <button className="secondary-button" disabled={busy}>
        <Busy busy={busy}>Verify PIN</Busy>
      </button>
      <label>
        Scan a QR photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={busy}
          onChange={(event) => {
            const input = event.currentTarget;
            const photo = input.files?.[0];
            if (!photo) return;
            input.value = '';
            void submit(async () => {
              const { BrowserQRCodeReader } = await import('@zxing/browser');
              const url = URL.createObjectURL(photo);
              try {
                const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
                return result.getText();
              } catch {
                throw new Error(
                  'Could not read the QR code. Try a clearer photo or enter the PIN.',
                );
              } finally {
                URL.revokeObjectURL(url);
              }
            });
          }}
        />
      </label>
      {Boolean(error) && <ErrorBox error={error} />}
    </form>
  );
}
