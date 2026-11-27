'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/providers';
import { Busy, Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { day, money } from '@/lib/format';
import { rpc } from '@/services/catalog';
import { useWalletBalance, WalletCashIn } from './wallet-cash-in';
import { getSupabase } from '@/lib/supabase/client';

const labels = {
  cash_in: 'Cash-in',
  order_payment: 'Order payment',
  order_refund: 'Refund',
  failed: 'Failed payment',
  cancelled: 'Cancelled payment',
};

type Activity = {
  kind: keyof typeof labels;
  amount_centavos: number;
  created_at: string;
  reference: string;
  order_id: string | null;
  reason: string | null;
  method: 'wallet' | 'gcash';
};

export function WalletHistory() {
  const { user, toast } = useSession();
  const client = useQueryClient();
  const [cashIn, setCashIn] = useState(false);
  const [page, setPage] = useState(0);
  const balance = useWalletBalance(user?.id);
  const reminderKey = ['wallet-reminder', user?.id];
  const reminder = useQuery({
    queryKey: reminderKey,
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('wallet_reminder_enabled,wallet_reminder_centavos')
        .eq('id', user!.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const saveReminder = useMutation({
    mutationFn: async (values: {
      wallet_reminder_enabled: boolean;
      wallet_reminder_centavos: number;
    }) => {
      const { error } = await getSupabase().from('profiles').update(values).eq('id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: reminderKey });
      toast('Wallet reminder saved.');
    },
  });
  const history = useQuery({
    queryKey: ['wallet-history', user?.id, page],
    queryFn: () => rpc<Activity[]>('wallet_history', { p_page: page }),
    enabled: Boolean(user),
  });

  return (
    <>
      <PageTitle title="Wallet and payments" back="/student/profile" />
      <section className="panel form-stack">
        <div className="detail-row">
          <span>Available wallet balance</span>
          <strong>{balance.data === undefined ? '—' : money(balance.data)}</strong>
        </div>
        {balance.error && <ErrorBox error={balance.error} retry={() => void balance.refetch()} />}
        <button className="primary-button" onClick={() => setCashIn(true)}>
          Cash in to wallet
        </button>
      </section>
      <section className="panel form-stack">
        <h2>Low-balance reminder</h2>
        {reminder.error && (
          <ErrorBox error={reminder.error} retry={() => void reminder.refetch()} />
        )}
        {reminder.data && (
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              saveReminder.mutate({
                wallet_reminder_enabled: values.has('enabled'),
                wallet_reminder_centavos: Math.round(Number(values.get('amount')) * 100),
              });
            }}
          >
            <label className="check-label">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={reminder.data.wallet_reminder_enabled}
              />{' '}
              Notify me when my wallet balance drops below this amount
            </label>
            <label>
              Reminder amount (₱){' '}
              <input
                name="amount"
                type="number"
                min="1"
                max="10000"
                step="0.01"
                required
                defaultValue={reminder.data.wallet_reminder_centavos / 100}
              />
            </label>
            {saveReminder.error && <ErrorBox error={saveReminder.error} />}
            <button className="secondary-button" disabled={saveReminder.isPending}>
              <Busy busy={saveReminder.isPending}>Save reminder</Busy>
            </button>
          </form>
        )}
        <Link className="text-button" href="/student/rewards">
          View promotional rewards
        </Link>
      </section>
      <section className="panel form-stack">
        <h2>Activity</h2>
        {history.isPending ? (
          <Loading />
        ) : history.error ? (
          <ErrorBox error={history.error} retry={() => void history.refetch()} />
        ) : !history.data?.length ? (
          <Empty
            title="No wallet or payment activity"
            text="Cash-ins, payments and refunds will appear here."
          />
        ) : (
          history.data.map((item) => (
            <article className="detail-row" key={`${item.kind}:${item.reference}`}>
              <div>
                <strong>{labels[item.kind]}</strong>
                <p>
                  {item.method === 'gcash' ? 'GCash (simulated)' : 'CPUGrab Wallet'} ·{' '}
                  {day(item.created_at)}
                </p>
                <details>
                  <summary>Reference</summary>
                  <small>{item.reference}</small>
                </details>
                {item.reason && <p className="help-text">{item.reason}</p>}
                {item.order_id && (
                  <Link className="text-button" href={`/student/order/${item.order_id}`}>
                    View order
                  </Link>
                )}
              </div>
              <strong>
                {item.kind === 'failed' || item.kind === 'cancelled'
                  ? money(Math.abs(item.amount_centavos))
                  : money(item.amount_centavos)}
              </strong>
            </article>
          ))
        )}
        <div className="inline-actions">
          {page > 0 && (
            <button className="secondary-button" onClick={() => setPage(page - 1)}>
              Previous
            </button>
          )}
          {history.data?.length === 20 && (
            <button className="secondary-button" onClick={() => setPage(page + 1)}>
              Next
            </button>
          )}
        </div>
      </section>
      {cashIn && (
        <WalletCashIn
          onClose={() => {
            setCashIn(false);
            void history.refetch();
          }}
        />
      )}
    </>
  );
}
