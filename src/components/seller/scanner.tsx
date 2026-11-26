'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Check, ScanLine, Camera, CameraOff, Banknote } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/services/catalog';
import { money } from '@/lib/format';
import { PageTitle, ErrorBox, Busy, Modal } from '@/components/ui';
type Pickup = { id: string; order_number: string; payment_status: string; total_centavos: number };
export function Scanner() {
  const query = useQueryClient();
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
  const [cash, setCash] = useState<{ order: Pickup; token: string } | null>(null);
  const [completed, setCompleted] = useState('');
  const [busy, setBusy] = useState(false);
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
  const finish = async (raw: string, paid: boolean) => {
    const order = await rpc<Pickup>('redeem_pickup_token', { p_token: raw, p_cash_received: paid });
    if (!mounted.current) return;
    setCompleted(order.order_number);
    setCash(null);
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
  const inspect = async (raw: string) => {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    setError(null);
    const clean = raw.trim().replace(/^cpugrab:pickup:/, '');
    try {
      if (!/^[a-f0-9]{64}$/i.test(clean)) throw new Error('That is not a CPUGrab pickup code.');
      const order = await rpc<Pickup>('inspect_pickup_token', { p_token: clean });
      stop();
      if (order.payment_status === 'unpaid') setCash({ order, token: clean });
      else await finish(clean, false);
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
          if (result && cameraRequested.current && !locking.current) void inspect(result.getText());
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
        <h1>Order Completed!</h1>
        <p style={{ marginTop: 15 }}>#{completed}</p>
        <p style={{ marginTop: 15 }}>The order has been successfully claimed.</p>
        <button
          className="primary-button full-width"
          style={{ marginTop: 30 }}
          onClick={() => {
            setCompleted('');
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
        title="Scan Pickup QR"
        subtitle="Scan the student’s QR code to complete their pickup."
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
            Open rear camera
          </button>
        )}
        {cameraError && <div className="notice">{cameraError}</div>}
        {Boolean(error) && <ErrorBox error={error} />}
        <form
          className="panel form-stack"
          style={{ marginTop: 22 }}
          onSubmit={(e) => {
            e.preventDefault();
            void inspect(token);
          }}
        >
          <h2 style={{ marginBottom: 0 }}>Enter a pickup code</h2>
          <label>
            Secure pickup code
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter the private code below the student’s QR"
              required
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            <Busy busy={busy}>Verify pickup code</Busy>
          </button>
          <p className="help-text">
            Order numbers alone cannot be used to claim an order. Cash must be received before
            completing pickup.
          </p>
        </form>
      </section>
      {cash && (
        <Modal
          title="Cash received?"
          onClose={() => {
            if (!busy) setCash(null);
          }}
        >
          <div className="payment-info">
            <Banknote size={30} />
            <div>
              <strong>#{cash.order.order_number}</strong>
              <small>Collect {money(cash.order.total_centavos)} in cash from the student.</small>
            </div>
          </div>
          <p className="help-text" style={{ margin: '20px 0' }}>
            Confirm only after you receive the full payment. The pickup will then complete
            automatically.
          </p>
          <button
            className="primary-button full-width"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await finish(cash.token, true);
              } catch (e) {
                setError(e);
                setCash(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Busy busy={busy}>I received {money(cash.order.total_centavos)} in cash</Busy>
          </button>
        </Modal>
      )}
    </>
  );
}
