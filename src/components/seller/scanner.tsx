'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Check, ScanLine, Camera, CameraOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/services/catalog';
import { deliveryAction, deliveryCode } from '@/services/delivery';
import { PageTitle, ErrorBox, Busy } from '@/components/ui';
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
  const [completed, setCompleted] = useState<{ orderNumber?: string } | null>(null);
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
  const finish = async (raw: string) => {
    let orderNumber: string | undefined;
    if (raw.startsWith('cpugrab:delivery-')) {
      const decoded = deliveryCode(raw, 'pickup');
      if (!decoded.orderId) throw new Error('Open the delivery in Orders to verify a PIN.');
      await deliveryAction(decoded.orderId, 'collect', decoded.code);
    } else {
      const clean = raw.replace(/^cpugrab:pickup:/, '');
      if (!/^[a-f0-9]{64}$/i.test(clean)) throw new Error('That is not a CPUGrab pickup code.');
      const order = await rpc<{ order_number: string }>('redeem_pickup_token', { p_token: clean });
      orderNumber = order.order_number;
    }
    if (!mounted.current) return;
    setCompleted({ orderNumber });
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
  const verify = async (raw: string) => {
    if (locking.current) return;
    locking.current = true;
    setBusy(true);
    setError(null);
    try {
      stop();
      await finish(raw.trim());
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
        title="Scan Pickup QR"
        subtitle="Scan a student or delivery worker’s pickup QR code."
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
            void verify(token);
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
      </section>
    </>
  );
}
