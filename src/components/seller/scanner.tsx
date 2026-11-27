'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Check, ScanLine, Camera, CameraOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/services/catalog';
import { deliveryAction, deliveryCode } from '@/services/delivery';
import { PageTitle, ErrorBox, Busy, Modal } from '@/components/ui';
import { getSupabase } from '@/lib/supabase/client';
import { useStall } from './context';
import { time } from '@/lib/format';
import type { OrderItem } from '@/types';

type Pickup = { id: string; order_number: string; payment_status: string; error?: string };
type PickupMatch = Pickup & { start_time: string };
export function Scanner() {
  const query = useQueryClient();
  const { data: stall } = useStall();
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const mounted = useRef(true);
  const locking = useRef(false);
  const cameraRequested = useRef(false);
  const sound = useRef<AudioContext | null>(null);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [token, setToken] = useState('');
  const [completed, setCompleted] = useState<{ orderNumber?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    pickup: Pickup;
    items: OrderItem[];
    credential: string;
  } | null>(null);
  const [matches, setMatches] = useState<PickupMatch[] | null>(null);
  const stop = useCallback(() => {
    cameraRequested.current = false;
    controls.current?.stop();
    controls.current = null;
    setCamera(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cameraRequested.current = false;
      controls.current?.stop();
      void sound.current?.close();
    };
  }, []);
  const identify = async (raw: string, confirm: boolean) => {
    const clean = raw.replace(/^cpugrab:pickup:/, '').replace(/\s+/g, '');
    if (/^\d{6}$/.test(clean) && stall) {
      const pickup = await rpc<Pickup>('verify_pickup_pin', {
        p_stall: stall.id,
        p_pin: clean,
        p_confirm: confirm,
      });
      if (pickup.error) throw new Error(pickup.error);
      return pickup;
    }
    if (!/^[a-f0-9]{64}$/i.test(clean))
      throw new Error('Scan the QR or enter the six-digit pickup PIN.');
    return rpc<Pickup>(confirm ? 'redeem_pickup_token' : 'inspect_pickup_token', {
      p_token: clean,
    });
  };
  const finish = async (raw: string) => {
    let orderNumber: string | undefined;
    if (raw.startsWith('cpugrab:delivery-')) {
      const decoded = deliveryCode(raw, 'pickup');
      if (!decoded.orderId) throw new Error('Open the delivery in Orders to verify a PIN.');
      await deliveryAction(decoded.orderId, 'collect', decoded.code);
    } else {
      const order = await identify(raw, true);
      orderNumber = order.order_number;
    }
    if (!mounted.current) return;
    setCompleted({ orderNumber });
    setPreview(null);
    stop();
    navigator.vibrate?.([80, 50, 80]);
    if (sound.current?.state === 'running') {
      const oscillator = sound.current.createOscillator(),
        gain = sound.current.createGain();
      oscillator.connect(gain);
      gain.connect(sound.current.destination);
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, sound.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, sound.current.currentTime + 0.18);
      oscillator.start();
      oscillator.stop(sound.current.currentTime + 0.2);
    }
    await query.invalidateQueries({ queryKey: ['orders'] });
  };
  const verify = async (raw: string, confirm = false) => {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    setError(null);
    try {
      stop();
      const credential = raw.trim();
      if (confirm || credential.startsWith('cpugrab:delivery-')) {
        await finish(credential);
      } else {
        const pickup = await identify(credential, false);
        const { data, error } = await getSupabase()
          .from('order_items')
          .select('*')
          .eq('order_id', pickup.id);
        if (error) throw new Error(error.message);
        setPreview({ pickup, items: data as OrderItem[], credential });
      }
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      locking.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const start = async () => {
    try {
      sound.current ??= new AudioContext();
      await sound.current.resume();
    } catch {
      /* Sound is optional. */
    }
    setCameraError('');
    setError(null);
    cameraRequested.current = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          'This browser cannot access a camera. Use HTTPS and allow camera access, or enter the pickup code below.',
        );
      if (!navigator.onLine) throw new Error('Reconnect before scanning a pickup.');
      const reader = new BrowserQRCodeReader();
      const stream = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video.current!,
        (result) => {
          if (result && cameraRequested.current && !locking.current) void verify(result.getText());
        },
      );
      if (!mounted.current || !cameraRequested.current) stream.stop();
      else {
        controls.current = stream;
        setCamera(true);
      }
    } catch (e) {
      cameraRequested.current = false;
      setCameraError(
        e instanceof Error
          ? e.message
          : 'Camera access was denied. Allow access or enter the pickup code.',
      );
    }
  };
  if (completed)
    return (
      <div className="success-page scanner-success">
        <div className="success-icon">
          <Check size={45} />
        </div>
        <h1>{completed.orderNumber ? 'Order Completed!' : 'Meal collected by delivery worker'}</h1>
        {completed.orderNumber && <p style={{ marginTop: 15 }}>#{completed.orderNumber}</p>}
        <p style={{ marginTop: 15 }}>
          {completed.orderNumber
            ? 'The order has been successfully claimed.'
            : 'The order will complete after customer handover.'}
        </p>
        <button
          className="primary-button full-width"
          style={{ marginTop: 30 }}
          onClick={() => {
            setCompleted(null);
            setToken('');
          }}
        >
          Scan next pickup
        </button>
      </div>
    );
  return (
    <>
      <PageTitle
        title="Express Pickup"
        subtitle="Scan a pickup QR code or enter a student’s six-digit PIN."
        back="/seller/orders"
      />
      <section className="scanner-panel">
        <div className="camera-frame">
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            style={{ display: camera ? 'block' : 'none' }}
          />
          {!camera && <ScanLine size={75} />}
          <div className="camera-overlay" />
        </div>
        {camera ? (
          <button className="secondary-button full-width" onClick={stop}>
            <CameraOff size={17} />
            Stop camera
          </button>
        ) : (
          <button
            className="primary-button full-width"
            onClick={() => void start()}
            disabled={busy}
          >
            <Camera size={18} />
            Scan QR code
          </button>
        )}
        {cameraError && <div className="notice">{cameraError}</div>}
        {Boolean(error) && <ErrorBox error={error} />}
        <form
          className="panel form-stack"
          style={{ marginTop: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            void verify(token);
          }}
        >
          <h2 style={{ marginBottom: 0 }}>Enter pickup PIN</h2>
          <label>
            Pickup PIN or QR text
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Six-digit pickup PIN"
              required
              maxLength={160}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            <Busy busy={busy}>Verify pickup code</Busy>
          </button>
          <p className="help-text">
            Use the student’s private code to complete a paid reservation.
          </p>
        </form>
        {stall && (
          <form
            className="panel form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const number = String(new FormData(event.currentTarget).get('student'));
              setBusy(true);
              setMatches(null);
              setError(null);
              try {
                setMatches(
                  await rpc<PickupMatch[]>('find_pickups_by_student', {
                    p_stall: stall.id,
                    p_student_number: number,
                  }),
                );
              } catch (error) {
                setError(error);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Find by student number
              <input name="student" minLength={3} maxLength={40} required />
            </label>
            <button className="secondary-button" disabled={busy}>
              Find reservations
            </button>
            {matches &&
              (matches.length ? (
                <ul>
                  {matches.map((item) => (
                    <li key={item.id}>
                      #{item.order_number} · {time(item.start_time)} · Paid
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No active pickup reservations found.</p>
              ))}
            <p className="help-text">A matching reservation still requires the pickup QR or PIN.</p>
          </form>
        )}
      </section>
      {preview && (
        <Modal
          title={`Confirm handover for #${preview.pickup.order_number}`}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="form-stack">
            <p>
              Payment status:{' '}
              {preview.pickup.payment_status === 'paid' ? 'Paid' : 'Payment required'}
            </p>
            <ul>
              {preview.items.map((item, index) => (
                <li key={index}>
                  {item.item_name_snapshot} × {item.quantity}
                </li>
              ))}
            </ul>
            {Boolean(error) && <ErrorBox error={error} />}
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void verify(preview.credential, true)}
            >
              <Busy busy={busy}>Confirm food handover</Busy>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
