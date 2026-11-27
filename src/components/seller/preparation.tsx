'use client';

import { useQuery } from '@tanstack/react-query';
import { Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { time } from '@/lib/format';
import { rpc } from '@/services/catalog';

type Batch = {
  id: string;
  start_time: string;
  end_time: string;
  confirmed: number;
  max_reservations: number;
  remaining: number;
  portions: number;
  portions_left: number;
  ready: number;
  cancelled: number;
  completed: number;
  lines: { name: string; quantity: number; ready: number | null; prepare_by: string }[];
};

export function Preparation({ stallId }: { stallId: string }) {
  const schedule = useQuery({
    queryKey: ['preparation', stallId],
    queryFn: () => rpc<Batch[]>('preparation_schedule', { p_stall: stallId }),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageTitle
        title="Batch preparation"
        subtitle="Today’s confirmed online reservations in Manila time."
      />
      {schedule.isPending ? (
        <Loading />
      ) : schedule.error ? (
        <ErrorBox error={schedule.error} retry={() => void schedule.refetch()} />
      ) : !schedule.data?.length ? (
        <Empty title="No pickup periods today" text="Add pickup periods in Stall Settings." />
      ) : (
        <div className="delivery-grid">
          {schedule.data.map((period) => (
            <section className="panel form-stack" key={period.id}>
              <h2>
                {time(period.start_time)} – {time(period.end_time)}
              </h2>
              <label>
                Online reservation demand
                <meter
                  min={0}
                  max={Math.max(period.confirmed, period.max_reservations)}
                  value={period.confirmed}
                >
                  {period.confirmed} reservations
                </meter>
              </label>
              <p>
                {period.confirmed} confirmed · {period.remaining} slots left ·{' '}
                {period.portions_left} portions left
              </p>
              <p>
                {period.ready} ready · {period.completed} completed · {period.cancelled} cancelled
              </p>
              {!period.lines.length ? (
                <p>No meals waiting at the stall.</p>
              ) : (
                <>
                  <strong>{period.portions} portions reserved for pickup</strong>
                  <ul className="form-stack">
                    {period.lines.map((line) => (
                      <li key={`${line.name}:${line.prepare_by}`}>
                        <strong>
                          {line.name} ×{line.quantity}
                        </strong>
                        <p className="help-text">
                          {line.ready ?? 0} ready · Suggested start {time(line.prepare_by)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
