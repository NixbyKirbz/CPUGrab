'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorBox } from '@/components/ui';
import { deliveryLabel, time } from '@/lib/format';
import { deliveryAction } from '@/services/delivery';
import type { Delivery } from '@/types';
import { DeliveryCodes } from './codes';

export function CustomerDelivery({ delivery, dropoff }: { delivery: Delivery; dropoff?: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (action: string, value: string | null = null) => {
    setBusy(true);
    setError(null);
    try {
      await deliveryAction(delivery.order_id, action, value);
      await client.invalidateQueries({ queryKey: ['orders'] });
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  };
  const canAdjust = ['assigned', 'collected', 'on_the_way', 'arrived'].includes(delivery.phase);
  return (
    <section className="panel form-stack">
      <h2>{deliveryLabel[delivery.phase]}</h2>
      {delivery.group_id && <p>Group campus delivery</p>}
      <p>
        Campus drop-off: <strong>{dropoff ?? 'Approved campus location'}</strong>
      </p>
      {delivery.phase === 'pending' && (
        <p>
          The offer expires at {time(delivery.offer_expires_at)}. If no worker accepts, your
          simulated payment will be refunded.
        </p>
      )}
      {delivery.phase === 'assigned' && (
        <p>Meet at the drop-off point by {time(delivery.delivery_until)}.</p>
      )}
      {delivery.phase === 'arrived' && delivery.wait_until && (
        <p>Meet your worker by {time(delivery.wait_until)}.</p>
      )}
      {delivery.recipient_name && <p>Authorized recipient: {delivery.recipient_name}</p>}
      {['assigned', 'collected'].includes(delivery.phase) &&
        (delivery.customer_ready_at ? (
          <p>Availability confirmed with your worker.</p>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void submit('confirm_ready')}
          >
            Confirm I can meet the worker
          </button>
        ))}
      {['collected', 'on_the_way', 'arrived'].includes(delivery.phase) && (
        <DeliveryCodes orderId={delivery.order_id} stage="handover" />
      )}
      {delivery.delay_decision && (
        <p>
          Delay request: {delivery.delay_requested_minutes} minutes · {delivery.delay_decision}
        </p>
      )}
      {canAdjust && (
        <details>
          <summary>Running late or sending someone else?</summary>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submit('request_delay', String(new FormData(event.currentTarget).get('delay')));
            }}
          >
            <label>
              Request extra time
              <select name="delay">
                <option value="5">5 minutes</option>
                <option value="10">10 minutes</option>
                <option value="15">15 minutes</option>
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={busy || delivery.delay_decision === 'accepted'}
            >
              Ask worker to wait
            </button>
          </form>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(
                'set_recipient',
                String(new FormData(event.currentTarget).get('recipient')),
              );
            }}
          >
            <label>
              Alternative recipient
              <input
                name="recipient"
                maxLength={100}
                defaultValue={delivery.recipient_name ?? ''}
              />
            </label>
            <p className="help-text">
              Share your customer handover QR or PIN privately with this person. Leave the name
              empty to remove them.
            </p>
            <button className="secondary-button" disabled={busy}>
              Save recipient
            </button>
          </form>
        </details>
      )}
      {Boolean(error) && <ErrorBox error={error} />}
    </section>
  );
}
