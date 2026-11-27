'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Busy, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { money } from '@/lib/format';
import { rpc } from '@/services/catalog';

type Rewards = {
  threshold: number;
  reward_centavos: number;
  budget_centavos: number;
  committed_centavos: number;
  redemptions: number;
  customers: number;
  repeat_customers: number;
  completed_orders: number;
  satisfaction: number | null;
};

export function AdminRewards() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const {
    data,
    error: loadError,
    isPending,
  } = useQuery({
    queryKey: ['admin-rewards'],
    queryFn: () => rpc<Rewards>('reward_admin', {}),
  });
  return (
    <>
      <PageTitle title="Promotional rewards" back="/admin/settings" />
      {isPending && <Loading />}
      {Boolean(loadError) && <ErrorBox error={loadError} />}
      {data && (
        <div className="two-col">
          <form
            className="panel form-stack"
            onSubmit={async (event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              setBusy(true);
              setError(null);
              try {
                await rpc('reward_admin', {
                  p_threshold: Number(fields.get('threshold')),
                  p_reward: Math.round(Number(fields.get('value')) * 100),
                  p_budget: Math.round(Number(fields.get('budget')) * 100),
                });
                await client.invalidateQueries({ queryKey: ['admin-rewards'] });
              } catch (problem) {
                setError(problem);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Reward settings</h2>
            <label>
              Eligible orders per reward{' '}
              <input
                name="threshold"
                type="number"
                min="1"
                max="100"
                required
                defaultValue={data.threshold}
              />
            </label>
            <label>
              Reward value (₱){' '}
              <input
                name="value"
                type="number"
                min="0.01"
                max="500"
                step="0.01"
                required
                defaultValue={data.reward_centavos / 100}
              />
            </label>
            <label>
              Total promotional budget (₱){' '}
              <input
                name="budget"
                type="number"
                min={data.committed_centavos / 100}
                max="20000000"
                step="0.01"
                required
                defaultValue={data.budget_centavos / 100}
              />
            </label>
            <p className="help-text">{money(data.committed_centavos)} committed to rewards.</p>
            {Boolean(error) && <ErrorBox error={error} />}
            <button className="primary-button" disabled={busy}>
              <Busy busy={busy}>Save reward settings</Busy>
            </button>
          </form>
          <section className="panel">
            <h2>Customer retention</h2>
            <div className="detail-row">
              <span>Repeat customers</span>
              <strong>
                {data.customers
                  ? `${Math.round((100 * data.repeat_customers) / data.customers)}%`
                  : '—'}
              </strong>
            </div>
            <div className="detail-row">
              <span>Average completed orders per customer</span>
              <strong>
                {data.customers ? (data.completed_orders / data.customers).toFixed(1) : '—'}
              </strong>
            </div>
            <div className="detail-row">
              <span>Rewards redeemed</span>
              <strong>{data.redemptions}</strong>
            </div>
            <div className="detail-row">
              <span>Average order rating</span>
              <strong>{data.satisfaction === null ? '—' : `${data.satisfaction} / 5`}</strong>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
